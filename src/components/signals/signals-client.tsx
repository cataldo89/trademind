'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Minus, Zap, Loader2, ArrowUpRight, Trash2 } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

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

  return Promise.all(signals.map(async (signal) => {
    try {
      const quoteRes = await fetch(`/api/market/quote?symbol=${encodeURIComponent(signal.symbol)}&market=${signal.market}`, { cache: 'no-store' })
      if (!quoteRes.ok) return signal
      const payload = await quoteRes.json()
      const quote = payload.data || payload
      const currentPrice = Number(quote?.price || quote?.regularMarketPrice)
      const entryPrice = Number(signal.price)
      if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) return signal
      return {
        ...signal,
        currentPrice,
        performance: ((currentPrice - entryPrice) / entryPrice) * 100,
      }
    } catch {
      return signal
    }
  }))
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
  if (Number.isFinite(fallback) && fallback > 0) return fallback

  const res = await fetch(`/api/market/quote?symbol=${encodeURIComponent(symbol)}&market=${market}`)
  if (!res.ok) return 0
  const payload = await res.json()
  const quote = payload.data || payload
  const price = Number(quote?.price || quote?.regularMarketPrice)
  return Number.isFinite(price) ? price : 0
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
      const { error } = await supabaseClient.from('signals').delete().eq('id', signalId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Señal eliminada')
      queryClient.invalidateQueries({ queryKey: ['all-signals'] })
      queryClient.invalidateQueries({ queryKey: ['active-signals'] })
    },
    onError: () => {
      toast.error('Error al eliminar señal')
    },
  })

  const executeSignalMutation = useMutation({
    mutationFn: async (signal: Signal) => {
      if (signal.type !== 'BUY') {
        toast.error('Solo las señales de compra abren posiciones nuevas')
        return
      }

      const supabaseClient = createClient()
      const { data: { user } } = await supabaseClient.auth.getUser()
      if (!user) {
        toast.error('Inicia sesión para operar')
        return
      }

      const { data: profile, error: profileError } = await supabaseClient
        .from('profiles')
        .select('virtual_balance')
        .eq('id', user.id)
        .maybeSingle()

      if (profileError) throw profileError

      const virtualBalance = Number(profile?.virtual_balance ?? 0)
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
        toast.error('Ingresa un monto válido')
        return
      }
      if (amount > virtualBalance) {
        toast.error(`Saldo insuficiente. Disponible: ${formatCurrency(virtualBalance)}`)
        return
      }

      const price = await fetchCurrentPrice(signal.symbol, signal.market, signal.price)
      if (!Number.isFinite(price) || price <= 0) {
        toast.error(`No pude obtener precio válido para ${signal.symbol}`)
        return
      }

      const quantity = Number((amount / price).toFixed(8))
      const entryDate = new Date().toISOString().split('T')[0]
      const nextBalance = Number((virtualBalance - amount).toFixed(2))

      const { data: position, error: positionError } = await supabaseClient
        .from('positions')
        .insert({
          user_id: user.id,
          symbol: signal.symbol,
          name: signal.symbol,
          market: signal.market,
          quantity,
          entry_price: price,
          entry_date: entryDate,
          currency: 'USD',
          notes: `Orden fraccional simulada desde señal ${signal.id}`,
          status: 'open',
        })
        .select('id')
        .single()

      if (positionError) throw positionError

      const { error: balanceError } = await supabaseClient
        .from('profiles')
        .update({ virtual_balance: nextBalance })
        .eq('id', user.id)

      if (balanceError) {
        if (position?.id) {
          await supabaseClient.from('positions').delete().eq('id', position.id)
        }
        throw balanceError
      }

      const { error: transactionError } = await supabaseClient.from('transactions').insert({
        user_id: user.id,
        symbol: signal.symbol,
        name: signal.symbol,
        market: signal.market,
        type: 'BUY',
        quantity,
        price,
        currency: 'USD',
        notes: `Compra fraccional simulada desde señal ${signal.id}`,
      })
      if (transactionError) console.warn('[execute signal transaction]', transactionError)

      const { error: signalError } = await supabaseClient
        .from('signals')
        .update({ status: 'cancelled' })
        .eq('id', signal.id)
      if (signalError) console.warn('[execute signal status]', signalError)

      toast.success(`Compraste ${formatQuantity(quantity)} ${signal.symbol} por ${formatCurrency(amount)}`)
      queryClient.invalidateQueries({ queryKey: ['all-signals'] })
      queryClient.invalidateQueries({ queryKey: ['active-signals'] })
      queryClient.invalidateQueries({ queryKey: ['positions'] })
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] })
    },
    onError: (error) => {
      console.warn('[execute signal]', error)
      toast.error('Error al ejecutar señal')
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
            Ir a Análisis →
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
                      if (confirm('¿Eliminar esta señal?')) {
                        deleteSignalMutation.mutate(signal.id)
                      }
                    }}
                    disabled={deleteSignalMutation.isPending}
                    className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors disabled:opacity-50"
                    title="Eliminar señal"
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
