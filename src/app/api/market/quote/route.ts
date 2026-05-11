/**
 * Yahoo Finance Proxy - batched quotes with validation, cache and basic rate limit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { yahooFinance } from '@/lib/yahoo-finance'
import { normalizeSymbol, parseMarketOrLegacy } from '@/lib/domain/market'
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit'
import { getCached } from '@/lib/api/memory-cache'

const MAX_SYMBOLS = 50
const RATE_LIMIT = 120
const RATE_WINDOW_MS = 60_000
const QUOTE_TTL_MS = 30_000

type YahooQuote = Record<string, unknown>

function normalizeQuote(quote: YahooQuote, market: string) {
  return {
    symbol: String(quote.symbol || ''),
    name: String(quote.longName || quote.shortName || quote.symbol || ''),
    price: Number(quote.regularMarketPrice ?? 0),
    previousClose: Number(quote.regularMarketPreviousClose ?? 0),
    change: Number(quote.regularMarketChange ?? 0),
    changePercent: Number(quote.regularMarketChangePercent ?? 0),
    volume: Number(quote.regularMarketVolume ?? 0),
    avgVolume: Number(quote.averageDailyVolume3Month ?? 0),
    high: Number(quote.regularMarketDayHigh ?? 0),
    low: Number(quote.regularMarketDayLow ?? 0),
    open: Number(quote.regularMarketOpen ?? 0),
    marketCap: quote.marketCap ?? null,
    pe: quote.trailingPE ?? null,
    exchange: String(quote.fullExchangeName || quote.exchange || ''),
    market,
    currency: String(quote.currency || 'USD'),
    timestamp: Date.now(),
  }
}

async function fetchYahooQuotes(symbols: string[]) {
  const quotes: YahooQuote[] = []

  if (symbols.length === 1) {
    const quote = await yahooFinance.quote(symbols[0]) as YahooQuote | null
    return quote ? [quote] : []
  }

  for (let i = 0; i < symbols.length; i += MAX_SYMBOLS) {
    const chunk = symbols.slice(i, i + MAX_SYMBOLS)
    try {
      const response = await yahooFinance.quote(chunk) as YahooQuote[] | YahooQuote | null
      if (Array.isArray(response)) quotes.push(...response)
      else if (response) quotes.push(response)
    } catch {
      const settled = await Promise.allSettled(chunk.map((symbol) => yahooFinance.quote(symbol) as Promise<YahooQuote | null>))
      settled.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) quotes.push(result.value)
      })
    }
  }

  return quotes
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit(`market:quote:${getClientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many quote requests' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const symbolParam = searchParams.get('symbol') || searchParams.get('symbols')
  const market = parseMarketOrLegacy(searchParams.get('market'))

  if (!symbolParam) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 })
  }

  if (!market) {
    return NextResponse.json({ error: 'Invalid market. Use US or CL.' }, { status: 400 })
  }

  const symbols = Array.from(new Set(symbolParam.split(',').map((symbol) => normalizeSymbol(symbol)).filter((symbol): symbol is string => Boolean(symbol))))

  if (symbols.length === 0) {
    return NextResponse.json({ error: 'Valid symbol is required' }, { status: 400 })
  }

  if (symbols.length > MAX_SYMBOLS) {
    return NextResponse.json({ error: `A maximum of ${MAX_SYMBOLS} symbols is allowed per request` }, { status: 400 })
  }

  try {
    const cacheKey = `quotes:${market}:${symbols.slice().sort().join(',')}`
    const quotes = await getCached(cacheKey, QUOTE_TTL_MS, () => fetchYahooQuotes(symbols))

    if (!quotes || quotes.length === 0) {
      return NextResponse.json({ error: 'Symbol not found' }, { status: 404 })
    }

    const results = quotes.map((quote) => normalizeQuote(quote, market))

    return NextResponse.json({
      data: symbols.length === 1 ? results[0] : results,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        'X-RateLimit-Remaining': String(rate.remaining),
      },
    })
  } catch (error) {
    console.error('[API/quote] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch quote' }, { status: 500 })
  }
}