import { NextRequest, NextResponse } from 'next/server'
import { yahooFinance } from '@/lib/yahoo-finance'
import { getCached, getCacheValue, setCacheValue } from '@/lib/api/memory-cache'
import { QuantClient } from '@/lib/ai/quant-client'
import {
  fetchAlphaVantageIntraday,
  fetchAlphaVantageQuote,
  fetchFinnhubCandles,
  fetchFinnhubQuote,
  getYahooSymbol,
  getZestySymbolMarket,
} from '@/lib/market-data'
import { fetchAlpacaCryptoCandles, fetchAlpacaCryptoQuotes, isUsdCryptoSymbol } from '@/lib/alpaca/market-data'
import { calculatePreliminaryScore, calculateFinalQuantScore, rankScreenerResults, PreliminaryTechData, QuantResultData } from '@/lib/ranking'
import { assessMarketDataQuality, type MarketDataQualityResult } from '@/lib/market-data-quality'
import { normalizeHistoricalData } from '@/lib/historical-data-normalizer'
import { selectCryptoMlDecision, type CryptoMlDecision } from '@/lib/crypto-ml-policy'
import type { Candle } from '@/types'
import { getDurableMarketData, readQuantResultsCache, writeQuantResultsCache } from '@/lib/api/market-data-cache'
import { isCryptoSymbol, evaluateFinalDecisionGate } from '@/lib/final-decision-gate'
import { getUSMarketStatus } from '@/lib/market-schedule'


const MAX_SYMBOLS = 500
const YAHOO_CONCURRENCY = 10
const YAHOO_QUOTES_TIMEOUT_MS = Number.parseInt(process.env.YAHOO_QUOTES_TIMEOUT_MS || '10000', 10)
const YAHOO_CANDLES_TIMEOUT_MS = Number.parseInt(process.env.YAHOO_CANDLES_TIMEOUT_MS || '10000', 10)

const QUANT_MAX_CANDIDATES = parseInt(process.env.QUANT_MAX_CANDIDATES || '40', 10)
const QUANT_CONCURRENCY = parseInt(process.env.QUANT_CONCURRENCY || '4', 10)
const PROVIDER_FALLBACK_MAX_CANDIDATES = parseInt(process.env.PROVIDER_FALLBACK_MAX_CANDIDATES || '5', 10)
const CACHE_TTL_MS = 60 * 1000 // 1 minute
const scanCandleProviders = new Map<string, ScanProvider | 'configured-market-data'>()

type PythonResultRecord = {
  data: QuantResultData | null
  ok: boolean
  status: 'ok' | 'partial' | 'failed'
  reason: string
  quantSymbol: string
}

type QuoteLike = {
  symbol?: string
  regularMarketPrice?: number
  regularMarketPreviousClose?: number
  regularMarketChangePercent?: number
  regularMarketVolume?: number
  shortName?: string
  longName?: string
}

function finitePositive(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

type ScanProvider = 'alpaca' | 'finnhub' | 'alpha-vantage' | 'yahoo'

type CandleLike = {
  date?: string | Date
  open?: number
  high?: number
  low?: number
  close?: number
  volume?: number
}

type ChartLike = {
  quotes?: CandleLike[]
  indicators?: { quote?: CandleLike[][] }
  timestamp?: number[]
}

type SentimentRecord = {
  sentiment?: string
  score?: number
}

type PreliminaryWithSentiment = PreliminaryTechData & {
  _sentiment?: SentimentRecord
  marketDataQuality?: MarketDataQualityResult
  providerFallback?: Record<string, unknown>
  cryptoMlDecision?: CryptoMlDecision
}

function shouldDeprioritizeForGeneralScan(candidate: PreliminaryTechData, category: string) {
  if (category === 'etf-apalancados' || category === 'etf-inversos') return false
  return candidate.isLeveragedOrInverse
}

function scanProviderOrder(): ScanProvider[] {
  const configured = (process.env.MARKET_DATA_SCAN_PROVIDER_ORDER || 'finnhub,alpha-vantage,yahoo')
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is ScanProvider => ['finnhub', 'alpha-vantage', 'yahoo'].includes(provider))

  return Array.from(new Set(configured.length > 0 ? configured : ['finnhub', 'alpha-vantage', 'yahoo']))
}

function normalizeProviderSymbol(symbol: string) {
  return symbol.toUpperCase().replace('-', '.')
}

function quoteToQuoteLike(symbol: string, quote: Awaited<ReturnType<typeof fetchFinnhubQuote>>): QuoteLike | null {
  if (!quote) return null

  return {
    symbol,
    regularMarketPrice: quote.price,
    regularMarketPreviousClose: quote.previousClose,
    regularMarketChangePercent: quote.changePercent,
    regularMarketVolume: quote.volume,
    shortName: quote.name,
    longName: quote.name,
  }
}

async function fetchConfiguredQuoteLike(symbol: string): Promise<QuoteLike | null> {
  const providerSymbol = normalizeProviderSymbol(symbol)

  for (const provider of scanProviderOrder()) {
    if (provider === 'yahoo') continue

    try {
      if (provider === 'finnhub' && process.env.FINNHUB_API_KEY) {
        return quoteToQuoteLike(symbol, await fetchFinnhubQuote(providerSymbol, process.env.FINNHUB_API_KEY))
      }

      if (provider === 'alpha-vantage' && process.env.ALPHA_VANTAGE_API_KEY) {
        return quoteToQuoteLike(symbol, await fetchAlphaVantageQuote(providerSymbol, process.env.ALPHA_VANTAGE_API_KEY))
      }
    } catch (error) {
      console.warn(`[Quant Scan] ${provider} quote failed for ${symbol}:`, error)
    }
  }

  return null
}

function fallbackDatasetToCandles(dataset: Record<string, unknown>[]): Candle[] {
  return dataset
    .map((row) => {
      const timeValue = row.time ?? row.timestamp ?? row.date ?? row.datetime
      const parsedTime = typeof timeValue === 'number'
        ? timeValue
        : Date.parse(String(timeValue ?? '')) / 1000
      return {
        time: Number.isFinite(parsedTime) ? Math.floor(parsedTime) : 0,
        open: Number(row.open ?? row.Open),
        high: Number(row.high ?? row.High),
        low: Number(row.low ?? row.Low),
        close: Number(row.close ?? row.Close),
        volume: Number(row.volume ?? row.Volume),
      }
    })
    .filter((candle) => candle.time > 0 && Number.isFinite(candle.close))
}

function classifyPythonResult(data: QuantResultData | null): Pick<PythonResultRecord, 'ok' | 'status' | 'reason'> {
  if (!data) {
    return { ok: false, status: 'failed', reason: 'Quant engine did not return workflow_result' }
  }

  const action = String(data.action || '').toUpperCase()
  const confidence = Number(data.confidence ?? 0)
  const regime = String(data.market_regime || '').toLowerCase()
  const explanation = String(data.xai_explanation || data.error_reason || '')
  const dataStatus = String((data as Record<string, unknown>).data_status || '').toLowerCase()
  const marketDataQuality = (data as Record<string, unknown>).market_data_quality as { usable_for_ml?: boolean; recommendation?: string } | undefined
  const hasDataFetchError = /error fetching data|fallo al obtener datos|datos insuficientes|incompleto/i.test(explanation)
  const unknownRegime = !regime || regime === 'unknown' || regime.includes('desconocido')

  if (dataStatus === 'insufficient' || marketDataQuality?.usable_for_ml === false) {
    return {
      ok: false,
      status: 'failed',
      reason: marketDataQuality?.recommendation || explanation || 'Market data quality blocked ML analysis',
    }
  }

  if (hasDataFetchError) {
    return { ok: false, status: 'failed', reason: explanation || 'Quant engine reported incomplete data' }
  }

  if (action === 'HOLD' && confidence === 0 && unknownRegime) {
    return { ok: false, status: 'partial', reason: 'Python returned HOLD with 0 confidence and unknown regime' }
  }

  if (unknownRegime || confidence === 0) {
    return { ok: false, status: 'partial', reason: 'Python returned partial quant data' }
  }

  return { ok: true, status: 'ok', reason: 'Python workflow completed with usable quant data' }
}

async function fetchBatchQuotes(symbols: string[], yahooToOriginal?: Map<string, string>) {
  const quotes = new Map<string, QuoteLike>()
  const yahooSymbols: string[] = []
  
  // Create reverse mapping (original -> yahoo)
  const originalToYahoo = new Map<string, string>()
  if (yahooToOriginal) {
    for (const [ySym, orig] of yahooToOriginal.entries()) {
      originalToYahoo.set(orig.toUpperCase(), ySym)
    }
  }

  // Filter and map to original symbols for Alpaca
  const cryptoSymbols: string[] = []
  if (yahooToOriginal) {
    for (const s of symbols) {
      if (isUsdCryptoSymbol(s)) {
        const orig = yahooToOriginal.get(s.toUpperCase()) || s
        cryptoSymbols.push(orig)
      }
    }
  } else {
    cryptoSymbols.push(...symbols.filter(isUsdCryptoSymbol))
  }

  const alpacaQuotes = cryptoSymbols.length > 0
    ? await fetchAlpacaCryptoQuotes(cryptoSymbols).catch((error) => {
      console.warn('[Quant Scan] alpaca crypto quotes failed:', error)
      return new Map<string, Awaited<ReturnType<typeof fetchAlpacaCryptoQuotes>> extends Map<string, infer T> ? T : never>()
    })
    : new Map()

  for (const [symbol, quote] of alpacaQuotes.entries()) {
    const qData = {
      symbol: quote.symbol,
      regularMarketPrice: quote.price,
      regularMarketPreviousClose: quote.previousClose,
      regularMarketChangePercent: quote.changePercent,
      regularMarketVolume: quote.volume,
      shortName: quote.name,
      longName: quote.name,
    }
    quotes.set(symbol, qData)
    quotes.set(symbol.toUpperCase(), qData)

    const ySym = originalToYahoo.get(symbol.toUpperCase())
    if (ySym) {
      quotes.set(ySym, qData)
      quotes.set(ySym.toUpperCase(), qData)
    }
  }

  await Promise.all(symbols.map(async (symbol) => {
    if (quotes.has(symbol) || quotes.has(symbol.toUpperCase())) return
    
    // If it's a crypto symbol but Alpaca failed or didn't return it, we let it fall through to Yahoo
    if (isUsdCryptoSymbol(symbol)) {
      yahooSymbols.push(symbol)
      return
    }

    const configuredQuote = await fetchConfiguredQuoteLike(symbol)
    if (configuredQuote) {
      quotes.set(symbol, configuredQuote)
      quotes.set(symbol.toUpperCase(), configuredQuote)
    } else {
      yahooSymbols.push(symbol)
    }
  }))

  const chunkSize = 50
  for (let i = 0; i < yahooSymbols.length; i += chunkSize) {
    const chunk = yahooSymbols.slice(i, i + chunkSize)
    try {
      const response = await withTimeout(
        yahooFinance.quote(chunk, {}, { validateResult: false }),
        YAHOO_QUOTES_TIMEOUT_MS,
        `Yahoo quote batch ${chunk.join(',')}`
      )
      const arr = Array.isArray(response) ? response : (response ? [response] : [])
      for (const q of arr as QuoteLike[]) {
        if (q && q.symbol) quotes.set(q.symbol, q)
      }
    } catch (e) {
      console.error(`[Quant Scan] Batch quote error for chunk:`, e)
      // Fallback to individual
      await Promise.all(chunk.map(async (sym) => {
        try {
          const q = await withTimeout(
            yahooFinance.quote(sym, {}, { validateResult: false }),
            YAHOO_QUOTES_TIMEOUT_MS,
            `Yahoo quote ${sym}`
          )
          if (q) quotes.set(sym, q)
        } catch {
          // Keep scanning the rest of the batch when a single quote fails.
        }
      }))
    }
  }
  return quotes
}

async function fetchConfiguredDailyCandles(symbol: string): Promise<{ candles: Candle[]; provider: ScanProvider } | null> {
  if (isCryptoSymbol(symbol)) {
    const period1 = new Date()
    period1.setFullYear(2015, 0, 1)
    const candles = await fetchAlpacaCryptoCandles(symbol, '1d', period1)
    if (candles.length > 0) return { candles, provider: 'alpaca' }
    return null
  }

  const providerSymbol = normalizeProviderSymbol(symbol)
  const to = Math.floor(Date.now() / 1000)
  const from = to - 365 * 24 * 60 * 60

  for (const provider of scanProviderOrder()) {
    if (provider === 'yahoo') continue

    try {
      const candles = provider === 'finnhub' && process.env.FINNHUB_API_KEY
        ? await fetchFinnhubCandles(providerSymbol, '1d', process.env.FINNHUB_API_KEY, from, to)
        : provider === 'alpha-vantage' && process.env.ALPHA_VANTAGE_API_KEY
          ? await fetchAlphaVantageIntraday(providerSymbol, '1d', process.env.ALPHA_VANTAGE_API_KEY)
          : []

      const clean = candles
        .filter((candle) => candle.time >= from && Number.isFinite(candle.close) && candle.close > 0)
        .sort((a, b) => a.time - b.time)

      if (clean.length > 0) return { candles: clean, provider }
    } catch (error) {
      console.warn(`[Quant Scan] ${provider} candles failed for ${symbol}:`, error)
    }
  }

  return null
}

async function fetchCandles(symbol: string, market: 'US' | 'CL' = 'US', original?: string): Promise<Candle[]> {
  try {
    const origSymbol = original || symbol
    const cryptoOnly = isCryptoSymbol(origSymbol)
    return await getDurableMarketData<Candle[]>({
      symbol,
      market,
      range: cryptoOnly ? 'alpaca-full-history' : '1y',
      ttlMs: 4 * 60 * 60 * 1000, // 4 hours TTL
      provider: 'configured-market-data',
      loader: async () => {
        if (market === 'US') {
          const configured = await fetchConfiguredDailyCandles(origSymbol)
          if (configured) {
            scanCandleProviders.set(symbol.toUpperCase(), configured.provider)
            return configured.candles
          }
        }

        if (cryptoOnly) {
          scanCandleProviders.set(symbol.toUpperCase(), 'alpaca')
          return []
        }

        const period1 = new Date()
        period1.setDate(period1.getDate() - 365) // 1Y
        const res = await withTimeout(
          yahooFinance.chart(symbol, { interval: '1d', period1 }),
          YAHOO_CANDLES_TIMEOUT_MS,
          `Yahoo chart ${symbol}`
        ) as ChartLike
        const rawQuotes = res.quotes || res.indicators?.quote?.[0] || []
        scanCandleProviders.set(symbol.toUpperCase(), 'yahoo')
        return rawQuotes.map((q, i: number) => {
          let time = 0
          if (q.date) time = Math.floor(new Date(q.date).getTime() / 1000)
          else if (res.timestamp?.[i]) time = res.timestamp[i]
          return {
            time,
            open: Number(q.open),
            high: Number(q.high),
            low: Number(q.low),
            close: Number(q.close),
            volume: Number(q.volume)
          }
        }).filter((c) => c.close > 0)
      }
    })
  } catch (e) {
    console.error(`[Quant Scan] No se pudieron obtener velas para ${symbol}:`, e)
    return []
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const symbolsInput: string[] = Array.isArray(body.symbols) ? body.symbols : []
    const category: string = body.category || 'unknown'
    const market: string = body.market || 'US'
    const symbolMap = body.symbolMap || {} // Optional: { "AAPL": "Apple Inc." }
    const symbolMarkets: Record<string, 'US' | 'CL'> = body.symbolMarkets || {}
    const forceQuantRefresh = body.forceQuantRefresh === true

    if (!symbolsInput.length) {
      return NextResponse.json({ error: 'No symbols provided' }, { status: 400 })
    }

    let fxUsdClp = 900
    try {
      const fxQuote = await withTimeout(
        yahooFinance.quote('CLP=X', {}, { validateResult: false }),
        YAHOO_QUOTES_TIMEOUT_MS,
        'Yahoo quote CLP=X'
      )
      if (fxQuote && fxQuote.regularMarketPrice) {
        fxUsdClp = fxQuote.regularMarketPrice
      }
    } catch (e) {
      console.warn('[Quant Scan] Failed to fetch USD/CLP FX rate from Yahoo Finance:', e)
    }

    const uniqueSymbols = Array.from(new Set(symbolsInput)).slice(0, MAX_SYMBOLS)
    
    // Normalize symbols for Yahoo (e.g. BRK.B -> BRK-B)
    const yahooToOriginal = new Map<string, string>()
    const yahooSymbols = uniqueSymbols.map(sym => {
      const symbolMarket = symbolMarkets[sym] || getZestySymbolMarket(sym)
      const ySym = getYahooSymbol(sym, symbolMarket)
      yahooToOriginal.set(ySym.toUpperCase(), sym)
      return ySym
    })

    console.log(`[Quant Scan] Requested ${yahooSymbols.length} symbols. Pre-filtering...`)

    // Step 1: Batch Quotes
    const quotesMap = new Map<string, QuoteLike>()
    const symbolsToFetchQuote: string[] = []

    for (const ySym of yahooSymbols) {
      const cacheKey = `scan:quote:${ySym.toUpperCase()}`
      const cached = getCacheValue<QuoteLike>(cacheKey)
      if (cached) {
        quotesMap.set(ySym, cached)
        quotesMap.set(ySym.toUpperCase(), cached)
      } else {
        symbolsToFetchQuote.push(ySym)
      }
    }

    if (symbolsToFetchQuote.length > 0) {
      const fetchedQuotes = await fetchBatchQuotes(symbolsToFetchQuote, yahooToOriginal)
      for (const ySym of symbolsToFetchQuote) {
        const q = fetchedQuotes.get(ySym) || fetchedQuotes.get(ySym.toUpperCase()) || fetchedQuotes.get(ySym.toLowerCase())
        if (q) {
          quotesMap.set(ySym, q)
          quotesMap.set(ySym.toUpperCase(), q)
          setCacheValue(`scan:quote:${ySym.toUpperCase()}`, q, CACHE_TTL_MS)
        }
      }
    }

    // Step 2: Fetch Candles with Concurrency
    const candlesMap = new Map<string, Candle[]>()
    let active = 0
    let index = 0
    await new Promise<void>((resolve) => {
      const next = async () => {
        if (index >= yahooSymbols.length) {
          if (active === 0) resolve()
          return
        }
        const sym = yahooSymbols[index++]
        const original = yahooToOriginal.get(sym.toUpperCase()) || sym
        const originalMarket = symbolMarkets[original] || getZestySymbolMarket(original) || market
        const safeMarket: 'US' | 'CL' = originalMarket === 'CL' ? 'CL' : 'US'
        active++

        const cacheKey = `scan:candles:${sym.toUpperCase()}`
        let candles = getCacheValue<Candle[]>(cacheKey)
        if (!candles) {
          candles = await fetchCandles(sym, safeMarket, original)
          setCacheValue(cacheKey, candles, CACHE_TTL_MS)
        }

        candlesMap.set(sym, candles)
        active--
        next()
      }
      for (let i = 0; i < YAHOO_CONCURRENCY && i < yahooSymbols.length; i++) next()
    })

    // Step 3: Preliminary Scoring
    const preliminaryResults: PreliminaryTechData[] = []
    
    // Step 3.5: Fetch Sentiment Cache
    const client = new QuantClient()
    const sentimentRes = await client.getSentimentCache()
    const sentimentCache = sentimentRes.success && sentimentRes.data ? (sentimentRes.data as Record<string, SentimentRecord>) : {}
    const sentimentCacheStatus = sentimentRes.success ? 'ok' : 'engine_unavailable'

    for (const ySym of yahooSymbols) {
      const original = yahooToOriginal.get(ySym.toUpperCase()) || ySym
      const q = quotesMap.get(ySym) || quotesMap.get(ySym.toUpperCase())
      let c = candlesMap.get(ySym) || []
      const originalMarket = symbolMarkets[original] || getZestySymbolMarket(original) || market
      const isCryptoMarketData = isUsdCryptoSymbol(original) || isUsdCryptoSymbol(ySym)
      const selectedProvider: ScanProvider | 'configured-market-data' = isCryptoMarketData
        ? 'alpaca'
        : scanCandleProviders.get(ySym.toUpperCase()) || 'configured-market-data'
      const normalizedLocal = normalizeHistoricalData({
        symbol: original,
        provider: selectedProvider,
        market: originalMarket,
        timeframe: '1d',
        raw_dataset: c as unknown as Record<string, unknown>[],
        metadata: {
          provider: selectedProvider,
          source: 'src/app/api/quant/scan',
          adjusted: null,
        },
      })
      c = normalizedLocal.normalized_dataset
      const quality = assessMarketDataQuality({
        symbol: original,
        provider: selectedProvider,
        timeframe: '1d',
        dataset: c,
        metadata: {
          provider: selectedProvider,
          source: 'src/app/api/quant/scan',
          normalization_status: normalizedLocal.normalization_status,
          adjusted_status: normalizedLocal.adjusted_status,
          adjusted: null,
        },
      })
      const cryptoMlDecision = selectCryptoMlDecision(original, c, quality)
      let providerFallback: Record<string, unknown> | undefined
      
      const quoteData = {
        price: finitePositive(q?.regularMarketPrice) ?? finitePositive(q?.regularMarketPreviousClose),
        changePercent: finiteNumber(q?.regularMarketChangePercent),
        volume: finiteNumber(q?.regularMarketVolume)
      }
      
      const name = symbolMap[original] || q?.shortName || q?.longName || original

      const canUseRecentIpoFallback = quality.usable_for_chart && c.length > 0 && c.length < 50 && quoteData.price !== null
      const prelim = calculatePreliminaryScore(
        original,
        name,
        originalMarket,
        category,
        (quality.usable_for_ta || canUseRecentIpoFallback) ? c : [],
        quoteData
      )
      prelim.marketDataQuality = quality
      ;(prelim as PreliminaryWithSentiment).cryptoMlDecision = cryptoMlDecision
      ;(prelim as PreliminaryWithSentiment).providerFallback = providerFallback || {
        selected_provider: selectedProvider,
        fallback_used: false,
      }
      if (cryptoMlDecision.isCrypto) {
        prelim.score = Math.max(0, Math.min(100, prelim.score - cryptoMlDecision.scorePenalty))
        prelim.suggestions.push({
          type: cryptoMlDecision.lightgbmAllowed ? 'opportunity' : 'warning',
          label: cryptoMlDecision.lightgbmAllowed ? 'Modelo cripto ML apto' : cryptoMlDecision.engineLabel,
        })
      }
      if (!quality.usable_for_ml) {
        prelim.suggestions = prelim.suggestions.filter((suggestion) => suggestion.type !== 'opportunity')
      }
      if (!quality.usable_for_ta && !prelim.recentIpoFallback) {
        prelim.noData = true
        prelim.suggestions.push({
          type: 'warning',
          label: quality.usable_for_chart ? 'Solo grafico' : 'Datos insuficientes',
        })
      } else if (prelim.recentIpoFallback) {
        prelim.suggestions.push({
          type: 'neutral',
          label: `Historia corta (${c.length} velas): sin MA50/MACD`,
        })
      }
      
      // Inject Sentiment
      const sent = sentimentCache[original] || sentimentCache[ySym] || sentimentCache[ySym.toUpperCase()]
      if (sent) {
        prelim.score += (Number(sent.score ?? 0) * 5) // +5 per sentiment score unit
        prelim.score = Math.max(0, Math.min(100, prelim.score))
        // We attach it to prelim or wait for final? 
        // We'll attach it to prelim as suggestions
        if ((quality.usable_for_ml || prelim.recentIpoFallback) && sent.sentiment === 'POSITIVE') prelim.suggestions.push({ type: 'opportunity', label: 'Noticias Positivas (FinBERT)' })
        if (sent.sentiment === 'NEGATIVE') prelim.suggestions.push({ type: 'warning', label: 'Noticias Negativas (FinBERT)' })
        
        // Also store it for later
        ;(prelim as PreliminaryWithSentiment)._sentiment = sent
      }

      preliminaryResults.push(prelim)
    }

    // Step 4: Sort and pick Top Candidates for Python
    preliminaryResults.sort((a, b) => b.score - a.score)
    const pythonEligiblePool = preliminaryResults.filter(candidate => !shouldDeprioritizeForGeneralScan(candidate, category))
    const pythonDeprioritizedPool = preliminaryResults.filter(candidate => shouldDeprioritizeForGeneralScan(candidate, category))
    const topCandidates = [
      ...pythonEligiblePool.slice(0, QUANT_MAX_CANDIDATES),
      ...pythonDeprioritizedPool.slice(0, Math.max(0, QUANT_MAX_CANDIDATES - pythonEligiblePool.length)),
    ].slice(0, QUANT_MAX_CANDIDATES)

    // Resolve provider fallback for weak Yahoo datasets among top candidates.
    // This compares yahoo-chart/yfinance/alpha-vantage/finnhub in quant-engine when available.
    if (topCandidates.length > 0) {
      for (const candidate of topCandidates.slice(0, PROVIDER_FALLBACK_MAX_CANDIDATES)) {
        const qualityScore = Number(candidate.marketDataQuality?.quality_score ?? 0)
        const isCryptoCandidate = isUsdCryptoSymbol(candidate.symbol)
        const needsProviderCheck = !isCryptoCandidate &&
          Boolean(candidate.marketDataQuality) &&
          (!candidate.marketDataQuality?.usable_for_ml ||
            candidate.marketDataQuality?.usable_for_backtest === false ||
            qualityScore < 80)

        if (needsProviderCheck) {
          try {
            const fallbackRes = await client.resolveProviderFallback({
              symbol: candidate.symbol,
              market: candidate.market,
              timeframe: '1d',
              range: '2y',
              required_use: 'ml',
            })
            if (fallbackRes.success && fallbackRes.data) {
              ;(candidate as PreliminaryWithSentiment).providerFallback = fallbackRes.data as unknown as Record<string, unknown>
            }
            if (fallbackRes.success && fallbackRes.data?.selected_quality) {
              const fallbackQuality = fallbackRes.data.selected_quality as unknown as MarketDataQualityResult
              const fallbackCandles = fallbackDatasetToCandles(fallbackRes.data.selected_dataset || [])
              candidate.marketDataQuality = { ...fallbackQuality, provider: fallbackRes.data.selected_provider || candidate.marketDataQuality?.provider || 'unknown' }
              if (fallbackCandles.length > 0) {
                candidate.noData = false
                candlesMap.set(candidate.symbol, fallbackCandles)
              }
            }
          } catch (e) {
            console.error(`[Quant Scan] Failed resolving fallback for top candidate ${candidate.symbol}:`, e)
          }
        }
      }
    }

    const pythonResults = new Map<string, PythonResultRecord>()
    const baseCandidatesToAnalyze = topCandidates.filter(candidate => candidate.marketDataQuality?.usable_for_ml && candidate.marketDataQuality.quality_score >= 60)
    const candidatesToAnalyze = baseCandidatesToAnalyze.filter(candidate => {
      const cryptoDecision = (candidate as PreliminaryWithSentiment).cryptoMlDecision
      if (cryptoDecision?.isCrypto) {
        return cryptoDecision.pythonAllowed
      }
      return true
    })
    let quantCacheHits = 0
    let quantLiveRequests = 0
    
    console.log(`[Quant Scan] Running Python analysis for Top ${candidatesToAnalyze.length} candidates with concurrency ${QUANT_CONCURRENCY}...`)
    
    // Step 5: Run Python Analysis Concurrently
    let activeQuant = 0
    let quantIndex = 0
    if (candidatesToAnalyze.length > 0) {
      await new Promise<void>((resolve) => {
        const next = async () => {
          if (quantIndex >= candidatesToAnalyze.length) {
            if (activeQuant === 0) resolve()
            return
          }
          const candidate = candidatesToAnalyze[quantIndex++]
          activeQuant++
          try {
            const candidateMarket = (candidate.market === 'CL' || candidate.market === 'US')
              ? candidate.market
              : getZestySymbolMarket(candidate.symbol)
            const quantSymbol = getYahooSymbol(candidate.symbol, candidateMarket)
            
            // 1. Check Global Cache
            const cachedResult = forceQuantRefresh
              ? null
              : await readQuantResultsCache<QuantResultData>(candidate.symbol, candidateMarket)
            if (cachedResult) {
              quantCacheHits++
              const classification = classifyPythonResult(cachedResult)
              pythonResults.set(candidate.symbol, {
                data: {
                  ...cachedResult,
                  engine_status: classification.status,
                  data_quality: classification.ok ? 'complete' : classification.status === 'partial' ? 'partial' : 'insufficient',
                  engine_reason: classification.reason,
                  quant_symbol: quantSymbol,
                },
                ...classification,
                quantSymbol,
              })
              activeQuant--
              next()
              return
            }

            // 2. Not in Cache, send to Python
            quantLiveRequests++
            const res = await client.runWorkflow(quantSymbol)
            if (res.success && res.data?.workflow_result) {
               const workflowResult = res.data.workflow_result as QuantResultData
               const classification = classifyPythonResult(workflowResult)
               pythonResults.set(candidate.symbol, {
                 data: {
                   ...workflowResult,
                   engine_status: classification.status,
                   data_quality: classification.ok ? 'complete' : classification.status === 'partial' ? 'partial' : 'insufficient',
                   engine_reason: classification.reason,
                   quant_symbol: quantSymbol,
                 },
                 ...classification,
                 quantSymbol,
               })
               
               // 3. Save usable results to Global Cache (24 hours)
               if (classification.ok || classification.status === 'partial') {
                 await writeQuantResultsCache(candidate.symbol, candidateMarket, workflowResult, 24 * 60 * 60 * 1000)
               }
            } else {
               pythonResults.set(candidate.symbol, {
                 data: null,
                 ok: false,
                 status: 'failed',
                 reason: res.error || 'Quant engine request failed',
                 quantSymbol,
               })
            }
          } catch (e) {
            pythonResults.set(candidate.symbol, {
              data: null,
              ok: false,
              status: 'failed',
              reason: e instanceof Error ? e.message : String(e),
              quantSymbol: candidate.symbol,
            })
          }
          activeQuant--
          next()
        }
        for (let i = 0; i < QUANT_CONCURRENCY && i < candidatesToAnalyze.length; i++) next()
      })
    }

    // Step 6: Final Ranking
    const finalResults = preliminaryResults.map(p => {
      const isTopCandidate = topCandidates.some(t => t.symbol === p.symbol)
      const pythonRecord = isTopCandidate ? (pythonResults.get(p.symbol) || null) : null
      const cryptoMlDecision = (p as PreliminaryWithSentiment).cryptoMlDecision
      const quantData = pythonRecord?.data
        ? { ...pythonRecord.data, crypto_ml_decision: cryptoMlDecision }
        : p.recentIpoFallback
          ? {
              action: p.score >= 62 ? 'BUY' : p.score <= 38 ? 'SELL' : 'HOLD',
              confidence: Math.max(50, Math.min(69, Math.round(p.score))),
              engine_status: 'skipped',
              data_quality: 'partial',
              engine_reason: 'recent_ipo_fallback: LightGBM long-term indicators disabled; score uses volume, immediate change and sentiment.',
              quant_symbol: p.symbol,
              crypto_ml_decision: cryptoMlDecision,
            } satisfies QuantResultData
        : cryptoMlDecision?.isCrypto
          ? {
              action: 'HOLD',
              confidence: cryptoMlDecision.confidenceCap,
              engine_status: cryptoMlDecision.pythonAllowed ? 'skipped' : 'skipped',
              data_quality: p.marketDataQuality?.usable_for_ml ? 'partial' : 'insufficient',
              engine_reason: cryptoMlDecision.reasons.join(' ') || cryptoMlDecision.engineLabel,
              crypto_ml_decision: cryptoMlDecision,
            } satisfies QuantResultData
          : null
      const isFallback = isTopCandidate ? (!pythonRecord || !pythonRecord.ok) : true
      
      const finalScore = calculateFinalQuantScore(p, quantData, isFallback)
      
      const sent = (p as PreliminaryWithSentiment)._sentiment
      if (sent) {
        if (!finalScore.quant) finalScore.quant = {}
        finalScore.quant.weekend_sentiment = {
          sentiment: String(sent.sentiment || 'UNKNOWN'),
          score: Number(sent.score ?? 0),
        }
      }
      ;(finalScore as PreliminaryWithSentiment).providerFallback = (p as PreliminaryWithSentiment).providerFallback
      ;(finalScore as PreliminaryWithSentiment).cryptoMlDecision = cryptoMlDecision

      // Final Decision Gate
      const usMarketStatus = getUSMarketStatus()
      const isUSOpen = usMarketStatus.isOpen
      
      const priceModelUsd = finalScore.price
      const priceDisplayClp = priceModelUsd !== null && fxUsdClp !== null ? Math.round(priceModelUsd * fxUsdClp) : null
      
      const gateResult = evaluateFinalDecisionGate({
        symbol: p.symbol,
        market: p.market as 'US' | 'CL',
        isMarketOpen: isUSOpen,
        market_data_quality: p.marketDataQuality,
        signal_quality: finalScore.signalQuality,
        robust_backtest: finalScore.robustBacktest,
        portfolio_risk: finalScore.portfolioRisk,
        trade_execution_guard: quantData?.trade_execution_guard || null,
        data_timestamp: p.marketDataQuality?.metadata?.timestamp || new Date().toISOString(),
        data_source: p.marketDataQuality?.provider,
        
        price_model_usd: priceModelUsd,
        price_display_clp: priceDisplayClp,
        fx_usd_clp: fxUsdClp,
        price_source: p.marketDataQuality?.provider || 'unknown',
        price_timestamp: new Date().toISOString(),
        broker_symbol: p.symbol,
        model_symbol: p.symbol,
        market_data_symbol: p.symbol
      })
      
      finalScore.decisionGate = gateResult
      finalScore.decision_score = gateResult.decision_confidence
      finalScore.display_score = gateResult.decision_confidence
      
      return finalScore
    })

    const ranked = rankScreenerResults(finalResults)
    const rawPythonValues = Array.from(pythonResults.values())
    const finalBuyCount = ranked.filter(result => result.decisionGate?.final_action === 'BUY_CONFIRMED').length
    const finalSellCount = ranked.filter(result => result.decisionGate?.final_action === 'AVOID').length
    const finalHoldCount = ranked.filter(result => result.decisionGate?.final_action === 'HOLD' || result.decisionGate?.final_action === 'WATCHLIST').length
    const audit = {
      universe_requested: uniqueSymbols.length,
      quote_found: preliminaryResults.filter(result => result.price !== null).length,
      candles_usable_for_ta: preliminaryResults.filter(result => result.marketDataQuality?.usable_for_ta).length,
      candles_usable_for_ml: preliminaryResults.filter(result => result.marketDataQuality?.usable_for_ml).length,
      recent_ipo_fallback: preliminaryResults.filter(result => result.recentIpoFallback).length,
      sentiment_cache_status: sentimentCacheStatus,
      python_candidate_limit: QUANT_MAX_CANDIDATES,
      python_candidates: candidatesToAnalyze.map(candidate => candidate.symbol),
      python_candidates_count: candidatesToAnalyze.length,
      deprioritized_leveraged_or_inverse: pythonDeprioritizedPool.length,
      quant_cache_hits: quantCacheHits,
      quant_live_requests: quantLiveRequests,
      force_quant_refresh: forceQuantRefresh,
      crypto_policy_assets: preliminaryResults.filter(result => (result as PreliminaryWithSentiment).cryptoMlDecision?.isCrypto).length,
      crypto_lightgbm_allowed: preliminaryResults.filter(result => (result as PreliminaryWithSentiment).cryptoMlDecision?.lightgbmAllowed).length,
      crypto_policy_blocked_from_python: preliminaryResults.filter(result => {
        const decision = (result as PreliminaryWithSentiment).cryptoMlDecision
        return decision?.isCrypto && !decision.pythonAllowed
      }).length,
      raw_python_buy: rawPythonValues.filter(result => result.data?.action === 'BUY').length,
      raw_python_sell: rawPythonValues.filter(result => result.data?.action === 'SELL').length,
      raw_python_hold: rawPythonValues.filter(result => result.data?.action === 'HOLD').length,
      final_buy: finalBuyCount,
      final_sell: finalSellCount,
      final_hold: finalHoldCount,
    }

    return NextResponse.json({
      success: true,
      total_requested: uniqueSymbols.length,
      total_valid: preliminaryResults.filter(r => !r.noData).length,
      total_failed: preliminaryResults.filter(r => r.noData).length,
      quant_processed: pythonResults.size,
      quant_usable: Array.from(pythonResults.values()).filter(r => r.ok).length,
      quant_partial: Array.from(pythonResults.values()).filter(r => r.status === 'partial').length,
      quant_failed: Array.from(pythonResults.values()).filter(r => r.status === 'failed').length,
      scan_audit: audit,
      final_decision_audit: Object.fromEntries(
        ranked.map((result) => [result.symbol, result.decisionGate])
      ),
      provider_statuses: Object.fromEntries(
        ranked.map((result) => [
          result.symbol,
          {
            selected_provider: result.marketDataQuality?.provider,
            provider_statuses: (result.providerFallback?.provider_statuses as unknown[]) || [],
            fallback_used: Boolean(result.providerFallback?.fallback_used)
          }
        ])
      ),
      freshness_status: Object.fromEntries(
        ranked.map((result) => [
          result.symbol,
          {
            data_timestamp: result.decisionGate?.data_timestamp,
            age_minutes: result.decisionGate?.data_timestamp
              ? (Date.now() - Date.parse(result.decisionGate.data_timestamp)) / (60 * 1000)
              : null,
            is_stale: result.decisionGate?.blocking_reasons?.some((r: string) => r.includes('stale_')) || false
          }
        ])
      ),
      execution_guard: Object.fromEntries(
        ranked.map((result) => [
          result.symbol,
          result.quant?.trade_execution_guard || { status: 'ALLOWED', blocking_reasons: [] }
        ])
      ),
      validation_status: {
        model_status: ranked.length > 0 ? (ranked[0].quant?.model_status || 'unknown') : 'unknown',
        passed_validation: ranked.length > 0 ? (ranked[0].quant?.model_status !== 'weak_validation') : false
      },
      quant_diagnostics: Object.fromEntries(
        Array.from(pythonResults.entries()).map(([symbol, result]) => [
          symbol,
          {
            status: result.status,
            usable: result.ok,
            reason: result.reason,
            quantSymbol: result.quantSymbol,
          },
        ])
      ),
      market_data_quality: Object.fromEntries(
        preliminaryResults.map((result) => [
          result.symbol,
          {
            status: result.marketDataQuality?.status,
            selected_provider: result.marketDataQuality?.provider,
            fallback_used: Boolean((result as PreliminaryWithSentiment).providerFallback?.fallback_used),
            provider_statuses: ((result as PreliminaryWithSentiment).providerFallback?.provider_statuses as unknown[]) ?? [],
            usable_for_chart: result.marketDataQuality?.usable_for_chart,
            usable_for_ta: result.marketDataQuality?.usable_for_ta,
            recent_ipo_fallback: result.recentIpoFallback === true,
            indicator_mode: result.indicatorMode,
            history_candles: result.historyCandles,
            usable_for_ml: result.marketDataQuality?.usable_for_ml,
            usable_for_backtest: result.marketDataQuality?.usable_for_backtest,
            quality_score: result.marketDataQuality?.quality_score,
            recommendation: result.marketDataQuality?.recommendation,
            blocking_errors: result.marketDataQuality?.blocking_errors ?? [],
            issues: result.marketDataQuality?.issues ?? [],
            warnings: result.marketDataQuality?.warnings ?? [],
            crypto_ml_decision: (result as PreliminaryWithSentiment).cryptoMlDecision,
          },
        ])
      ),
      results: ranked
    })

  } catch (error: unknown) {
    console.error('[Quant Scan] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
