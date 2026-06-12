import { NextRequest, NextResponse } from 'next/server'
import { quantClient } from '@/lib/ai/quant-client'
import { getYahooSymbol, getZestySymbolMarket } from '@/lib/market-data'

const MAX_SENTIMENT_SCAN_SYMBOLS = Number(process.env.SENTIMENT_SCAN_MAX_SYMBOLS || 5)
const SENTIMENT_SCAN_BATCH_SIZE = Number(process.env.SENTIMENT_SCAN_BATCH_SIZE || 5)
const DEFAULT_CACHE_FRESHNESS_MS = Number(process.env.SENTIMENT_CACHE_FRESHNESS_MS || 12 * 60 * 60 * 1000)

function isFreshCachedSentiment(value: unknown, freshnessMs: number) {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { sentiment?: unknown; timestamp?: unknown; updated_at?: unknown; asOf?: unknown }
  if (typeof candidate.sentiment !== 'string') return false

  const rawTimestamp = candidate.timestamp || candidate.updated_at || candidate.asOf
  if (!rawTimestamp) return true

  const timestamp = typeof rawTimestamp === 'number'
    ? rawTimestamp
    : Date.parse(String(rawTimestamp))

  if (!Number.isFinite(timestamp)) return true
  return Date.now() - timestamp < freshnessMs
}

function chunkSymbols(symbols: string[], batchSize: number) {
  const safeBatchSize = Math.max(1, Math.min(batchSize, MAX_SENTIMENT_SCAN_SYMBOLS))
  const chunks: string[][] = []
  for (let index = 0; index < symbols.length; index += safeBatchSize) {
    chunks.push(symbols.slice(index, index + safeBatchSize))
  }
  return chunks
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const symbolsInput: unknown[] = Array.isArray(body.symbols) ? body.symbols : []
    const normalizedSymbols = symbolsInput.reduce<string[]>((acc, symbol) => {
      if (typeof symbol !== 'string') return acc
      const normalized = symbol.trim().toUpperCase()
      if (normalized) acc.push(normalized)
      return acc
    }, [])
    const symbols = Array.from(new Set(normalizedSymbols))
    const freshnessMs = typeof body.freshnessMs === 'number' && Number.isFinite(body.freshnessMs) && body.freshnessMs > 0
      ? Math.min(body.freshnessMs, 24 * 60 * 60 * 1000)
      : DEFAULT_CACHE_FRESHNESS_MS
    const force = body.force === true
    
    if (!symbols.length) {
      return NextResponse.json({ error: 'No symbols provided' }, { status: 400 })
    }

    const quantSymbols = Array.from(new Set(symbols.map((symbol) => getYahooSymbol(symbol, getZestySymbolMarket(symbol)))))
    const cacheRes = await quantClient.getSentimentCache()
    const cache = cacheRes.success && cacheRes.data && typeof cacheRes.data === 'object'
      ? cacheRes.data as Record<string, unknown>
      : {}
    const missingOrStaleSymbols = force
      ? quantSymbols
      : quantSymbols.filter((symbol) => !isFreshCachedSentiment(cache[symbol] || cache[symbol.toUpperCase()], freshnessMs))
    const limitedSymbols = missingOrStaleSymbols.slice(0, MAX_SENTIMENT_SCAN_SYMBOLS)

    if (limitedSymbols.length === 0) {
      return NextResponse.json({
        success: true,
        requested: symbols.length,
        processed: 0,
        skippedCached: quantSymbols.length,
        freshnessMs,
        refreshedRanking: true,
        truncated: false,
        limit: MAX_SENTIMENT_SCAN_SYMBOLS,
        symbols,
        quantSymbols: [],
      })
    }

    let processed = 0
    const warnings: string[] = []

    for (const batch of chunkSymbols(limitedSymbols, SENTIMENT_SCAN_BATCH_SIZE)) {
      const res = await quantClient.triggerSentimentScan(batch)

      if (!res.success) {
        warnings.push(res.error || 'Quant engine unavailable; sentiment scan skipped')
        continue
      }

      processed += res.data?.processed ?? batch.length
    }

    if (processed === 0) {
      return NextResponse.json({
        success: true,
        degraded: true,
        requested: symbols.length,
        processed: 0,
        skippedCached: quantSymbols.length - missingOrStaleSymbols.length,
        freshnessMs,
        refreshedRanking: false,
        truncated: missingOrStaleSymbols.length > limitedSymbols.length,
        limit: MAX_SENTIMENT_SCAN_SYMBOLS,
        symbols,
        quantSymbols: limitedSymbols,
        warning: warnings[0] || 'Quant engine unavailable; sentiment scan skipped',
      })
    }

    return NextResponse.json({
      success: true,
      requested: symbols.length,
      processed,
      skippedCached: quantSymbols.length - missingOrStaleSymbols.length,
      freshnessMs,
      refreshedRanking: true,
      truncated: missingOrStaleSymbols.length > limitedSymbols.length,
      limit: MAX_SENTIMENT_SCAN_SYMBOLS,
      symbols,
      quantSymbols: limitedSymbols,
      degraded: warnings.length > 0,
      warning: warnings[0],
    })
  } catch (error: unknown) {
    console.error('[API/Quant/Sentiment] Error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
