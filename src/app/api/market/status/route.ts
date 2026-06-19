import { NextRequest, NextResponse } from 'next/server'
import { yahooFinance } from '@/lib/yahoo-finance'
import { getCached } from '@/lib/api/memory-cache'
import { getUSMarketStatus, getCLMarketStatus } from '@/lib/market-schedule'
import type { Market, MarketStatus } from '@/types'

const STATUS_TTL_MS = 30_000 // 30 seconds server-side cache

const MARKETS = {
  US: {
    ticker: 'SPY',
    timezone: 'America/New_York',
    fallback: getUSMarketStatus,
  },
  CL: {
    ticker: 'CHILE.SN',
    timezone: 'America/Santiago',
    fallback: getCLMarketStatus,
  },
}

async function fetchMarketStatusFromYahoo(market: Market): Promise<MarketStatus> {
  const config = MARKETS[market]
  try {
    const quote = await yahooFinance.quote(config.ticker, {}, { validateResult: false })
    if (quote && quote.marketState) {
      const state = String(quote.marketState).toUpperCase()
      let session: MarketStatus['session'] = 'closed'
      let isOpen = false

      if (state === 'REGULAR') {
        session = 'regular'
        isOpen = true
      } else if (state === 'PRE' || state === 'PREPRE') {
        session = 'pre'
      } else if (state === 'POST' || state === 'POSTPOST' || state === 'AFTER') {
        session = 'after'
      }

      // Calculate fallback nextOpen if currently closed
      const fallbackStatus = config.fallback()
      const nextOpen = !isOpen ? fallbackStatus.nextOpen : undefined

      return {
        market,
        isOpen,
        session,
        openTime: fallbackStatus.openTime || '09:30',
        closeTime: fallbackStatus.closeTime || '16:00',
        timezone: quote.exchangeTimezoneName || config.timezone,
        nextOpen,
      }
    }
  } catch (error) {
    console.error(`[Market Status API] Failed to fetch Yahoo status for ${market}:`, error)
  }

  // Fallback to local timezone calculations
  return config.fallback()
}

export async function GET(request: NextRequest) {
  try {
    const cacheKey = 'market:status:v1'
    const statusData = await getCached(cacheKey, STATUS_TTL_MS, async () => {
      const [usStatus, clStatus] = await Promise.all([
        fetchMarketStatusFromYahoo('US'),
        fetchMarketStatusFromYahoo('CL'),
      ])
      return {
        US: usStatus,
        CL: clStatus,
      }
    })

    return NextResponse.json({
      data: statusData,
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
      },
    })
  } catch (error) {
    console.error('[API/market/status] Error:', error)
    return NextResponse.json({
      data: {
        US: getUSMarketStatus(),
        CL: getCLMarketStatus(),
      },
    })
  }
}
