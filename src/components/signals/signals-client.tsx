'use client'

import { useQuery } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Minus, Zap, Loader2, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

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

async function fetchAllSignals(): Promise<Signal[]> {
  // Import createClient dynamically or use a new one to avoid conflicts
  const { createClient } = await import('@/lib/supabase/client')
  const supabaseClient = createClient()
  const { data: { session } } = await supabaseClient.auth.getSession()
  const token = session?.access_token

  const res = await fetch('/api/signals', { 
    cache: 'no-store',
    headers: {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    }
  })
  if (!res.ok) return []
  const body = await res.json()
  return body.data || []
}

const signalConfig = {
  BUY: { label: 'COMPRAR', icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  SELL: { label: 'VENDER', icon: TrendingDown, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  HOLD: { label: 'MANTENER', icon: Minus, color: 'text-gray-400', bg: 'bg-gray-800 border-gray-700' },
}

export function SignalsClient() {
  const { data: signals = [], isLoading } = useQuery({
    queryKey: ['all-signals'],
    queryFn: fetchAllSignals,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 5 * 60 * 1000,
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

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Activas"
          value={activeSignals.length}
          color="emerald"
          icon={Zap}
        />
        <StatCard label="Compra" value={buySignals} color="emerald" icon={TrendingUp} />
        <StatCard label="Venta" value={sellSignals} color="red" icon={TrendingDown} />
      </div>

      {/* Signals grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
        </div>
      ) : signals.length === 0 ? (
        <div className="glass rounded-xl py-16 text-center">
          <Zap className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 mb-2">No hay señales generadas</p>
          <p className="text-xs text-gray-600">Ve a Análisis para analizar una acción y guardar señales</p>
          <Link href="/analysis" className="inline-block mt-4 text-xs text-emerald-400 hover:text-emerald-300">
            Ir a Análisis →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {signals.map((signal) => {
            const config = signalConfig[signal.type]
            const Icon = config.icon

            return (
              <div key={signal.id} className={cn('glass rounded-xl p-4 border', config.bg)}>
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <Link
                      href={`/analysis?symbol=${signal.symbol}&market=${signal.market}`}
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
                      <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', signal.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-800 text-gray-500')}>
                        {signal.status === 'active' ? 'Activa' : 'Expirada'}
                      </span>
                    </div>
                  </div>

                  <div className={cn('flex items-center gap-1.5 font-bold text-sm', config.color)}>
                    <Icon className="w-4 h-4" />
                    {config.label}
                  </div>
                </div>

                {/* Price */}
                {signal.price && (
                  <p className="text-xs text-gray-500 mb-2">
                    Precio: <span className="font-mono text-white">{signal.price.toFixed(2)}</span>
                  </p>
                )}

                {/* Strength bar */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full', signal.type === 'BUY' ? 'bg-emerald-400' : signal.type === 'SELL' ? 'bg-red-400' : 'bg-gray-500')}
                      style={{ width: `${signal.strength}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 font-mono w-8">{signal.strength}%</span>
                </div>

                {/* Reason */}
                {signal.reason && (
                  <p className="text-xs text-gray-400 line-clamp-2">{signal.reason}</p>
                )}

                {/* Date */}
                <p className="text-xs text-gray-600 mt-2">
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
