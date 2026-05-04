/**
 * Market Movers API Route
 * Returns gainers, losers, most active for US market
 * Uses Yahoo Finance screen/trending endpoints
 */

import { NextRequest, NextResponse } from 'next/server'
import { Market, MarketMover } from '@/types'
import { yahooFinance } from '@/lib/yahoo-finance'

const US_SECTORS = [
  'day_gainers',
  'day_losers',
  'most_actives',
]

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const market = (searchParams.get('market') || 'US') as Market

  try {
    if (market === 'US') {
      const [gainersRaw, losersRaw, activeRaw] = await Promise.allSettled([
        yahooFinance.screener({ scrIds: 'day_gainers', count: 10 }),
        yahooFinance.screener({ scrIds: 'day_losers', count: 10 }),
        yahooFinance.screener({ scrIds: 'most_actives', count: 10 }),
      ])

      const parse = (
        result: PromiseSettledResult<{ quotes: unknown[] }>
      ): MarketMover[] => {
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

      return NextResponse.json({
        data: {
          gainers: parse(gainersRaw as PromiseSettledResult<{ quotes: unknown[] }>),
          losers: parse(losersRaw as PromiseSettledResult<{ quotes: unknown[] }>),
          mostActive: parse(activeRaw as PromiseSettledResult<{ quotes: unknown[] }>),
        },
      }, {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      })
    }

    return NextResponse.json({ error: 'Unsupported market' }, { status: 400 })
  } catch (error) {
    console.error('[API/movers] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch market movers', details: String(error) },
      { status: 500 }
    )
  }
}
