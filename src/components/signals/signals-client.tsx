'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Minus, Zap, Loader2, ArrowUpRight, Trash2 } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { fetchVirtualBalanceProfile } from '@/lib/virtual-balance'

interface Signal {
  id: string
  symbol: string
  market: string
  type: 'BUY' | 'SELL' | 'HOLD'
  strength: number
  reason: string
  price: number
  timeframe: string
  status: string
  created_at: string
}

type SignalWithQuote = Signal & {
  currentPrice?: number
  performance?: number
}

const DEFAULT_ORDER_AMOUNT = 100

async function fetchAllSignals(): Promise<SignalWithQuote[]> {
  const { createClient } = await import('@/lib/supabase/client')
  const supabaseClient = createClient()
  const { data: { session } } = await supabaseClient.auth.getSession()
  const token = session?.access_token

  const res = await fetch('/api/signals', {
    cache: 'no-store',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) return []
  const body = await res.json()
  const signals = (body.data || []) as Signal[]
  if (signals.length === 0) return []

  const symbols = Array.from(new Set(signals.map((signal) => signal.symbol).filter(Boolean)))
  if (symbols.length === 0) return signals

  try {
    const market = signals[0]?.market || 'US'
    const quoteRes = await fetch(`/api/market/quote?symbols=${encodeURIComponent(symbols.join(','))}&market=${market}`)
    if (!quoteRes.ok) return signals

    const payload = await quoteRes.json()
    const quotes = Array.isArray(payload.data) ? payload.data : [payload.data]
    const quoteBySymbol = new Map<string, { price?: number; regularMarketPrice?: number }>()
    quotes.forEach((quote: { symbol?: string; price?: number; regularMarketPrice?: number; change?: number; changePercent?: number }) => {
      if (quote?.symbol) quoteBySymbol.set(String(quote.symbol).toUpperCase(), quote)
    })

    return signals.map((signal) => {
      const quote = quoteBySymbol.get(signal.symbol.toUpperCase())
      const currentPrice = Number(quote?.price || quote?.regularMarketPrice)
      const entryPrice = Number(signal.price)
      if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) return signal
      return {
        ...signal,
        currentPrice,
        performance: ((currentPrice - entryPrice) / entryPrice) * 100,
      }
    })
  } catch {
    return signals
  }
}
function parseOrderAmount(value: string) {
  return Number(value.trim().replace(',', '.'))
}

function formatQuantity(quantity: number) {
  return quantity.toLocaleString('en-US', {
    minimumFractionDigits: quantity < 1 ? 4 : 0,
    maximumFractionDigits: quantity < 1 ? 8 : 6,
  })
}

async function fetchCurrentPrice(symbol: string, market: string, fallbackPrice?: number) {
  const fallback = Number(fallbackPrice)

  try {
    const res = await fetch(`/api/market/quote?symbol=${encodeURIComponent(symbol)}&market=${market}`)
    if (res.ok) {
      const payload = await res.json()
      const quote = payload.data || payload
      const price = Number(quote?.price || quote?.regularMarketPrice)
      if (Number.isFinite(price) && price > 0) return price
    }
  } catch {
    // During weekends or data outages, keep the stored signal price as fallback.
  }

  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
}

const signalConfig = {
  BUY: { label: 'COMPRAR', icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  SELL: { label: 'VENDER', icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  HOLD: { label: 'MANTENER', icon: Minus, color: 'text-gray-400', bg: 'bg-gray-800 border-gray-700' },
}

export function SignalsClient() {
  const queryClient = useQueryClient()
  const { data: signals = [], isLoading } = useQuery({
    queryKey: ['all-signals'],
    queryFn: fetchAllSignals,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 5 * 60 * 1000,
  })

  const deleteSignalMutation = useMutation({
    mutationFn: async (signalId: string) => {
      const supabaseClient = createClient()
      const { data: { session } } = await supabaseClient.auth.getSession()
      const res = await fetch(`/api/signals/${signalId}/cancel`, {
        method: 'POST',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error?.message || 'No se pudo cancelar la senal')
      }
    },
    onSuccess: () => {
      toast.success('Senal cancelada')
      queryClient.invalidateQueries({ queryKey: ['all-signals'] })
      queryClient.invalidateQueries({ queryKey: ['active-signals'] })
    },
    onError: () => {
      toast.error('Error al cancelar senal')
    },
  })
  const executeSignalMutation = useMutation({
    mutationFn: async (signal: Signal) => {
      if (signal.type !== 'BUY') {
        toast.error('Solo las senales de compra abren posiciones nuevas')
        return
      }

      const supabaseClient = createClient()
      const { data: { user } } = await supabaseClient.auth.getUser()
      if (!user) {
        toast.error('Inicia sesion para operar')
        return
      }

      const { data: { session } } = await supabaseClient.auth.getSession()
      const profile = await fetchVirtualBalanceProfile(session?.access_token)
      const virtualBalance = Number(profile.virtual_balance ?? 0)
      if (!Number.isFinite(virtualBalance) || virtualBalance <= 0) {
        toast.error('No tienes capital virtual disponible. Ajusta el capital en Portafolio.')
        return
      }

      const defaultAmount = Math.min(DEFAULT_ORDER_AMOUNT, virtualBalance)
      const input = window.prompt(
        `Monto virtual a invertir en ${signal.symbol}. Saldo disponible: ${formatCurrency(virtualBalance)}`,
        String(defaultAmount)
      )
      if (input === null) return

      const amount = parseOrderAmount(input)
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error('Ingresa un monto valido')
        return
      }

      const price = await fetchCurrentPrice(signal.symbol, signal.market, signal.price)
      if (!Number.isFinite(price) || price <= 0) {
        toast.error(`No pude obtener precio valido para ${signal.symbol}`)
        return
      }

      const res = await fetch('/api/portfolio/trade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          side: 'BUY',
          symbol: signal.symbol,
          name: signal.symbol,
          market: signal.market,
          amount,
          price,
          source: 'signal',
          signalId: signal.id,
          notes: `Compra fraccional simulada desde senal ${signal.id}`,
        }),
      })

      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error?.message || 'Error al ejecutar senal')
      }

      const quantity = Number(body.data?.position?.quantity ?? amount / price)
      toast.success(`Compraste ${formatQuantity(quantity)} ${signal.symbol} por ${formatCurrency(amount)}`)
      queryClient.invalidateQueries({ queryKey: ['all-signals'] })
      queryClient.invalidateQueries({ queryKey: ['active-signals'] })
      queryClient.invalidateQueries({ queryKey: ['positions'] })
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] })
    },
    onError: (error) => {
      console.warn('[execute signal]', error)
      toast.error(error instanceof Error ? error.message : 'Error al ejecutar senal')
    },
  })
  const activeSignals = signals.filter((s) => s.status === 'active')
  const buySignals = activeSignals.filter((s) => s.type === 'BUY').length
  const sellSignals = activeSignals.filter((s) => s.type === 'SELL').length

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Señales</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {activeSignals.length} activas · {buySignals} compra · {sellSignals} venta
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Activas" value={activeSignals.length} color="emerald" icon={Zap} />
        <StatCard label="Compra" value={buySignals} color="emerald" icon={TrendingUp} />
        <StatCard label="Venta" value={sellSignals} color="red" icon={TrendingDown} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
        </div>
      ) : activeSignals.length === 0 ? (
        <div className="glass rounded-xl py-16 text-center">
          <Zap className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 mb-2">No hay señales activas</p>
          <p className="text-xs text-gray-600">Ve a Análisis para analizar una acción y guardar señales</p>
          <Link href="/analysis" className="inline-block mt-4 text-xs text-emerald-400 hover:text-emerald-300">
            Ir a Análisis ?
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeSignals.map((signal) => {
            const config = signalConfig[signal.type]
            const Icon = config.icon
            const canExecute = signal.type === 'BUY'
            const performanceIsPositive = signal.performance === undefined || signal.performance >= 0
            const signalContradictsPrice = signal.type === 'BUY' && signal.performance !== undefined && signal.performance < 0

            return (
              <div key={signal.id} className={cn('glass rounded-xl p-4 border', signalContradictsPrice ? 'bg-amber-500/10 border-amber-500/25' : config.bg)}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <Link
                      href={`/analysis?symbol=${signal.symbol}&market=${signal.market}&range=${signal.timeframe}`}
                      className="flex items-center gap-1.5 group"
                    >
                      <span className="font-mono font-bold text-white text-base group-hover:text-emerald-400 transition-colors">
                        {signal.symbol}
                      </span>
                      <ArrowUpRight className="w-3 h-3 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-500">{signal.market}</span>
                      <span className="text-xs text-gray-600">·</span>
                      <span className="text-xs text-gray-500">{signal.timeframe}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-emerald-500/10 text-emerald-400">
                        Activa
                      </span>
                    </div>
                  </div>

                  <div className={cn('flex items-center gap-1.5 font-bold text-sm', config.color)}>
                    <Icon className="w-4 h-4" />
                    {config.label}
                  </div>
                </div>

                {signal.price && (
                  <div className="text-xs text-gray-500 mb-2 space-y-1">
                    <p>Precio se?al: <span className="font-mono text-white">{signal.price.toFixed(2)}</span></p>
                    {signal.currentPrice !== undefined && (
                      <p>Precio actual: <span className="font-mono text-white">{signal.currentPrice.toFixed(2)}</span></p>
                    )}
                    {signal.performance !== undefined && (
                      <p className={cn('font-semibold', performanceIsPositive ? 'text-emerald-400' : 'text-red-400')}>
                        Rendimiento desde se?al: {performanceIsPositive ? '+' : ''}{signal.performance.toFixed(2)}%
                      </p>
                    )}
                    {signalContradictsPrice && (
                      <p className="text-amber-300">Se?al BUY guardada, pero el precio actual va en contra. Revalidar en An?lisis.</p>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full', signal.type === 'BUY' ? 'bg-emerald-400' : signal.type === 'SELL' ? 'bg-red-400' : 'bg-gray-500')}
                      style={{ width: `${signal.strength}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 font-mono w-8">{signal.strength}%</span>
                </div>

                {signal.reason && (
                  <p className="text-xs text-gray-400 line-clamp-2">{signal.reason}</p>
                )}

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      executeSignalMutation.mutate(signal)
                    }}
                    disabled={!canExecute || executeSignalMutation.isPending}
                    className="flex-1 py-1.5 text-[10px] font-bold bg-emerald-500/20 hover:bg-emerald-500 text-emerald-400 hover:text-white rounded border border-emerald-500/30 transition-all uppercase tracking-wider disabled:opacity-50 disabled:hover:bg-emerald-500/20 disabled:hover:text-emerald-400"
                    title={canExecute ? 'Comprar fracción con capital virtual' : 'Esta señal no abre una posición nueva'}
                  >
                    {executeSignalMutation.isPending ? 'Ejecutando...' : 'Comprar fracción'}
                  </button>
                  <Link
                    href={`/analysis?symbol=${signal.symbol}&market=${signal.market}&range=${signal.timeframe}`}
                    className="flex-1 py-1.5 text-[10px] font-bold bg-gray-800 hover:bg-gray-700 text-gray-400 rounded border border-gray-700 text-center transition-all uppercase tracking-wider"
                  >
                    Ver Gráfico
                  </Link>
                  <button
                    onClick={() => {
                      if (confirm('¿Cancelar esta senal?')) {
                        deleteSignalMutation.mutate(signal.id)
                      }
                    }}
                    disabled={deleteSignalMutation.isPending}
                    className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors disabled:opacity-50"
                    title="Cancelar senal"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="text-[10px] text-gray-600 mt-3">
                  {format(new Date(signal.created_at), "d 'de' MMM, HH:mm", { locale: es })}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color, icon: Icon }: {
  label: string; value: number; color: string; icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn('w-4 h-4', color === 'emerald' ? 'text-emerald-400' : 'text-red-400')} />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <span className={cn('text-2xl font-bold font-mono', color === 'emerald' ? 'text-emerald-400' : 'text-red-400')}>
        {value}
      </span>
    </div>
  )
}
