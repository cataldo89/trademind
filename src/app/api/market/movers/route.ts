/**
 * Market Movers API Route with cache and basic rate limiting.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Market, MarketMover } from '@/types'
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit'
import { getCached } from '@/lib/api/memory-cache'

const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000
const MOVERS_TTL_MS = 5 * 60_000
const YAHOO_SCREENER_URL = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved'

type YahooScreenerQuote = Record<string, unknown>

async function fetchYahooScreener(scrId: string): Promise<YahooScreenerQuote[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)

  try {
    const url = `${YAHOO_SCREENER_URL}?scrIds=${encodeURIComponent(scrId)}&count=10`
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TradeMind/1.0',
      },
      next: { revalidate: 300 },
    })

    if (!response.ok) return []

    const body = await response.json()
    return body?.finance?.result?.[0]?.quotes || []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

function parseMovers(quotes: YahooScreenerQuote[]): MarketMover[] {
  return quotes
    .map((quote) => ({
      symbol: String(quote.symbol || ''),
      name: String(quote.longName || quote.shortName || quote.displayName || quote.symbol || ''),
      price: Number(quote.regularMarketPrice ?? quote.intradayprice) || 0,
      change: Number(quote.regularMarketChange ?? quote.intradaypricechange) || 0,
      changePercent: Number(quote.regularMarketChangePercent ?? quote.percentchange) || 0,
      volume: Number(quote.regularMarketVolume ?? quote.dayvolume) || 0,
      market: 'US' as Market,
    }))
    .filter((mover) => mover.symbol && Number.isFinite(mover.price) && mover.price > 0)
}

async function fetchUsMovers() {
  const [gainersRaw, losersRaw, activeRaw] = await Promise.all([
    fetchYahooScreener('day_gainers'),
    fetchYahooScreener('day_losers'),
    fetchYahooScreener('most_actives'),
  ])

  return {
    gainers: parseMovers(gainersRaw),
    losers: parseMovers(losersRaw),
    mostActive: parseMovers(activeRaw),
  }
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit(`market:movers:${getClientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many movers requests' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const market = (searchParams.get('market') || 'US') as Market

  if (market !== 'US') {
    return NextResponse.json({ error: 'Unsupported market' }, { status: 400 })
  }

  try {
    const data = await getCached('movers:US', MOVERS_TTL_MS, fetchUsMovers)

    return NextResponse.json({ data }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'X-RateLimit-Remaining': String(rate.remaining),
      },
    })
  } catch (error) {
    console.error('[API/movers] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch market movers' }, { status: 500 })
  }
}
