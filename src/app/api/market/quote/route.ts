/**
 * Yahoo Finance Proxy — Next.js API Routes
 * Uses yahoo-finance2 npm package server-side
 * No API key required for basic data
 */

import { NextRequest, NextResponse } from 'next/server'
import { yahooFinance } from '@/lib/yahoo-finance'

// This route handles single stock quotes

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol') || searchParams.get('symbols')
  const market = searchParams.get('market') || 'US'

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 })
  }

  const symbols = symbol.split(',').map(s => s.trim()).filter(Boolean)

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let quotes: any[]
    if (symbols.length === 1) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = await yahooFinance.quote(symbols[0]) as any
      quotes = q ? [q] : []
    } else {
      // Fetch in chunks of 50 to avoid URL length or API limits
      quotes = []
      for (let i = 0; i < symbols.length; i += 50) {
        const chunk = symbols.slice(i, i + 50)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await yahooFinance.quote(chunk) as any
        if (Array.isArray(res)) quotes.push(...res)
        else if (res) quotes.push(res)
      }
    }

    if (!quotes || quotes.length === 0) {
      return NextResponse.json({ error: 'Symbol not found' }, { status: 404 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = quotes.map((quote: any) => ({
      symbol: quote.symbol || '',
      name: quote.longName || quote.shortName || quote.symbol || '',
      price: quote.regularMarketPrice ?? 0,
      previousClose: quote.regularMarketPreviousClose ?? 0,
      change: quote.regularMarketChange ?? 0,
      changePercent: quote.regularMarketChangePercent ?? 0,
      volume: quote.regularMarketVolume ?? 0,
      avgVolume: quote.averageDailyVolume3Month ?? 0,
      high: quote.regularMarketDayHigh ?? 0,
      low: quote.regularMarketDayLow ?? 0,
      open: quote.regularMarketOpen ?? 0,
      marketCap: quote.marketCap ?? null,
      pe: quote.trailingPE ?? null,
      exchange: quote.fullExchangeName || quote.exchange || '',
      market: market,
      currency: quote.currency || 'USD',
      timestamp: Date.now(),
    }))

    // If single symbol requested, return single object for backward compatibility (or use array?)
    // Actually, most components expect q.data to be the object.
    // Let's return { data: result } for single, { data: results } for multiple.
    // To be safe, if length is 1, return single object.
    
    return NextResponse.json({ 
      data: symbols.length === 1 ? results[0] : results 
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    })
  } catch (error) {
    console.error('[API/quote] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch quote', details: String(error) },
      { status: 500 }
    )
  }
}
