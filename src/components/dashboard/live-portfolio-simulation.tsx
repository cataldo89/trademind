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
  currency: string
  currentPrice: number
  value: number
  cost: number
  pnl: number
  pnlPercent: number
  dayPnL: number
}

type PortfolioSnapshot = {
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
    const currentPrice = quote?.price || entryPrice
    const value = currentPrice * quantity
    const cost = entryPrice * quantity
    const pnl = value - cost
    const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0
    const dayPnL = Number(quote?.change || 0) * quantity

    return {
      id: String(position.id),
      symbol,
      name: String(position.name || symbol),
      market: position.market || 'US',
      quantity,
      entry_price: entryPrice,
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

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['live-portfolio-simulation'],
    queryFn: fetchLivePortfolio,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  useEffect(() => {
    if (!data || data.positions.length === 0) return

    setHistory((current) => {
      const next = [
        ...current,
        {
          timestamp: data.timestamp,
          value: data.totalValue,
          pnl: data.totalPnL,
        },
      ]

      return next.slice(-80)
    })
  }, [data])

  const isPositive = (data?.totalPnL ?? 0) >= 0
  const primaryPosition = data?.positions[0]

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-gray-800 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Activity className="h-4 w-4 text-emerald-400" />
            Simulacion en vivo
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Rendimiento de tus posiciones abiertas con capital ficticio. Actualiza cada 5s.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className={cn('h-2 w-2 rounded-full', isFetching ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600')} />
          {isFetching ? 'Actualizando precio' : 'Esperando siguiente tick'}
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
              <Metric label="Valor actual" value={formatCurrency(data.totalValue)} />
              <Metric label="Invertido" value={formatCurrency(data.totalCost)} />
              <Metric
                label="Ganancia / perdida"
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
              <span>{primaryPosition ? `${primaryPosition.symbol}: ${primaryPosition.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })} acciones simuladas` : 'Posiciones abiertas'}</span>
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

function PortfolioLineChart({ history, positive }: { history: HistoryPoint[]; positive: boolean }) {
  const chart = useMemo(() => {
    const width = 920
    const height = 260
    const padding = { top: 18, right: 18, bottom: 28, left: 58 }
    const points = history.length > 0 ? history : [{ timestamp: Date.now(), value: 0, pnl: 0 }]
    const values = points.map((point) => point.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || Math.max(1, max * 0.01)
    const innerWidth = width - padding.left - padding.right
    const innerHeight = height - padding.top - padding.bottom

    const coords = points.map((point, index) => {
      const x = padding.left + (points.length === 1 ? innerWidth : (index / (points.length - 1)) * innerWidth)
      const y = padding.top + innerHeight - ((point.value - min) / range) * innerHeight
      return { x, y, point }
    })

    const line = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`).join(' ')
    const area = `${line} L ${coords[coords.length - 1].x.toFixed(2)} ${height - padding.bottom} L ${coords[0].x.toFixed(2)} ${height - padding.bottom} Z`

    return { width, height, padding, min, max, coords, line, area }
  }, [history])

  const color = positive ? '#34d399' : '#fb7185'
  const fill = positive ? 'rgba(16, 185, 129, 0.14)' : 'rgba(248, 113, 113, 0.14)'
  const last = chart.coords[chart.coords.length - 1]

  return (
    <div className="h-[300px] rounded-lg border border-gray-800 bg-gray-950/40 p-3">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-full w-full" role="img" aria-label="Grafico de rendimiento en vivo">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = chart.padding.top + tick * (chart.height - chart.padding.top - chart.padding.bottom)
          const value = chart.max - tick * (chart.max - chart.min)
          return (
            <g key={tick}>
              <line x1={chart.padding.left} x2={chart.width - chart.padding.right} y1={y} y2={y} stroke="rgba(148, 163, 184, 0.12)" />
              <text x={chart.padding.left - 10} y={y + 4} textAnchor="end" className="fill-gray-500 text-[11px]">
                {formatCurrency(value).replace('US$', '$')}
              </text>
            </g>
          )
        })}

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
