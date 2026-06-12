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
import { calculatePreliminaryScore, calculateFinalQuantScore, rankScreenerResults, PreliminaryTechData, QuantResultData } from '@/lib/ranking'
import { assessMarketDataQuality, type MarketDataQualityResult } from '@/lib/market-data-quality'
import { normalizeHistoricalData } from '@/lib/historical-data-normalizer'
import type { Candle } from '@/types'
import { getDurableMarketData, readQuantResultsCache, writeQuantResultsCache } from '@/lib/api/market-data-cache'

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

type ScanProvider = 'finnhub' | 'alpha-vantage' | 'yahoo'

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

async function fetchBatchQuotes(symbols: string[]) {
  const quotes = new Map<string, QuoteLike>()
  const yahooSymbols: string[] = []

  await Promise.all(symbols.map(async (symbol) => {
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

async function fetchCandles(symbol: string, market: 'US' | 'CL' = 'US'): Promise<Candle[]> {
  try {
    return await getDurableMarketData<Candle[]>({
      symbol,
      market,
      range: '1y',
      ttlMs: 4 * 60 * 60 * 1000, // 4 hours TTL
      provider: 'configured-market-data',
      loader: async () => {
        if (market === 'US') {
          const configured = await fetchConfiguredDailyCandles(symbol)
          if (configured) {
            scanCandleProviders.set(symbol.toUpperCase(), configured.provider)
            return configured.candles
          }
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
      const fetchedQuotes = await fetchBatchQuotes(symbolsToFetchQuote)
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
          candles = await fetchCandles(sym, safeMarket)
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

    for (const ySym of yahooSymbols) {
      const original = yahooToOriginal.get(ySym.toUpperCase()) || ySym
      const q = quotesMap.get(ySym) || quotesMap.get(ySym.toUpperCase())
      let c = candlesMap.get(ySym) || []
      const originalMarket = symbolMarkets[original] || getZestySymbolMarket(original) || market
      const selectedProvider = scanCandleProviders.get(ySym.toUpperCase()) || 'configured-market-data'
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
      let providerFallback: Record<string, unknown> | undefined
      
      const quoteData = {
        price: Number(q?.regularMarketPrice ?? q?.regularMarketPreviousClose ?? null),
        changePercent: Number(q?.regularMarketChangePercent ?? null),
        volume: Number(q?.regularMarketVolume ?? null)
      }
      
      const name = symbolMap[original] || q?.shortName || q?.longName || original

      const prelim = calculatePreliminaryScore(original, name, originalMarket, category, quality.usable_for_ta ? c : [], quoteData)
      prelim.marketDataQuality = quality
      ;(prelim as PreliminaryWithSentiment).providerFallback = providerFallback || {
        selected_provider: selectedProvider,
        fallback_used: false,
      }
      if (!quality.usable_for_ml) {
        prelim.suggestions = prelim.suggestions.filter((suggestion) => suggestion.type !== 'opportunity')
      }
      if (!quality.usable_for_ta) {
        prelim.noData = true
        prelim.suggestions.push({
          type: 'warning',
          label: quality.usable_for_chart ? 'Solo grafico' : 'Datos insuficientes',
        })
      }
      
      // Inject Sentiment
      const sent = sentimentCache[original] || sentimentCache[ySym] || sentimentCache[ySym.toUpperCase()]
      if (sent) {
        prelim.score += (Number(sent.score ?? 0) * 5) // +5 per sentiment score unit
        prelim.score = Math.max(0, Math.min(100, prelim.score))
        // We attach it to prelim or wait for final? 
        // We'll attach it to prelim as suggestions
        if (quality.usable_for_ml && sent.sentiment === 'POSITIVE') prelim.suggestions.push({ type: 'opportunity', label: 'Noticias Positivas (FinBERT)' })
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
        const needsProviderCheck = Boolean(candidate.marketDataQuality) &&
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
    const candidatesToAnalyze = topCandidates.filter(candidate => candidate.marketDataQuality?.usable_for_ml && candidate.marketDataQuality.quality_score >= 60)
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
      const quantData = pythonRecord?.data || null
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
      return finalScore
    })

    const ranked = rankScreenerResults(finalResults)
    const rawPythonValues = Array.from(pythonResults.values())
    const finalBuyCount = ranked.filter(result => result.signalQuality?.final_action === 'BUY').length
    const finalSellCount = ranked.filter(result => result.signalQuality?.final_action === 'SELL').length
    const finalHoldCount = ranked.filter(result => result.signalQuality?.final_action === 'HOLD').length
    const audit = {
      universe_requested: uniqueSymbols.length,
      quote_found: preliminaryResults.filter(result => result.price !== null).length,
      candles_usable_for_ta: preliminaryResults.filter(result => result.marketDataQuality?.usable_for_ta).length,
      candles_usable_for_ml: preliminaryResults.filter(result => result.marketDataQuality?.usable_for_ml).length,
      python_candidate_limit: QUANT_MAX_CANDIDATES,
      python_candidates: candidatesToAnalyze.map(candidate => candidate.symbol),
      python_candidates_count: candidatesToAnalyze.length,
      deprioritized_leveraged_or_inverse: pythonDeprioritizedPool.length,
      quant_cache_hits: quantCacheHits,
      quant_live_requests: quantLiveRequests,
      force_quant_refresh: forceQuantRefresh,
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
            usable_for_ml: result.marketDataQuality?.usable_for_ml,
            usable_for_backtest: result.marketDataQuality?.usable_for_backtest,
            quality_score: result.marketDataQuality?.quality_score,
            recommendation: result.marketDataQuality?.recommendation,
            blocking_errors: result.marketDataQuality?.blocking_errors ?? [],
            issues: result.marketDataQuality?.issues ?? [],
            warnings: result.marketDataQuality?.warnings ?? [],
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
