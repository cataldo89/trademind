'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Loader2,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { cn, formatCurrency, formatPercent } from '@/lib/utils'

type Quote = {
  symbol: string
  name: string
  price: number
  previousClose: number
  change: number
  changePercent: number
  volume: number
  market: 'US' | 'CL'
  currency: string
  timestamp: number
}

type Position = {
  symbol: string
  name: string
  quantity: number
  entryPrice: number
  currency: string
  executedAt: number
}

type HistoryPoint = {
  timestamp: number
  price: number
  value: number
  pnl: number
}

type Stage = 'scanning' | 'selected' | 'bought' | 'live' | 'error'

const SYMBOL_UNIVERSE = [
  'NVDA',
  'AMD',
  'TSLA',
  'AAPL',
  'MSFT',
  'AMZN',
  'META',
  'GOOGL',
  'PLTR',
  'SMCI',
  'SPY',
  'QQQ',
]

async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const response = await fetch(`/api/market/quote?symbols=${symbols.join(',')}&market=US`, {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('No se pudieron cargar cotizaciones')
  }

  const body = await response.json()
  const quotes: Partial<Quote>[] = Array.isArray(body.data)
    ? body.data as Partial<Quote>[]
    : [body.data as Partial<Quote>]

  return quotes
    .map((quote: Partial<Quote>): Quote => ({
      symbol: String(quote.symbol || ''),
      name: String(quote.name || quote.symbol || ''),
      price: Number(quote.price || 0),
      previousClose: Number(quote.previousClose || 0),
      change: Number(quote.change || 0),
      changePercent: Number(quote.changePercent || 0),
      volume: Number(quote.volume || 0),
      market: quote.market === 'CL' ? 'CL' : 'US',
      currency: String(quote.currency || 'USD'),
      timestamp: Number(quote.timestamp || Date.now()),
    }))
    .filter((quote) => quote.symbol && Number.isFinite(quote.price) && quote.price > 0)
}

async function fetchQuote(symbol: string): Promise<Quote> {
  const [quote] = await fetchQuotes([symbol])
  if (!quote) throw new Error('Cotizacion no disponible')
  return quote
}

function chooseRisingQuote(quotes: Quote[]) {
  const rising = quotes
    .filter((quote) => quote.changePercent > 0)
    .sort((left, right) => right.changePercent - left.changePercent)

  return rising[0] || quotes.sort((left, right) => right.changePercent - left.changePercent)[0]
}

export default function LiveMonitorPage() {
  const [stage, setStage] = useState<Stage>('scanning')
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null)
  const [liveQuote, setLiveQuote] = useState<Quote | null>(null)
  const [position, setPosition] = useState<Position | null>(null)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [error, setError] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []

    async function runDemo() {
      setStage('scanning')
      setError('')

      try {
        const initialQuotes = await fetchQuotes(SYMBOL_UNIVERSE)
        const winner = chooseRisingQuote(initialQuotes)

        if (!winner) {
          throw new Error('No hay cotizaciones disponibles')
        }

        if (cancelled) return

        setQuotes(initialQuotes.sort((left, right) => right.changePercent - left.changePercent))
        setSelectedQuote(winner)
        setLiveQuote(winner)
        setStage('selected')

        timers.push(setTimeout(() => {
          if (cancelled) return

          const simulatedPosition = {
            symbol: winner.symbol,
            name: winner.name,
            quantity: 1,
            entryPrice: winner.price,
            currency: winner.currency,
            executedAt: Date.now(),
          }

          setPosition(simulatedPosition)
          setHistory([{
            timestamp: Date.now(),
            price: winner.price,
            value: winner.price * simulatedPosition.quantity,
            pnl: 0,
          }])
          setStage('bought')
        }, 1600))

        timers.push(setTimeout(() => {
          if (!cancelled) setStage('live')
        }, 3200))
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Error cargando mercado')
        setStage('error')
      }
    }

    runDemo()

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [])

  useEffect(() => {
    if (!position) return
    const activePosition = position

    let cancelled = false

    async function refreshLiveQuote() {
      setIsRefreshing(true)
      try {
        const nextQuote = await fetchQuote(activePosition.symbol)
        if (cancelled) return

        const value = nextQuote.price * activePosition.quantity
        const pnl = value - activePosition.entryPrice * activePosition.quantity

        setLiveQuote(nextQuote)
        setHistory((current) => [
          ...current,
          {
            timestamp: Date.now(),
            price: nextQuote.price,
            value,
            pnl,
          },
        ].slice(-80))
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error actualizando mercado')
        }
      } finally {
        if (!cancelled) setIsRefreshing(false)
      }
    }

    const interval = window.setInterval(refreshLiveQuote, 5000)
    refreshLiveQuote()

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [position])

  const pnl = position && liveQuote ? (liveQuote.price - position.entryPrice) * position.quantity : 0
  const pnlPercent = position && liveQuote ? ((liveQuote.price - position.entryPrice) / position.entryPrice) * 100 : 0
  const currentValue = position && liveQuote ? liveQuote.price * position.quantity : 0
  const isPositive = pnl >= 0
  const isSelectedRising = (selectedQuote?.changePercent ?? 0) > 0

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-gray-800 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              TradeMind Live
            </p>
            <h1 className="text-2xl font-bold text-white lg:text-3xl">Compra simulada en vivo</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-400">
              La pantalla escanea acciones USA, elige una en alza desde la API de mercado y mantiene el resultado actualizado cada 5 segundos.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2 text-xs text-gray-400">
            <span className={cn('h-2 w-2 rounded-full', isRefreshing ? 'animate-pulse bg-emerald-400' : 'bg-gray-600')} />
            {isRefreshing ? 'Actualizando mercado' : 'Esperando siguiente tick'}
          </div>
        </header>

        {stage === 'error' ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 p-8 text-center">
            <div>
              <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-300" />
              <p className="font-semibold text-red-100">No se pudo iniciar la demo</p>
              <p className="mt-2 text-sm text-red-200/80">{error}</p>
            </div>
          </div>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.85fr)]">
              <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                      <BarChart3 className="h-4 w-4 text-emerald-400" />
                      Ranking de oportunidad
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">Ordenado por variacion diaria positiva.</p>
                  </div>
                  <StageBadge stage={stage} />
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {quotes.slice(0, 6).map((quote) => (
                    <QuoteRow
                      key={quote.symbol}
                      quote={quote}
                      active={quote.symbol === selectedQuote?.symbol}
                    />
                  ))}

                  {quotes.length === 0 && (
                    <div className="col-span-full flex h-56 items-center justify-center text-sm text-gray-500">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-400" />
                      Escaneando mercado...
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
                  <ShoppingCart className="h-4 w-4 text-emerald-400" />
                  Orden simulada
                </h2>

                {!selectedQuote ? (
                  <div className="flex h-64 items-center justify-center text-sm text-gray-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-400" />
                    Buscando accion en alza...
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-2xl font-bold text-white">{selectedQuote.symbol}</p>
                          <p className="mt-1 max-w-64 truncate text-sm text-gray-400">{selectedQuote.name}</p>
                        </div>
                        <div className={cn(
                          'flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold',
                          isSelectedRising ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300'
                        )}>
                          {isSelectedRising ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {formatPercent(selectedQuote.changePercent)}
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-2 gap-3">
                        <SmallMetric label="Precio entrada" value={formatCurrency(selectedQuote.price, selectedQuote.currency)} />
                        <SmallMetric label="Cantidad" value="1 accion" />
                        <SmallMetric label="Tipo" value="Compra" />
                        <SmallMetric label="Estado" value={position ? 'Ejecutada' : 'Preparando'} />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <TimelineItem done={stage !== 'scanning'} label="Escaneo de mercado completado" />
                      <TimelineItem done={Boolean(selectedQuote)} label="Accion en alza seleccionada" />
                      <TimelineItem done={Boolean(position)} label="Compra simulada agregada al dashboard" />
                      <TimelineItem done={stage === 'live'} label="P&L en vivo activo" />
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-gray-800 bg-gray-900/50">
              <div className="flex flex-col gap-3 border-b border-gray-800 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Activity className="h-4 w-4 text-emerald-400" />
                    Dashboard de posicion viva
                  </h2>
                  <p className="mt-1 text-xs text-gray-500">Capital ficticio, precio de mercado real cuando el proveedor entrega ticks.</p>
                </div>
                {liveQuote && (
                  <p className="font-mono text-xs text-gray-500">
                    Ultima lectura {new Date(liveQuote.timestamp).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </p>
                )}
              </div>

              {!position || !liveQuote ? (
                <div className="flex h-80 items-center justify-center text-sm text-gray-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin text-emerald-400" />
                  Esperando ejecucion simulada...
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
                  <div className="border-b border-gray-800 p-4 lg:border-b-0 lg:border-r">
                    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <Metric label="Valor actual" value={formatCurrency(currentValue, position.currency)} />
                      <Metric label="Entrada" value={formatCurrency(position.entryPrice, position.currency)} />
                      <Metric
                        label="Resultado"
                        value={`${isPositive ? '+' : '-'}${formatCurrency(Math.abs(pnl), position.currency)}`}
                        sub={formatPercent(pnlPercent)}
                        positive={isPositive}
                      />
                      <Metric
                        label="Cambio dia"
                        value={formatPercent(liveQuote.changePercent)}
                        positive={liveQuote.changePercent >= 0}
                      />
                    </div>

                    <LiveLineChart history={history} positive={isPositive} currency={position.currency} />
                  </div>

                  <div className="p-4">
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-2xl font-bold text-white">{position.symbol}</p>
                        <p className="mt-1 max-w-56 truncate text-sm text-gray-500">{position.name}</p>
                      </div>
                      <div className={cn(
                        'flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold',
                        isPositive ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300'
                      )}>
                        {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {formatPercent(pnlPercent)}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <SmallMetric label="Cantidad" value={position.quantity.toLocaleString('en-US')} />
                      <SmallMetric label="Precio actual" value={formatCurrency(liveQuote.price, position.currency)} />
                      <SmallMetric label="Invertido" value={formatCurrency(position.entryPrice * position.quantity, position.currency)} />
                      <SmallMetric label="Variacion dia" value={formatCurrency(liveQuote.change, position.currency)} />
                    </div>

                    <div className={cn(
                      'mt-5 rounded-lg border p-4',
                      isPositive ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-red-500/20 bg-red-500/10'
                    )}>
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Resultado simulado</p>
                      <p className={cn('mt-2 font-mono text-3xl font-bold', isPositive ? 'text-emerald-300' : 'text-red-300')}>
                        {isPositive ? '+' : '-'}{formatCurrency(Math.abs(pnl), position.currency)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}

function StageBadge({ stage }: { stage: Stage }) {
  const labelByStage: Record<Stage, string> = {
    scanning: 'Escaneando',
    selected: 'Seleccionada',
    bought: 'Compra ejecutada',
    live: 'En vivo',
    error: 'Error',
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs font-semibold text-gray-300">
      {stage === 'live' ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />}
      {labelByStage[stage]}
    </div>
  )
}

function QuoteRow({ quote, active }: { quote: Quote; active: boolean }) {
  const positive = quote.changePercent >= 0

  return (
    <div className={cn(
      'rounded-lg border p-3 transition-colors',
      active ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-gray-800 bg-gray-950/40'
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-base font-bold text-white">{quote.symbol}</p>
          <p className="mt-0.5 truncate text-xs text-gray-500">{quote.name}</p>
        </div>
        <div className={cn('text-right font-mono text-sm font-bold', positive ? 'text-emerald-300' : 'text-red-300')}>
          {formatPercent(quote.changePercent)}
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="font-mono text-sm text-gray-200">{formatCurrency(quote.price, quote.currency)}</p>
        {active && <span className="rounded-md bg-emerald-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">Elegida</span>}
      </div>
    </div>
  )
}

function TimelineItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={cn(
        'flex h-6 w-6 items-center justify-center rounded-full border',
        done ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-gray-700 bg-gray-950 text-gray-600'
      )}>
        {done ? <CheckCircle2 className="h-4 w-4" /> : <span className="h-2 w-2 rounded-full bg-current" />}
      </span>
      <span className={done ? 'text-gray-200' : 'text-gray-500'}>{label}</span>
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
    <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={cn(
        'font-mono text-lg font-bold',
        positive === undefined ? 'text-white' : positive ? 'text-emerald-300' : 'text-red-300'
      )}>
        {value}
      </p>
      {sub && <p className={cn('mt-0.5 font-mono text-xs', positive ? 'text-emerald-300/80' : 'text-red-300/80')}>{sub}</p>}
    </div>
  )
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-semibold text-white">{value}</p>
    </div>
  )
}

function LiveLineChart({
  history,
  positive,
  currency,
}: {
  history: HistoryPoint[]
  positive: boolean
  currency: string
}) {
  const chart = useMemo(() => {
    const width = 920
    const height = 280
    const padding = { top: 18, right: 18, bottom: 28, left: 72 }
    const points = history.length > 0 ? history : [{ timestamp: 0, price: 0, value: 0, pnl: 0 }]
    const values = points.map((point) => point.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || Math.max(1, Math.abs(max) * 0.01)
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
    <div className="h-[310px] rounded-lg border border-gray-800 bg-gray-950/40 p-3">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-full w-full" role="img" aria-label="Grafico de posicion simulada en vivo">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = chart.padding.top + tick * (chart.height - chart.padding.top - chart.padding.bottom)
          const value = chart.max - tick * (chart.max - chart.min)
          return (
            <g key={tick}>
              <line x1={chart.padding.left} x2={chart.width - chart.padding.right} y1={y} y2={y} stroke="rgba(148, 163, 184, 0.12)" />
              <text x={chart.padding.left - 10} y={y + 4} textAnchor="end" className="fill-gray-500 text-[11px]">
                {formatCurrency(value, currency).replace('US$', '$')}
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
