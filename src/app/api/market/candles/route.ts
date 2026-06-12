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
import { fetchAlphaVantageIntraday, fetchFinnhubCandles, getYahooSymbol } from '@/lib/market-data'
import { normalizeSymbol, parseMarketOrLegacy } from '@/lib/domain/market'
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit'
import { getCached } from '@/lib/api/memory-cache'
import { getDurableMarketData } from '@/lib/api/market-data-cache'
import type { Market } from '@/types'

const VALID_TIMEFRAMES = new Set<Timeframe>(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'])
const RATE_LIMIT = 90
const RATE_WINDOW_MS = 60_000
const CANDLES_TTL_MS = 60_000
type CandleProvider = 'alpha-vantage' | 'finnhub' | 'yahoo'

const ONE_DAY_LOOKBACK_DAYS = 5
const US_MARKET_TIMEZONE = 'America/New_York'
const REGULAR_SESSION_OPEN_MINUTES = 9 * 60 + 30
const REGULAR_SESSION_CLOSE_MINUTES = 16 * 60

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

function isCryptoSymbol(symbol: string) {
  return /-USD$/i.test(symbol)
}

function configuredProvidersSupported(symbol: string, market: Market) {
  return market === 'US' && !isCryptoSymbol(symbol)
}

function candleProviderOrder(): CandleProvider[] {
  const configured = (process.env.MARKET_DATA_CANDLE_PROVIDER_ORDER || 'alpha-vantage,finnhub,yahoo')
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is CandleProvider => ['alpha-vantage', 'finnhub', 'yahoo'].includes(provider))

  return Array.from(new Set(configured.length > 0 ? configured : ['alpha-vantage', 'finnhub', 'yahoo']))
}

function isRegularSessionCandle(candle: Candle) {
  const session = getEasternSessionInfo(candle.time)
  return session.minuteOfDay >= REGULAR_SESSION_OPEN_MINUTES && session.minuteOfDay <= REGULAR_SESSION_CLOSE_MINUTES
}

function filterRegularSession(candles: Candle[]): Candle[] {
  const regularCandles = candles.filter(isRegularSessionCandle)
  return regularCandles.length > 0 ? regularCandles : candles
}

function trimToLatestRegularSession(candles: Candle[]): Candle[] {
  const regularCandles = filterRegularSession(candles)
  if (regularCandles.length === 0) return candles

  const latest = getEasternSessionInfo(regularCandles[regularCandles.length - 1].time)
  const sessionCandles = regularCandles.filter((candle) => getEasternSessionInfo(candle.time).dateKey === latest.dateKey)

  return sessionCandles.length > 0 ? sessionCandles : regularCandles
}

function trimToLatestRegularSessions(candles: Candle[], sessionsCount: number): Candle[] {
  const regularCandles = filterRegularSession(candles)
  const sessionKeys = Array.from(new Set(regularCandles.map((candle) => getEasternSessionInfo(candle.time).dateKey)))
  const visibleKeys = new Set(sessionKeys.slice(-sessionsCount))
  const sessionCandles = regularCandles.filter((candle) => visibleKeys.has(getEasternSessionInfo(candle.time).dateKey))

  return sessionCandles.length > 0 ? sessionCandles : regularCandles
}

function hasEnoughIntradayCandles(range: ChartRange, candles: Candle[]) {
  if (range === '1D') return candles.length >= 20
  if (range === '5D') return candles.length >= 30
  return true
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

function yahooIntervalToTimeframe(interval: YahooChartInterval): Timeframe {
  const map: Record<YahooChartInterval, Timeframe> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '1d': '1d',
    '1wk': '1w',
    '1mo': '1w',
  }

  return map[interval] || '1d'
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

function toFinitePositiveNumber(value: number | null | undefined): number | null {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null
}

function normalizeYahooCandle(q: YahooQuote, time: number): Candle | null {
  const open = toFinitePositiveNumber(q.open)
  const high = toFinitePositiveNumber(q.high)
  const low = toFinitePositiveNumber(q.low)
  const close = toFinitePositiveNumber(q.close)

  if (!Number.isFinite(time) || time <= 0 || open === null || high === null || low === null || close === null) {
    return null
  }

  return {
    time,
    open,
    high: Math.max(high, open, close),
    low: Math.min(low, open, close),
    close,
    volume: Math.max(0, Number(q.volume) || 0),
  }
}

function filterCandlesFrom(candles: Candle[], period1: Date) {
  const from = Math.floor(period1.getTime() / 1000)
  return candles.filter((candle) => candle.time >= from)
}

function cleanProviderCandles(candles: Candle[]) {
  const uniqueTimes = new Set<number>()

  return candles
    .map((candle) => normalizeYahooCandle(candle, candle.time))
    .filter((candle): candle is Candle => {
      if (!candle) return false
      if (uniqueTimes.has(candle.time)) return false
      uniqueTimes.add(candle.time)
      return true
    })
    .sort((a, b) => a.time - b.time)
}

async function fetchYahooCandles(symbol: string, interval: YahooChartInterval, period1: Date): Promise<Candle[]> {
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

      return normalizeYahooCandle(q, time)
    })
    .filter((c): c is Candle => {
      if (!c) return false
      if (uniqueTimes.has(c.time)) return false
      uniqueTimes.add(c.time)
      return true
    })
    .sort((a, b) => a.time - b.time)
}

async function fetchConfiguredCandles(symbol: string, market: Market, timeframe: Timeframe, period1: Date): Promise<{ data: Candle[]; provider: CandleProvider }> {
  if (configuredProvidersSupported(symbol, market)) {
    const from = Math.floor(period1.getTime() / 1000)
    const to = Math.floor(Date.now() / 1000)

    for (const provider of candleProviderOrder()) {
      if (provider === 'yahoo') continue

      try {
        if (provider === 'alpha-vantage' && process.env.ALPHA_VANTAGE_API_KEY) {
          const candles = cleanProviderCandles(await fetchAlphaVantageIntraday(symbol, timeframe, process.env.ALPHA_VANTAGE_API_KEY))
          const filtered = filterCandlesFrom(candles, period1)
          if (filtered.length > 0) return { data: filtered, provider }
        }

        if (provider === 'finnhub' && process.env.FINNHUB_API_KEY) {
          const candles = cleanProviderCandles(await fetchFinnhubCandles(symbol, timeframe, process.env.FINNHUB_API_KEY, from, to))
          if (candles.length > 0) return { data: candles, provider }
        }
      } catch (error) {
        console.warn(`[Market Candles] ${provider} failed for ${symbol}:`, error)
      }
    }
  }

  return { data: await fetchYahooCandles(symbol, getYahooInterval(timeframe), period1), provider: 'yahoo' }
}

async function fetchCandlesForRange(symbol: string, market: Market, requestedRange: ChartRange) {
  const fallbackRanges = getFallbackChartRanges(requestedRange)

  for (const range of fallbackRanges) {
    const config = getChartRangeConfig(range)
    const period1 = range === '1D' ? subtractDays(new Date(), ONE_DAY_LOOKBACK_DAYS) : config.period1
    const response = await fetchConfiguredCandles(symbol, market, yahooIntervalToTimeframe(config.interval), period1)
    const rawCandles = response.data
    const candles = isCryptoSymbol(symbol)
      ? rawCandles
      : range === '1D'
        ? trimToLatestRegularSession(rawCandles)
        : range === '5D'
          ? trimToLatestRegularSessions(rawCandles, 5)
          : rawCandles

    if (candles.length > 0) {
      if (!isCryptoSymbol(symbol) && (range === '1D' || range === '5D') && !hasEnoughIntradayCandles(range, candles)) {
        continue
      }

      const fallback = range !== requestedRange

      return {
        data: candles,
        provider: response.provider,
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
    provider: 'yahoo' as CandleProvider,
    range: requestedRange,
    requestedRange,
    interval: config.interval,
    fallback: false,
    fallbackReason: undefined,
  }
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit(`market:candles:${getClientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many candle requests' }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const rawSymbol = normalizeSymbol(searchParams.get('symbol'))
  const market = parseMarketOrLegacy(searchParams.get('market'), rawSymbol) || 'US'
  const symbol = rawSymbol ? getYahooSymbol(rawSymbol, market) : null
  const rangeParam = searchParams.get('range')
  const timeframe = (searchParams.get('timeframe') || '1d') as Timeframe

  if (!rawSymbol || !symbol) {
    return NextResponse.json({ error: 'Valid symbol is required' }, { status: 400 })
  }

  if (!VALID_TIMEFRAMES.has(timeframe)) {
    return NextResponse.json({ error: 'Invalid timeframe' }, { status: 400 })
  }

  try {
    if (rangeParam) {
      const requestedRange = normalizeChartRange(rangeParam)
      const response = await getCached(
        `candles:v2:${symbol}:range:${requestedRange}`,
        CANDLES_TTL_MS,
        () => getDurableMarketData({
          symbol: rawSymbol,
          market,
          range: `range:${requestedRange}`,
          ttlMs: CANDLES_TTL_MS,
          provider: 'configured-market-data',
          loader: () => fetchCandlesForRange(symbol, market, requestedRange),
        })
      )

      return NextResponse.json(response, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          'X-RateLimit-Remaining': String(rate.remaining),
        },
      })
    }

    const daysAgo = getRangeForTimeframe(timeframe)

    const period1 = new Date()
    period1.setDate(period1.getDate() - (daysAgo === '5d' ? 5 : daysAgo === '1mo' ? 30 : daysAgo === '3mo' ? 90 : daysAgo === '6mo' ? 180 : daysAgo === '1y' ? 365 : daysAgo === '2y' ? 730 : daysAgo === '5y' ? 1825 : 30))

    const candles = await getCached(
      `candles:v2:${symbol}:timeframe:${timeframe}`,
      CANDLES_TTL_MS,
      () => getDurableMarketData({
        symbol: rawSymbol,
        market,
        range: `timeframe:${timeframe}`,
        ttlMs: CANDLES_TTL_MS,
        provider: 'configured-market-data',
        loader: () => fetchConfiguredCandles(symbol, market, timeframe, period1).then((response) => response.data),
      })
    )

    return NextResponse.json({ data: candles }, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        'X-RateLimit-Remaining': String(rate.remaining),
      },
    })
  } catch (error) {
    console.error('[API/candles] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch candles' }, { status: 500 })
  }
}
