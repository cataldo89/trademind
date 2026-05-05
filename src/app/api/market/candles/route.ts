/**
 * Candles API Route — OHLCV data
 * Primary: Yahoo Finance (yahoo-finance2)
 * Supports: US stocks, ETFs, Crypto
 */

import { NextRequest, NextResponse } from 'next/server'
import { Timeframe, Candle } from '@/types'
import {
  ChartRange,
  YahooChartInterval,
  getChartRangeConfig,
  getFallbackChartRanges,
  normalizeChartRange,
} from '@/lib/chart-ranges'
import { yahooFinance } from '@/lib/yahoo-finance'

const ONE_DAY_LOOKBACK_DAYS = 5
const US_MARKET_TIMEZONE = 'America/New_York'
const EXTENDED_SESSION_OPEN_MINUTES = 4 * 60
const EXTENDED_SESSION_CLOSE_MINUTES = 20 * 60

const easternSessionFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: US_MARKET_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function subtractDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() - days)
  return result
}

function getEasternSessionInfo(time: number) {
  const parts = easternSessionFormatter.formatToParts(new Date(time * 1000))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
  }
}

function trimToLatestIntradaySession(candles: Candle[]): Candle[] {
  if (candles.length === 0) return candles

  const latest = getEasternSessionInfo(candles[candles.length - 1].time)
  const sessionCandles = candles.filter((candle) => {
    const session = getEasternSessionInfo(candle.time)

    return (
      session.dateKey === latest.dateKey &&
      session.minuteOfDay >= EXTENDED_SESSION_OPEN_MINUTES &&
      session.minuteOfDay <= EXTENDED_SESSION_CLOSE_MINUTES
    )
  })

  return sessionCandles.length > 0 ? sessionCandles : candles
}

function getYahooInterval(timeframe: Timeframe): YahooChartInterval {
  const intervals: Record<Timeframe, YahooChartInterval> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '4h': '1h',   // Yahoo doesn't have 4h — use 1h
    '1d': '1d',
    '1w': '1wk',
  }
  return intervals[timeframe] || '1d'
}

function getRangeForTimeframe(timeframe: Timeframe): string {
  switch (timeframe) {
    case '1m': return '5d' // Retroactivo por si el mercado está cerrado (After-Hours)
    case '5m': return '5d'
    case '15m': return '1mo'
    case '30m': return '1mo'
    case '1h': return '3mo'
    case '4h': return '3mo'
    case '1d': return '2y'
    case '1w': return '5y'
    default: return '1mo'
  }
}

type YahooQuote = {
  date?: Date | string
  open?: number | null
  high?: number | null
  low?: number | null
  close?: number | null
  volume?: number | null
}

type YahooChartResult = {
  quotes?: YahooQuote[]
  timestamp?: number[]
  indicators?: {
    quote?: YahooQuote[][]
  }
}

async function fetchCandles(symbol: string, interval: YahooChartInterval, period1: Date): Promise<Candle[]> {
  const result = await yahooFinance.chart(symbol, {
    interval,
    period1,
  }) as YahooChartResult

  const quotes = result.quotes || result.indicators?.quote?.[0] || []

  if (quotes.length === 0) {
    return []
  }

  const uniqueTimes = new Set<number>()

  return quotes
    .map((q, i) => {
      let time: number
      if (q.date) {
        time = Math.floor(new Date(q.date).getTime() / 1000)
      } else if (result.timestamp?.[i]) {
        time = result.timestamp[i]
      } else {
        // Fallback to sequential days if Yahoo omits timestamps.
        time = Math.floor(Date.now() / 1000) - (quotes.length - i) * 86400
      }

      return {
        time,
        open: q.open ?? 0,
        high: q.high ?? 0,
        low: q.low ?? 0,
        close: q.close ?? 0,
        volume: q.volume || 0,
      }
    })
    .filter((c) => {
      if (c.open <= 0 || c.close <= 0) return false
      if (uniqueTimes.has(c.time)) return false
      uniqueTimes.add(c.time)
      return true
    })
    .sort((a, b) => a.time - b.time)
}

async function fetchCandlesForRange(symbol: string, requestedRange: ChartRange) {
  const fallbackRanges = getFallbackChartRanges(requestedRange)

  for (const range of fallbackRanges) {
    const config = getChartRangeConfig(range)
    const period1 = range === '1D' ? subtractDays(new Date(), ONE_DAY_LOOKBACK_DAYS) : config.period1
    const rawCandles = await fetchCandles(symbol, config.interval, period1)
    const candles = range === '1D' ? trimToLatestIntradaySession(rawCandles) : rawCandles

    if (candles.length > 0) {
      const fallback = range !== requestedRange

      return {
        data: candles,
        range,
        requestedRange,
        interval: config.interval,
        fallback,
        fallbackReason: fallback
          ? `Sin datos para el rango solicitado; se usó ${config.label}`
          : undefined,
      }
    }
  }

  const config = getChartRangeConfig(requestedRange)

  return {
    data: [],
    range: requestedRange,
    requestedRange,
    interval: config.interval,
    fallback: false,
    fallbackReason: undefined,
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const rangeParam = searchParams.get('range')
  const timeframe = (searchParams.get('timeframe') || '1d') as Timeframe

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 })
  }

  try {
    if (rangeParam) {
      const requestedRange = normalizeChartRange(rangeParam)
      const response = await fetchCandlesForRange(symbol, requestedRange)

      return NextResponse.json(response, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      })
    }

    const interval = getYahooInterval(timeframe)
    const daysAgo = getRangeForTimeframe(timeframe)

    const period1 = new Date();
    period1.setDate(period1.getDate() - (daysAgo === '5d' ? 5 : daysAgo === '1mo' ? 30 : daysAgo === '3mo' ? 90 : daysAgo === '6mo' ? 180 : daysAgo === '1y' ? 365 : daysAgo === '2y' ? 730 : daysAgo === '5y' ? 1825 : 30));

    const candles = await fetchCandles(symbol, interval, period1)

    return NextResponse.json({ data: candles }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    })
  } catch (error) {
    console.error('[API/candles] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch candles', details: String(error) },
      { status: 500 }
    )
  }
}
