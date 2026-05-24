import { NextRequest, NextResponse } from 'next/server'
import { yahooFinance } from '@/lib/yahoo-finance'
import { getCached } from '@/lib/api/memory-cache'
import { QuantClient } from '@/lib/ai/quant-client'
import { calculatePreliminaryScore, calculateFinalQuantScore, rankScreenerResults, PreliminaryTechData, QuantResultData } from '@/lib/ranking'

const MAX_SYMBOLS = 500
const YAHOO_CONCURRENCY = 10

const QUANT_MAX_CANDIDATES = parseInt(process.env.QUANT_MAX_CANDIDATES || '20', 10)
const QUANT_CONCURRENCY = parseInt(process.env.QUANT_CONCURRENCY || '4', 10)
const CACHE_TTL_MS = 60 * 1000 // 1 minute

async function fetchBatchQuotes(symbols: string[]) {
  const quotes = new Map<string, any>()
  const chunkSize = 50
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize)
    try {
      const response = await yahooFinance.quote(chunk, {}, { validateResult: false })
      const arr = Array.isArray(response) ? response : (response ? [response] : [])
      for (const q of arr) {
        if (q && q.symbol) quotes.set(q.symbol, q)
      }
    } catch (e) {
      console.error(`[Quant Scan] Batch quote error for chunk:`, e)
      // Fallback to individual
      await Promise.all(chunk.map(async (sym) => {
        try {
          const q = await yahooFinance.quote(sym, {}, { validateResult: false })
          if (q) quotes.set(sym, q)
        } catch (err) {}
      }))
    }
  }
  return quotes
}

async function fetchCandles(symbol: string) {
  try {
    const period1 = new Date()
    period1.setDate(period1.getDate() - 365) // 1Y
    const res = await yahooFinance.chart(symbol, { interval: '1d', period1 })
    const rawQuotes = res.quotes || (res as any).indicators?.quote?.[0] || []
    return rawQuotes.map((q: any, i: number) => {
      let time = 0
      if (q.date) time = Math.floor(new Date(q.date).getTime() / 1000)
      else if ((res as any).timestamp?.[i]) time = (res as any).timestamp[i]
      return {
        time,
        open: Number(q.open),
        high: Number(q.high),
        low: Number(q.low),
        close: Number(q.close),
        volume: Number(q.volume)
      }
    }).filter((c: any) => c.close > 0)
  } catch (e) {
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

    if (!symbolsInput.length) {
      return NextResponse.json({ error: 'No symbols provided' }, { status: 400 })
    }

    const uniqueSymbols = Array.from(new Set(symbolsInput)).slice(0, MAX_SYMBOLS)
    
    // Normalize symbols for Yahoo (e.g. BRK.B -> BRK-B)
    const yahooToOriginal = new Map<string, string>()
    const yahooSymbols = uniqueSymbols.map(sym => {
      const ySym = sym.replace('.', '-')
      yahooToOriginal.set(ySym.toUpperCase(), sym)
      return ySym
    })

    console.log(`[Quant Scan] Requested ${yahooSymbols.length} symbols. Pre-filtering...`)

    // Step 1: Batch Quotes
    const quotesMap = await getCached(`scan:quotes:${yahooSymbols.join(',')}`, CACHE_TTL_MS, async () => {
      return fetchBatchQuotes(yahooSymbols)
    })

    // Step 2: Fetch Candles with Concurrency
    const candlesMap = new Map<string, any[]>()
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
    
    for (const ySym of yahooSymbols) {
      const original = yahooToOriginal.get(ySym.toUpperCase()) || ySym
      const q = quotesMap.get(ySym) || quotesMap.get(ySym.toUpperCase())
      const c = candlesMap.get(ySym) || []
      
      const quoteData = {
        price: Number(q?.regularMarketPrice ?? q?.regularMarketPreviousClose ?? null),
        changePercent: Number(q?.regularMarketChangePercent ?? null),
        volume: Number(q?.regularMarketVolume ?? null)
      }
      
      const name = symbolMap[original] || q?.shortName || q?.longName || original

      const prelim = calculatePreliminaryScore(original, name, market, category, c, quoteData)
      preliminaryResults.push(prelim)
    }

    // Step 4: Sort and pick Top Candidates for Python
    preliminaryResults.sort((a, b) => b.score - a.score)
    const topCandidates = preliminaryResults.slice(0, QUANT_MAX_CANDIDATES)
    const pythonResults = new Map<string, QuantResultData | null>()
    
    console.log(`[Quant Scan] Running Python analysis for Top ${topCandidates.length} candidates with concurrency ${QUANT_CONCURRENCY}...`)
    
    // Step 5: Run Python Analysis Concurrently
    const client = new QuantClient()
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
          const res = await client.runWorkflow(candidate.symbol)
          if (res.success && res.data?.workflow_result) {
             pythonResults.set(candidate.symbol, res.data.workflow_result as QuantResultData)
          } else {
             pythonResults.set(candidate.symbol, null)
          }
        } catch (e) {
          pythonResults.set(candidate.symbol, null)
        }
        activeQuant--
        next()
      }
      for (let i = 0; i < QUANT_CONCURRENCY && i < topCandidates.length; i++) next()
    })

    // Step 6: Final Ranking
    const finalResults = preliminaryResults.map(p => {
      const isTopCandidate = topCandidates.some(t => t.symbol === p.symbol)
      const quantData = isTopCandidate ? (pythonResults.get(p.symbol) || null) : null
      const isFallback = isTopCandidate ? (quantData === null) : true
      
      return calculateFinalQuantScore(p, quantData, isFallback)
    })

    const ranked = rankScreenerResults(finalResults)

    return NextResponse.json({
      success: true,
      total_requested: uniqueSymbols.length,
      total_valid: preliminaryResults.filter(r => !r.noData).length,
      total_failed: preliminaryResults.filter(r => r.noData).length,
      quant_processed: pythonResults.size,
      results: ranked
    })

  } catch (error: any) {
    console.error('[Quant Scan] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
