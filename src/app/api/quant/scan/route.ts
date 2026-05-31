import { NextRequest, NextResponse } from 'next/server'
import { yahooFinance } from '@/lib/yahoo-finance'
import { getCached } from '@/lib/api/memory-cache'
import { QuantClient } from '@/lib/ai/quant-client'
import { getYahooSymbol, getZestySymbolMarket } from '@/lib/market-data'
import { calculatePreliminaryScore, calculateFinalQuantScore, rankScreenerResults, PreliminaryTechData, QuantResultData } from '@/lib/ranking'
import type { Candle } from '@/types'

const MAX_SYMBOLS = 500
const YAHOO_CONCURRENCY = 10

const QUANT_MAX_CANDIDATES = parseInt(process.env.QUANT_MAX_CANDIDATES || '20', 10)
const QUANT_CONCURRENCY = parseInt(process.env.QUANT_CONCURRENCY || '4', 10)
const CACHE_TTL_MS = 60 * 1000 // 1 minute

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
}

function classifyPythonResult(data: QuantResultData | null): Pick<PythonResultRecord, 'ok' | 'status' | 'reason'> {
  if (!data) {
    return { ok: false, status: 'failed', reason: 'Quant engine did not return workflow_result' }
  }

  const action = String(data.action || '').toUpperCase()
  const confidence = Number(data.confidence ?? 0)
  const regime = String(data.market_regime || '').toLowerCase()
  const explanation = String(data.xai_explanation || data.error_reason || '')
  const hasDataFetchError = /error fetching data|fallo al obtener datos|datos insuficientes|incompleto/i.test(explanation)
  const unknownRegime = !regime || regime === 'unknown' || regime.includes('desconocido')

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
  const chunkSize = 50
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize)
    try {
      const response = await yahooFinance.quote(chunk, {}, { validateResult: false })
      const arr = Array.isArray(response) ? response : (response ? [response] : [])
      for (const q of arr as QuoteLike[]) {
        if (q && q.symbol) quotes.set(q.symbol, q)
      }
    } catch (e) {
      console.error(`[Quant Scan] Batch quote error for chunk:`, e)
      // Fallback to individual
      await Promise.all(chunk.map(async (sym) => {
        try {
          const q = await yahooFinance.quote(sym, {}, { validateResult: false })
          if (q) quotes.set(sym, q)
        } catch {
          // Keep scanning the rest of the batch when a single quote fails.
        }
      }))
    }
  }
  return quotes
}

async function fetchCandles(symbol: string): Promise<Candle[]> {
  try {
    const period1 = new Date()
    period1.setDate(period1.getDate() - 365) // 1Y
    const res = await yahooFinance.chart(symbol, { interval: '1d', period1 }) as ChartLike
    const rawQuotes = res.quotes || res.indicators?.quote?.[0] || []
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
  } catch {
    return []
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const symbolsInput: string[] = Array.isArray(body.symbols) ? body.symbols : []
    const category: string = body.category || 'unknown'
    const market: string = body.market || 'US'
    const symbolMap = body.symbolMap || {} // Optional: { "AAPL": "Apple Inc." }
    const symbolMarkets: Record<string, 'US' | 'CL'> = body.symbolMarkets || {}

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
    const quotesMap = await getCached(`scan:quotes:${yahooSymbols.join(',')}`, CACHE_TTL_MS, async () => {
      return fetchBatchQuotes(yahooSymbols)
    })

    // Step 2: Fetch Candles with Concurrency
    const candlesMap = new Map<string, Candle[]>()
    await getCached(`scan:candles:${yahooSymbols.join(',')}`, CACHE_TTL_MS, async () => {
      let active = 0
      let index = 0
      await new Promise<void>((resolve) => {
        const next = async () => {
          if (index >= yahooSymbols.length) {
            if (active === 0) resolve()
            return
          }
          const sym = yahooSymbols[index++]
          active++
          const candles = await fetchCandles(sym)
          candlesMap.set(sym, candles)
          active--
          next()
        }
        for (let i = 0; i < YAHOO_CONCURRENCY && i < yahooSymbols.length; i++) next()
      })
      return true
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
      const c = candlesMap.get(ySym) || []
      const originalMarket = symbolMarkets[original] || getZestySymbolMarket(original) || market
      
      const quoteData = {
        price: Number(q?.regularMarketPrice ?? q?.regularMarketPreviousClose ?? null),
        changePercent: Number(q?.regularMarketChangePercent ?? null),
        volume: Number(q?.regularMarketVolume ?? null)
      }
      
      const name = symbolMap[original] || q?.shortName || q?.longName || original

      const prelim = calculatePreliminaryScore(original, name, originalMarket, category, c, quoteData)
      
      // Inject Sentiment
      const sent = sentimentCache[original] || sentimentCache[ySym] || sentimentCache[ySym.toUpperCase()]
      if (sent) {
        prelim.score += (Number(sent.score ?? 0) * 5) // +5 per sentiment score unit
        prelim.score = Math.max(0, Math.min(100, prelim.score))
        // We attach it to prelim or wait for final? 
        // We'll attach it to prelim as suggestions
        if (sent.sentiment === 'POSITIVE') prelim.suggestions.push({ type: 'opportunity', label: 'Noticias Positivas (FinBERT)' })
        if (sent.sentiment === 'NEGATIVE') prelim.suggestions.push({ type: 'warning', label: 'Noticias Negativas (FinBERT)' })
        
        // Also store it for later
        ;(prelim as PreliminaryWithSentiment)._sentiment = sent
      }

      preliminaryResults.push(prelim)
    }

    // Step 4: Sort and pick Top Candidates for Python
    preliminaryResults.sort((a, b) => b.score - a.score)
    const topCandidates = preliminaryResults.slice(0, QUANT_MAX_CANDIDATES)
    const pythonResults = new Map<string, PythonResultRecord>()
    
    console.log(`[Quant Scan] Running Python analysis for Top ${topCandidates.length} candidates with concurrency ${QUANT_CONCURRENCY}...`)
    
    // Step 5: Run Python Analysis Concurrently
    let activeQuant = 0
    let quantIndex = 0
    await new Promise<void>((resolve) => {
      const next = async () => {
        if (quantIndex >= topCandidates.length) {
          if (activeQuant === 0) resolve()
          return
        }
        const candidate = topCandidates[quantIndex++]
        activeQuant++
        try {
          const candidateMarket = (candidate.market === 'CL' || candidate.market === 'US')
            ? candidate.market
            : getZestySymbolMarket(candidate.symbol)
          const quantSymbol = getYahooSymbol(candidate.symbol, candidateMarket)
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
      for (let i = 0; i < QUANT_CONCURRENCY && i < topCandidates.length; i++) next()
    })

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
      return finalScore
    })

    const ranked = rankScreenerResults(finalResults)

    return NextResponse.json({
      success: true,
      total_requested: uniqueSymbols.length,
      total_valid: preliminaryResults.filter(r => !r.noData).length,
      total_failed: preliminaryResults.filter(r => r.noData).length,
      quant_processed: pythonResults.size,
      quant_usable: Array.from(pythonResults.values()).filter(r => r.ok).length,
      quant_partial: Array.from(pythonResults.values()).filter(r => r.status === 'partial').length,
      quant_failed: Array.from(pythonResults.values()).filter(r => r.status === 'failed').length,
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
      results: ranked
    })

  } catch (error: unknown) {
    console.error('[Quant Scan] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
