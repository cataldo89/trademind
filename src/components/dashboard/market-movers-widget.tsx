'use client'

import { useQuery } from '@tanstack/react-query'
import { Market } from '@/types'
import { useState } from 'react'
import { formatPercent } from '@/lib/utils'
import { ArrowUp, ArrowDown, Activity, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

type TabType = 'gainers' | 'losers' | 'mostActive'

interface Mover {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
  volume: number
  market: Market
}

interface MoversData {
  gainers: Mover[]
  losers: Mover[]
  mostActive: Mover[]
}

function useMarketMovers(market: Market) {
  return useQuery<MoversData>({
    queryKey: ['market-movers', market],
    queryFn: async () => {
      const res = await fetch(`/api/market/movers?market=${market}`)
      if (!res.ok) throw new Error('Error fetching movers')
      const data = await res.json()
      return data.data
    },
    refetchInterval: 5 * 60 * 1000, // 5 minutes
    staleTime: 60 * 1000,
  })
}

export function MarketMoversWidget() {
  const [market, setMarket] = useState<Market>('US')
  const [tab, setTab] = useState<TabType>('gainers')
  const { data, isLoading, error } = useMarketMovers(market)

  const tabs: { key: TabType; label: string }[] = [
    { key: 'gainers', label: 'Ganadores' },
    { key: 'losers', label: 'Perdedores' },
    { key: 'mostActive', label: 'Más activos' },
  ]

  const movers: Mover[] = data?.[tab] || []

  return (
    <div className="glass rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          Movimientos del mercado
        </h2>

        {/* Market selector */}
        <div className="flex items-center gap-1 bg-gray-800/50 rounded-lg p-0.5">
          <button
            key="US"
            onClick={() => setMarket('US')}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
              market === 'US'
                ? 'bg-emerald-500 text-white'
                : 'text-gray-400 hover:text-white'
            )}
          >
            US
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex-1 py-2.5 text-xs font-medium transition-colors',
              tab === t.key
                ? 'text-emerald-400 border-b-2 border-emerald-400'
                : 'text-gray-500 hover:text-gray-300'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="divide-y divide-gray-800/50">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-12 gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4" />
            Error al cargar datos
          </div>
        )}

        {!isLoading && !error && movers.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-500">
            Mercado cerrado o sin datos disponibles
          </div>
        )}

        {movers.map((mover, idx) => (
          <MoverRow key={`${mover.symbol}-${idx}`} mover={mover} />
        ))}
      </div>
    </div>
  )
}

function MoverRow({ mover }: { mover: Mover }) {
  const isPositive = mover.changePercent >= 0

  return (
    <Link
      href={`/analysis?symbol=${mover.symbol}&market=${mover.market}`}
      className="flex items-center justify-between px-5 py-3 hover:bg-gray-800/30 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold',
          isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
        )}>
          {mover.symbol.slice(0, 2)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white font-mono">{mover.symbol}</p>
          <p className="text-xs text-gray-500 truncate max-w-32">{mover.name}</p>
        </div>
      </div>

      <div className="text-right flex-shrink-0 ml-4">
        <p className="text-sm font-semibold text-white font-mono">{mover.price.toFixed(2)}</p>
        <p className={cn('text-xs flex items-center justify-end gap-0.5 font-mono', isPositive ? 'text-emerald-400' : 'text-red-400')}>
          {isPositive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
          {formatPercent(mover.changePercent)}
        </p>
      </div>
    </Link>
  )
}

# bumped: 2026-05-05T04:21:00