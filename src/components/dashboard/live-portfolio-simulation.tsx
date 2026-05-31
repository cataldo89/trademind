'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Briefcase, Loader2, TrendingDown, TrendingUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency, formatPercent } from '@/lib/utils'

type PositionRow = {
  id: string
  symbol: string
  name: string
  market: 'US' | 'CL'
  quantity: number
  entry_price: number
  entry_date: string
  created_at: string
  openedAt: number
  currency: string
  currentPrice: number
  value: number
  cost: number
  pnl: number
  pnlPercent: number
  dayPnL: number
}

type PortfolioSnapshot = {
  userId: string
  timestamp: number
  positions: PositionRow[]
  totalValue: number
  totalCost: number
  totalPnL: number
  totalPnLPercent: number
  dayPnL: number
}

type HistoryPoint = {
  timestamp: number
  value: number
  pnl: number
}

type CandlePoint = {
  time: number
  close: number
}

type StoredHistory = {
  version: number
  key: string
  points: HistoryPoint[]
}

const HISTORY_VERSION = 2
const HISTORY_LIMIT = 520
const NEW_YORK_TIMEZONE = 'America/New_York'
const EMPTY_CHART_POINT: HistoryPoint = { timestamp: 0, value: 0, pnl: 0 }

const newYorkDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: NEW_YORK_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function getNewYorkDateKey(date = new Date()) {
  return newYorkDateFormatter.format(date)
}

function isTodayInNewYork(timestamp: number) {
  if (!Number.isFinite(timestamp)) return false
  return getNewYorkDateKey(new Date(timestamp)) === getNewYorkDateKey()
}

function getPortfolioHistoryKey(userId: string, positions: PositionRow[]) {
  const signature = positions
    .map((position) => [
      position.id,
      position.symbol,
      position.quantity,
      position.entry_price,
      position.created_at,
    ].join(':'))
    .sort()
    .join('|')

  return `trademind:portfolio-history:${userId}:${getNewYorkDateKey()}:${signature}`
}

function mergeHistoryPoints(...groups: HistoryPoint[][]) {
  const byTimestamp = new Map<number, HistoryPoint>()

  groups.flat().forEach((point) => {
    if (!Number.isFinite(point.timestamp) || !Number.isFinite(point.value) || !Number.isFinite(point.pnl)) return
    byTimestamp.set(Math.round(point.timestamp / 1000) * 1000, point)
  })

  return Array.from(byTimestamp.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-HISTORY_LIMIT)
}

function loadStoredHistory(key: string): HistoryPoint[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const stored = JSON.parse(raw) as StoredHistory
    if (stored.version !== HISTORY_VERSION || stored.key !== key || !Array.isArray(stored.points)) return []
    return stored.points.filter((point) => (
      Number.isFinite(point.timestamp) &&
      Number.isFinite(point.value) &&
      Number.isFinite(point.pnl)
    ))
  } catch {
    return []
  }
}

function saveStoredHistory(key: string, points: HistoryPoint[]) {
  if (typeof window === 'undefined') return

  const stored: StoredHistory = {
    version: HISTORY_VERSION,
    key,
    points: points.slice(-HISTORY_LIMIT),
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(stored))
  } catch {
    // localStorage can be unavailable or full; the live chart still works in memory.
  }
}

function clearStoredHistoryForUserDay(userId: string) {
  if (typeof window === 'undefined') return

  const prefix = `trademind:portfolio-history:${userId}:${getNewYorkDateKey()}:`

  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // History cleanup is best-effort; live data still comes from Supabase and quotes.
  }
}

async function fetchCandlesForPosition(position: PositionRow): Promise<CandlePoint[]> {
  try {
    const response = await fetch(`/api/market/candles?symbol=${encodeURIComponent(position.symbol)}&range=1D&market=${position.market}`)
    if (!response.ok) return []
    const body = await response.json()
    const candles = Array.isArray(body.data) ? body.data : []

    return candles
      .map((candle: { time?: number; close?: number }) => ({
        time: Number(candle.time) * 1000,
        close: Number(candle.close),
      }))
      .filter((candle: CandlePoint) => Number.isFinite(candle.time) && candle.time > 0 && Number.isFinite(candle.close) && candle.close > 0)
      .sort((a: CandlePoint, b: CandlePoint) => a.time - b.time)
  } catch {
    return []
  }
}

async function recoverIntradayPortfolioHistory(positions: PositionRow[]): Promise<HistoryPoint[]> {
  if (positions.length === 0) return []

  const candlesBySymbol = new Map<string, CandlePoint[]>()
  const timestampSet = new Set<number>()

  await Promise.all(positions.map(async (position) => {
    const candles = await fetchCandlesForPosition(position)
    candlesBySymbol.set(position.symbol, candles)
    candles.forEach((candle) => timestampSet.add(candle.time))
  }))

  const timestamps = Array.from(timestampSet).sort((a, b) => a - b)
  if (timestamps.length === 0) return []

  const totalCost = positions.reduce((sum, position) => sum + position.cost, 0)
  const cursorBySymbol = new Map<string, number>()

  return timestamps.map((timestamp) => {
    const totalPnl = positions.reduce((sum, position) => {
      const openedToday = isTodayInNewYork(position.openedAt)
      if (openedToday && timestamp < position.openedAt) {
        return sum
      }

      const candles = candlesBySymbol.get(position.symbol) || []
      let cursor = cursorBySymbol.get(position.symbol) ?? -1

      while (cursor + 1 < candles.length && candles[cursor + 1].time <= timestamp) {
        cursor += 1
      }

      cursorBySymbol.set(position.symbol, cursor)
      const price = cursor >= 0 ? candles[cursor].close : position.currentPrice || position.entry_price

      return sum + (price - position.entry_price) * position.quantity
    }, 0)

    return {
      timestamp,
      value: totalCost + totalPnl,
      pnl: totalPnl,
    }
  })
}

async function fetchLivePortfolio(): Promise<PortfolioSnapshot | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: positions } = await supabase
    .from('positions')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'open')
    .order('entry_date', { ascending: false })

  if (!positions || positions.length === 0) {
    return {
      userId: user.id,
      timestamp: Date.now(),
      positions: [],
      totalValue: 0,
      totalCost: 0,
      totalPnL: 0,
      totalPnLPercent: 0,
      dayPnL: 0,
    }
  }

  const symbols = Array.from(new Set(positions.map((position) => String(position.symbol).toUpperCase())))
  const quoteBySymbol = new Map<string, { price: number; change: number }>()

  try {
    const market = positions[0]?.market || 'US'
    const response = await fetch(`/api/market/quote?symbols=${encodeURIComponent(symbols.join(','))}&market=${market}`)
    if (response.ok) {
      const body = await response.json()
      const quotes = Array.isArray(body.data) ? body.data : [body.data]
      quotes.forEach((quote: { symbol?: string; price?: number; regularMarketPrice?: number; change?: number; regularMarketChange?: number }) => {
        const symbol = String(quote?.symbol || '').toUpperCase()
        const price = Number(quote?.price ?? quote?.regularMarketPrice)
        if (symbol && Number.isFinite(price) && price > 0) {
          quoteBySymbol.set(symbol, {
            price,
            change: Number(quote?.change ?? quote?.regularMarketChange ?? 0),
          })
        }
      })
    }
  } catch {
    // Keep the simulation visible with entry prices if live quotes temporarily fail.
  }

  const enriched: PositionRow[] = positions.map((position) => {
    const symbol = String(position.symbol).toUpperCase()
    const quote = quoteBySymbol.get(symbol)
    const quantity = Number(position.quantity) || 0
    const entryPrice = Number(position.entry_price) || 0
    const createdAt = String(position.created_at || '')
    const entryDate = String(position.entry_date || '')
    const openedAtValue = new Date(createdAt || entryDate || Date.now()).getTime()
    const openedAt = Number.isFinite(openedAtValue) ? openedAtValue : Date.now()
    const currentPrice = quote?.price || entryPrice
    const value = currentPrice * quantity
    const cost = entryPrice * quantity
    const pnl = value - cost
    const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0
    const dayPnL = isTodayInNewYork(openedAt) ? pnl : Number(quote?.change || 0) * quantity

    return {
      id: String(position.id),
      symbol,
      name: String(position.name || symbol),
      market: position.market || 'US',
      quantity,
      entry_price: entryPrice,
      entry_date: entryDate,
      created_at: createdAt,
      openedAt,
      currency: String(position.currency || 'USD'),
      currentPrice,
      value,
      cost,
      pnl,
      pnlPercent,
      dayPnL,
    }
  })

  const totalValue = enriched.reduce((sum, position) => sum + position.value, 0)
  const totalCost = enriched.reduce((sum, position) => sum + position.cost, 0)
  const totalPnL = totalValue - totalCost
  const totalPnLPercent = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0
  const dayPnL = enriched.reduce((sum, position) => sum + position.dayPnL, 0)

  return {
    userId: user.id,
    timestamp: Date.now(),
    positions: enriched,
    totalValue,
    totalCost,
    totalPnL,
    totalPnLPercent,
    dayPnL,
  }
}

export function LivePortfolioSimulation() {
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [recoveredKey, setRecoveredKey] = useState<string | null>(null)
  const [isRecovering, setIsRecovering] = useState(false)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['live-portfolio-simulation'],
    queryFn: fetchLivePortfolio,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  const historyKey = useMemo(() => {
    if (!data || data.positions.length === 0) return null
    return getPortfolioHistoryKey(data.userId, data.positions)
  }, [data])
  const recoverablePositions = useMemo(() => data?.positions ?? [], [data?.positions])

  useEffect(() => {
    if (!historyKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHistory([])
      if (data?.userId && data.positions.length === 0) {
        clearStoredHistoryForUserDay(data.userId)
      }
      return
    }

    setHistory(loadStoredHistory(historyKey))
  }, [historyKey, data])

  useEffect(() => {
    if (recoverablePositions.length === 0 || !historyKey || recoveredKey === historyKey) return

    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsRecovering(true)

    recoverIntradayPortfolioHistory(recoverablePositions)
      .then((recovered) => {
        if (cancelled) return
        setHistory((current) => mergeHistoryPoints(recovered, current))
        setRecoveredKey(historyKey)
      })
      .finally(() => {
        if (!cancelled) setIsRecovering(false)
      })

    return () => {
      cancelled = true
    }
  }, [historyKey, recoveredKey, recoverablePositions])

  useEffect(() => {
    if (!data || data.positions.length === 0) return

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistory((current) => mergeHistoryPoints(current, [{
      timestamp: data.timestamp,
      value: data.totalValue,
      pnl: data.totalPnL,
    }]))
  }, [data])

  useEffect(() => {
    if (!historyKey || history.length === 0) return
    saveStoredHistory(historyKey, history)
  }, [history, historyKey])

  const isPositive = (data?.totalPnL ?? 0) >= 0
  const positionsCount = data?.positions.length ?? 0

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-gray-800 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Activity className="h-4 w-4 text-emerald-400" />
            Simulacion en vivo
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            P&L total no realizado de tus posiciones abiertas con capital ficticio. Actualiza cada 5s.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className={cn('h-2 w-2 rounded-full', isFetching || isRecovering ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600')} />
          {isRecovering ? 'Recuperando apertura' : isFetching ? 'Actualizando precio' : 'Esperando siguiente tick'}
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-80 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
        </div>
      ) : !data || data.positions.length === 0 ? (
        <div className="flex h-80 flex-col items-center justify-center text-center">
          <Briefcase className="mb-3 h-10 w-10 text-gray-700" />
          <p className="text-sm text-gray-500">Compra una posicion simulada para ver el P&L vivo.</p>
          <p className="mt-1 text-xs text-gray-600">Ejemplo: 10 acciones de NVDA desde Portafolio.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)]">
          <div className="border-b border-gray-800 p-5 lg:border-b-0 lg:border-r">
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric label="Valor posiciones" value={formatCurrency(data.totalValue)} />
              <Metric label="Invertido" value={formatCurrency(data.totalCost)} />
              <Metric
                label="Ganancia / perdida total"
                value={`${isPositive ? '+' : '-'}${formatCurrency(Math.abs(data.totalPnL))}`}
                sub={formatPercent(data.totalPnLPercent)}
                positive={isPositive}
              />
              <Metric
                label="P&L de hoy"
                value={`${data.dayPnL >= 0 ? '+' : '-'}${formatCurrency(Math.abs(data.dayPnL))}`}
                positive={data.dayPnL >= 0}
              />
            </div>

            <PortfolioLineChart history={history} positive={isPositive} />

            <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
              <span>{positionsCount === 1 ? '1 posicion abierta en el grafico' : `${positionsCount} posiciones abiertas agregadas en el grafico`}</span>
              <span>{new Date(data.timestamp).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
          </div>

          <div className="divide-y divide-gray-800/60">
            {data.positions.map((position) => (
              <PositionLiveRow key={position.id} position={position} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  sub,
  positive,
}: {
  label: string
  value: string
  sub?: string
  positive?: boolean
}) {
  return (
    <div className="rounded-lg bg-gray-800/40 p-3">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className={cn(
        'font-mono text-lg font-bold',
        positive === undefined ? 'text-white' : positive ? 'text-emerald-400' : 'text-red-400'
      )}>
        {value}
      </p>
      {sub && <p className={cn('mt-0.5 font-mono text-xs', positive ? 'text-emerald-400/70' : 'text-red-400/70')}>{sub}</p>}
    </div>
  )
}

function formatChartTime(timestamp?: number) {
  if (!timestamp) return '--:--'

  return new Date(timestamp).toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function PortfolioLineChart({ history, positive }: { history: HistoryPoint[]; positive: boolean }) {
  const chart = useMemo(() => {
    const width = 920
    const height = 260
    const padding = { top: 18, right: 18, bottom: 40, left: 18 }
    const points = history.length > 0 ? history : [EMPTY_CHART_POINT]
    const values = points.map((point) => point.pnl)
    const rawMin = Math.min(...values, 0)
    const rawMax = Math.max(...values, 0)
    const buffer = Math.max((rawMax - rawMin) * 0.15, 1)
    const min = rawMin - buffer
    const max = rawMax + buffer
    const range = max - min || 1
    const innerWidth = width - padding.left - padding.right
    const innerHeight = height - padding.top - padding.bottom

    const coords = points.map((point, index) => {
      const x = padding.left + (points.length === 1 ? innerWidth : (index / (points.length - 1)) * innerWidth)
      const y = padding.top + innerHeight - ((point.pnl - min) / range) * innerHeight
      return { x, y, point }
    })

    const zeroY = padding.top + innerHeight - ((0 - min) / range) * innerHeight
    const line = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`).join(' ')
    const area = `${line} L ${coords[coords.length - 1].x.toFixed(2)} ${zeroY.toFixed(2)} L ${coords[0].x.toFixed(2)} ${zeroY.toFixed(2)} Z`
    const tickCount = Math.min(7, points.length)
    const xTicks = Array.from({ length: tickCount }, (_, index) => {
      const pointIndex = tickCount === 1 ? 0 : Math.round((index / (tickCount - 1)) * (points.length - 1))
      const coord = coords[pointIndex]
      return {
        x: coord.x,
        timestamp: coord.point.timestamp,
      }
    })
    const firstTimestamp = points[0]?.timestamp
    const lastTimestamp = points[points.length - 1]?.timestamp

    return { width, height, padding, min, max, coords, line, area, zeroY, xTicks, firstTimestamp, lastTimestamp }
  }, [history])

  const color = positive ? '#34d399' : '#fb7185'
  const fill = positive ? 'rgba(16, 185, 129, 0.14)' : 'rgba(248, 113, 113, 0.14)'
  const last = chart.coords[chart.coords.length - 1]

  return (
    <div className="h-[300px] rounded-lg border border-gray-800 bg-gray-950/40 p-3">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-full w-full" role="img" aria-label="Grafico de P&L total del portafolio en vivo">
        <text x={chart.padding.left} y="12" className="fill-gray-500 text-[10px]">
          P&L total simulado
        </text>
        <text x={chart.width - chart.padding.right} y="12" textAnchor="end" className="fill-gray-500 text-[10px]">
          {formatChartTime(chart.firstTimestamp)} - {formatChartTime(chart.lastTimestamp)}
        </text>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = chart.padding.top + tick * (chart.height - chart.padding.top - chart.padding.bottom)
          const value = chart.max - tick * (chart.max - chart.min)
          return (
            <g key={tick}>
              <line x1={chart.padding.left} x2={chart.width - chart.padding.right} y1={y} y2={y} stroke="rgba(148, 163, 184, 0.12)" />
              <text x={chart.padding.left + 6} y={y - 6} textAnchor="start" className="fill-gray-500 text-[10px]">
                {formatCurrency(value).replace('US$', '$')}
              </text>
            </g>
          )
        })}
        <line
          x1={chart.padding.left}
          x2={chart.width - chart.padding.right}
          y1={chart.zeroY}
          y2={chart.zeroY}
          stroke="rgba(148, 163, 184, 0.28)"
          strokeDasharray="4 6"
        />
        {chart.xTicks.map((tick, index) => (
          <g key={`${tick.timestamp}-${index}`}>
            <line
              x1={tick.x}
              x2={tick.x}
              y1={chart.height - chart.padding.bottom}
              y2={chart.height - chart.padding.bottom + 5}
              stroke="rgba(148, 163, 184, 0.28)"
            />
            <text
              x={tick.x}
              y={chart.height - 14}
              textAnchor={index === 0 ? 'start' : index === chart.xTicks.length - 1 ? 'end' : 'middle'}
              className="fill-gray-500 text-[10px]"
            >
              {formatChartTime(tick.timestamp)}
            </text>
          </g>
        ))}

        <path d={chart.area} fill={fill} />
        <path d={chart.line} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {last && (
          <g>
            <circle cx={last.x} cy={last.y} r="5" fill={color} />
            <circle cx={last.x} cy={last.y} r="10" fill={color} opacity="0.18" />
          </g>
        )}
      </svg>
    </div>
  )
}

function PositionLiveRow({ position }: { position: PositionRow }) {
  const isPositive = position.pnl >= 0
  const Icon = isPositive ? TrendingUp : TrendingDown

  return (
    <div className="p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-lg font-bold text-white">{position.symbol}</p>
          <p className="max-w-48 truncate text-xs text-gray-500">{position.name}</p>
        </div>
        <div className={cn('flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold', isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
          <Icon className="h-3 w-3" />
          {formatPercent(position.pnlPercent)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <SmallStat label="Cantidad" value={position.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })} />
        <SmallStat label="Entrada" value={formatCurrency(position.entry_price)} />
        <SmallStat label="Precio actual" value={formatCurrency(position.currentPrice)} />
        <SmallStat label="Valor" value={formatCurrency(position.value)} />
      </div>

      <div className="mt-4 rounded-lg bg-gray-900/60 p-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Resultado simulado</p>
        <p className={cn('mt-1 font-mono text-xl font-bold', isPositive ? 'text-emerald-400' : 'text-red-400')}>
          {isPositive ? '+' : '-'}{formatCurrency(Math.abs(position.pnl))}
        </p>
      </div>
    </div>
  )
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold text-white">{value}</p>
    </div>
  )
}
