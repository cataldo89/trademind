/**
 * Market quote proxy - configured paid/free APIs first, Yahoo Finance as fallback.
 */

import { NextRequest, NextResponse } from 'next/server'
import { yahooFinance } from '@/lib/yahoo-finance'
import { fetchAlphaVantageQuote, fetchFinnhubQuote, getYahooSymbol } from '@/lib/market-data'
import { normalizeSymbol, parseMarketOrLegacy } from '@/lib/domain/market'
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit'
import { getCached } from '@/lib/api/memory-cache'
import type { Market, Quote } from '@/types'

const MAX_SYMBOLS = 50
const RATE_LIMIT = 120
const RATE_WINDOW_MS = 60_000
const QUOTE_TTL_MS = 30_000

type YahooQuote = Record<string, unknown>
type QuoteProvider = 'finnhub' | 'alpha-vantage' | 'yahoo'

function normalizeQuote(quote: YahooQuote, market: string, originalSymbol?: string) {
  return {
    symbol: originalSymbol || String(quote.symbol || ''),
    name: String(quote.longName || quote.shortName || quote.symbol || ''),
    price: Number(quote.regularMarketPrice ?? quote.regularMarketPreviousClose ?? 0),
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

type NormalizedQuote = ReturnType<typeof normalizeQuote> & { provider?: QuoteProvider }

function isConfiguredProviderSupported(symbol: string, market: Market) {
  return market === 'US' && !/-USD$/i.test(symbol)
}

function providerOrder(): QuoteProvider[] {
  const configured = (process.env.MARKET_DATA_QUOTE_PROVIDER_ORDER || 'finnhub,alpha-vantage,yahoo')
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is QuoteProvider => ['finnhub', 'alpha-vantage', 'yahoo'].includes(provider))

  return Array.from(new Set(configured.length > 0 ? configured : ['finnhub', 'alpha-vantage', 'yahoo']))
}

function normalizeProviderQuote(quote: Quote, market: Market, originalSymbol: string, provider: QuoteProvider) {
  return {
    ...quote,
    symbol: originalSymbol,
    market,
    provider,
  }
}

async function fetchConfiguredQuote(symbol: string, market: Market): Promise<(Quote & { provider: QuoteProvider }) | null> {
  if (!isConfiguredProviderSupported(symbol, market)) return null

  for (const provider of providerOrder()) {
    if (provider === 'yahoo') continue

    try {
      if (provider === 'finnhub' && process.env.FINNHUB_API_KEY) {
        const quote = await fetchFinnhubQuote(symbol, process.env.FINNHUB_API_KEY)
        if (quote) return normalizeProviderQuote(quote, market, symbol, provider)
      }

      if (provider === 'alpha-vantage' && process.env.ALPHA_VANTAGE_API_KEY) {
        const quote = await fetchAlphaVantageQuote(symbol, process.env.ALPHA_VANTAGE_API_KEY)
        if (quote) return normalizeProviderQuote(quote, market, symbol, provider)
      }
    } catch (error) {
      console.warn(`[Market Quote] ${provider} failed for ${symbol}:`, error)
    }
  }

  return null
}

async function fetchYahooQuotes(symbols: string[]) {
  const quotes: YahooQuote[] = []

  if (symbols.length === 1) {
    try {
      const quote = await yahooFinance.quote(symbols[0], {}, { validateResult: false }) as YahooQuote | null
      return quote ? [quote] : []
    } catch (error) {
      console.error(`[Yahoo Finance] Error fetching single quote for ${symbols[0]}:`, error)
      return []
    }
  }

  for (let i = 0; i < symbols.length; i += MAX_SYMBOLS) {
    const chunk = symbols.slice(i, i + MAX_SYMBOLS)
    try {
      const response = await yahooFinance.quote(chunk, {}, { validateResult: false }) as YahooQuote[] | YahooQuote | null
      if (Array.isArray(response)) quotes.push(...response)
      else if (response) quotes.push(response)
    } catch (error) {
      console.error(`[Yahoo Finance] Error fetching batch quotes for chunk ${chunk.join(', ')}:`, error)
      const settled = await Promise.allSettled(chunk.map(async (symbol) => {
        try {
          return await yahooFinance.quote(symbol, {}, { validateResult: false }) as YahooQuote | null
        } catch (individualError) {
          console.error(`[Yahoo Finance] Error fetching individual quote for ${symbol} as fallback:`, individualError)
          return null
        }
      }))
      settled.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) quotes.push(result.value)
      })
    }
  }

  return quotes
}

async function fetchQuotes(symbols: string[], market: Market, symbolMap: Map<string, string>) {
  const results: Array<NormalizedQuote | (Quote & { provider: QuoteProvider })> = []
  const yahooSymbolsToFetch: string[] = []

  for (const symbol of symbols) {
    const configuredQuote = await fetchConfiguredQuote(symbol, market)
    if (configuredQuote) {
      results.push(configuredQuote)
      continue
    }

    yahooSymbolsToFetch.push(getYahooSymbol(symbol, market))
  }

  if (yahooSymbolsToFetch.length > 0) {
    const yahooQuotes = await fetchYahooQuotes(yahooSymbolsToFetch)
    for (const quote of yahooQuotes) {
      const qSymbol = String(quote.symbol || '').toUpperCase()
      const originalSymbol = symbolMap.get(qSymbol)
      results.push({ ...normalizeQuote(quote, market, originalSymbol), provider: 'yahoo' })
    }
  }

  return results
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit(`market:quote:${getClientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many quote requests' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const symbolParam = searchParams.get('symbol') || searchParams.get('symbols')
  const firstSymbol = symbolParam?.split(',')[0]
  const market = parseMarketOrLegacy(searchParams.get('market'), firstSymbol)

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
    const symbolMap = new Map<string, string>()
    const yahooSymbols = symbols.map(s => {
      const yahooSymbol = getYahooSymbol(s, market)
      symbolMap.set(yahooSymbol.toUpperCase(), s)
      return yahooSymbol
    })

    const cacheKey = `quotes:v2:${market}:${symbols.slice().sort().join(',')}`
    const quotes = await getCached(cacheKey, QUOTE_TTL_MS, () => fetchQuotes(symbols, market, symbolMap))

    if (!quotes || quotes.length === 0) {
      return NextResponse.json({ error: 'Symbol not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: symbols.length === 1 ? quotes[0] : quotes,
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
