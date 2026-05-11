/**
 * Market Movers API Route with cache and basic rate limiting.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Market, MarketMover } from '@/types'
import { yahooFinance } from '@/lib/yahoo-finance'
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit'
import { getCached } from '@/lib/api/memory-cache'

const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000
const MOVERS_TTL_MS = 5 * 60_000

async function fetchUsMovers() {
  const [gainersRaw, losersRaw, activeRaw] = await Promise.allSettled([
    yahooFinance.screener({ scrIds: 'day_gainers', count: 10 }),
    yahooFinance.screener({ scrIds: 'day_losers', count: 10 }),
    yahooFinance.screener({ scrIds: 'most_actives', count: 10 }),
  ])

  const parse = (result: PromiseSettledResult<{ quotes: unknown[] }>): MarketMover[] => {
    if (result.status === 'rejected' || !result.value?.quotes) return []
    return result.value.quotes.map((q: unknown) => {
      const quote = q as Record<string, unknown>
      return {
        symbol: String(quote.symbol || ''),
        name: String(quote.longName || quote.shortName || quote.symbol || ''),
        price: Number(quote.regularMarketPrice) || 0,
        change: Number(quote.regularMarketChange) || 0,
        changePercent: Number(quote.regularMarketChangePercent) || 0,
        volume: Number(quote.regularMarketVolume) || 0,
        market: 'US' as Market,
      }
    })
  }

  return {
    gainers: parse(gainersRaw as PromiseSettledResult<{ quotes: unknown[] }>),
    losers: parse(losersRaw as PromiseSettledResult<{ quotes: unknown[] }>),
    mostActive: parse(activeRaw as PromiseSettledResult<{ quotes: unknown[] }>),
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