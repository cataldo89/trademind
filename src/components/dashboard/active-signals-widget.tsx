'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { TrendingUp, TrendingDown, Minus, Loader2, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Signal {
  id: string
  symbol: string
  type: 'BUY' | 'SELL' | 'HOLD'
  strength: number
  reason: string
  price: number
  market: string
  timeframe: string
  created_at: string
}

async function fetchActiveSignals(): Promise<Signal[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from('signals')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(6)

  return data || []
}

const signalConfig = {
  BUY: {
    label: 'Compra',
    icon: TrendingUp,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
    dot: 'bg-emerald-400',
  },
  SELL: {
    label: 'Venta',
    icon: TrendingDown,
    color: 'text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
    dot: 'bg-red-400',
  },
  HOLD: {
    label: 'Mantener',
    icon: Minus,
    color: 'text-gray-400',
    bg: 'bg-gray-800 border-gray-700',
    dot: 'bg-gray-500',
  },
}

export function ActiveSignalsWidget() {
  const { data: signals = [], isLoading } = useQuery({
    queryKey: ['active-signals'],
    queryFn: fetchActiveSignals,
    refetchInterval: 5 * 60 * 1000,
  })

  return (
    <div className="glass rounded-xl overflow-hidden h-full">
      <div className="px-5 py-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-400" />
          Señales activas
        </h2>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
        </div>
      ) : signals.length === 0 ? (
        <div className="py-12 text-center px-5">
          <Zap className="w-8 h-8 text-gray-700 mx-auto mb-2" />
          <p className="text-sm text-gray-500">Sin señales activas</p>
          <p className="text-xs text-gray-600 mt-1">
            Ve a Análisis para generar señales
          </p>
        </div>
      ) : (
        <div className="p-3 space-y-2">
          {signals.map((signal) => {
            const config = signalConfig[signal.type]
            const Icon = config.icon

            return (
              <div
                key={signal.id}
                className={cn('p-3 rounded-lg border', config.bg)}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={cn('w-1.5 h-1.5 rounded-full', config.dot)} />
                    <span className="text-xs font-mono font-bold text-white">{signal.symbol}</span>
                  </div>
                  <div className={cn('flex items-center gap-1 text-xs font-semibold', config.color)}>
                    <Icon className="w-3 h-3" />
                    {config.label}
                  </div>
                </div>
                <p className="text-xs text-gray-500 line-clamp-2">{signal.reason}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-600">{signal.timeframe}</span>
                  {/* Strength bar */}
                  <div className="flex items-center gap-1.5">
                    <div className="h-1 w-12 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', signal.type === 'BUY' ? 'bg-emerald-400' : signal.type === 'SELL' ? 'bg-red-400' : 'bg-gray-500')}
                        style={{ width: `${signal.strength}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">{signal.strength}%</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

# bumped: 2026-05-05T04:21:00