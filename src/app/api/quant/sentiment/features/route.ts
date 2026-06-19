import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type NewsSentimentRow = {
  symbol: string
  as_of: string
  horizon_days: number
  sent_mean_raw_finnhub: number | null
  sent_mean_raw_marketaux: number | null
  sent_mean_finbert: number
  sent_share_negative: number
  sent_count_articles: number
  sent_trend_1d: number | null
  sent_trend_5d: number | null
  sent_trend_20d: number | null
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) return null
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function parseCsvNumbers(value: string | null, fallback: number[]) {
  if (!value) return fallback
  const parsed = value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0)
  return parsed.length ? Array.from(new Set(parsed)) : fallback
}

function sentimentTag(score: number, shareNegative: number) {
  if (score >= 0.2 && shareNegative < 0.4) return 'Bullish'
  if (score <= -0.2 || shareNegative >= 0.5) return 'Bearish'
  return 'Neutral'
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbols = Array.from(new Set(
    (searchParams.get('symbols') || searchParams.get('symbol') || '')
      .split(',')
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean)
  )).slice(0, 50)
  const horizons = parseCsvNumbers(searchParams.get('horizons'), [1, 5, 20])

  if (!symbols.length) {
    return NextResponse.json({ error: 'symbols is required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase service role is not configured' }, { status: 503 })
  }

  const { data, error } = await supabase
    .from('news_sentiment')
    .select('symbol,as_of,horizon_days,sent_mean_raw_finnhub,sent_mean_raw_marketaux,sent_mean_finbert,sent_share_negative,sent_count_articles,sent_trend_1d,sent_trend_5d,sent_trend_20d')
    .in('symbol', symbols)
    .in('horizon_days', horizons)
    .order('as_of', { ascending: false })
    .limit(symbols.length * horizons.length * 4)

  if (error) {
    console.error('[api/quant/sentiment/features]', error)
    return NextResponse.json({ error: 'Failed to load sentiment features' }, { status: 500 })
  }

  const latest = new Map<string, NewsSentimentRow>()
  for (const row of (data || []) as NewsSentimentRow[]) {
    const key = `${row.symbol}:${row.horizon_days}`
    if (!latest.has(key)) latest.set(key, row)
  }

  const features = Object.fromEntries(symbols.map((symbol) => {
    const byHorizon = Object.fromEntries(horizons.map((horizon) => {
      const row = latest.get(`${symbol}:${horizon}`)
      if (!row) return [String(horizon), null]
      return [String(horizon), {
        ...row,
        tag: sentimentTag(Number(row.sent_mean_finbert || 0), Number(row.sent_share_negative || 0)),
      }]
    }))
    return [symbol, byHorizon]
  }))

  return NextResponse.json({
    success: true,
    symbols,
    horizons,
    features,
  })
}
