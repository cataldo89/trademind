'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatPercent, getPnLColor } from '@/lib/utils'
import { Briefcase, TrendingUp, TrendingDown, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { DEFAULT_VIRTUAL_BALANCE, fetchVirtualBalanceProfile } from '@/lib/virtual-balance'

interface PortfolioStats {
  totalValue: number
  totalPnL: number
  totalPnLPercent: number
  dayPnL: number
  dayPnLPercent: number
  positionsCount: number
  virtualBalance: number
}

async function fetchPortfolioStats(): Promise<PortfolioStats | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: { session } } = await supabase.auth.getSession()
  let virtualBalance = DEFAULT_VIRTUAL_BALANCE

  try {
    virtualBalance = (await fetchVirtualBalanceProfile(session?.access_token)).virtual_balance
  } catch {
    // Keep dashboard usable even if profile capital cannot be loaded.
  }

  const { data: positions } = await supabase
    .from('positions')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'open')

  if (!positions || positions.length === 0) {
    return { totalValue: 0, totalPnL: 0, totalPnLPercent: 0, dayPnL: 0, dayPnLPercent: 0, positionsCount: 0, virtualBalance }
  }

  const symbols = Array.from(new Set(positions.map((pos) => pos.symbol).filter(Boolean)))
  const quoteBySymbol = new Map<string, { price?: number; change?: number }>()

  if (symbols.length > 0) {
    try {
      const market = positions[0]?.market || 'US'
      const res = await fetch(`/api/market/quote?symbols=${encodeURIComponent(symbols.join(','))}&market=${market}`)
      if (res.ok) {
        const data = await res.json()
        const quotes = Array.isArray(data.data) ? data.data : [data.data]
        quotes.forEach((quote: { symbol?: string; price?: number; regularMarketPrice?: number; change?: number; changePercent?: number }) => {
          if (quote?.symbol) quoteBySymbol.set(String(quote.symbol).toUpperCase(), quote)
        })
      }
    } catch {
      // Keep portfolio summary available with entry prices if market data fails.
    }
  }

  const updatedPositions = positions.map((pos) => {
    const quote = quoteBySymbol.get(String(pos.symbol).toUpperCase())
    const currentPrice = Number(quote?.price)
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return pos

    const value = currentPrice * pos.quantity
    const cost = pos.entry_price * pos.quantity
    const pnl = value - cost
    const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0
    const dayPnL = Number(quote?.change || 0) * pos.quantity

    return { ...pos, currentPrice, value, cost, pnl, pnlPercent, dayPnL }
  })
  const totalValue = updatedPositions.reduce((sum, p) => sum + (p.value || p.entry_price * p.quantity), 0)
  const totalCost = updatedPositions.reduce((sum, p) => sum + p.entry_price * p.quantity, 0)
  const totalPnL = totalValue - totalCost
  const totalPnLPercent = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0
  const dayPnL = updatedPositions.reduce((sum, p) => sum + (p.dayPnL || 0), 0)
  const dayPnLPercent = totalValue > 0 ? (dayPnL / totalValue) * 100 : 0

  return {
    totalValue,
    totalPnL,
    totalPnLPercent,
    dayPnL,
    dayPnLPercent,
    positionsCount: positions.length,
    virtualBalance
  }
}

export function PortfolioSummaryWidget() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['portfolio-summary'],
    queryFn: fetchPortfolioStats,
    refetchInterval: 2 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  if (isLoading) {
    return (
      <div className="glass rounded-xl p-6 flex items-center justify-center h-40">
        <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
      </div>
    )
  }

  if (!stats || stats.positionsCount === 0) {
    return (
      <div className="glass rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-emerald-400" />
            Portafolio
          </h2>
          <Link href="/portfolio" className="text-xs text-emerald-400 hover:text-emerald-300">
            Ver portafolio →
          </Link>
        </div>
        <div className="text-center py-6">
          <p className="text-sm text-gray-500 mb-3">No tienes posiciones abiertas</p>
          <div className="flex items-center justify-center gap-4">
             <div className="text-left">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Capital Virtual</p>
                <p className="text-lg font-bold text-white font-mono">{formatCurrency(stats?.virtualBalance ?? 10000)}</p>
             </div>
             <Link
                href="/portfolio"
                className="inline-flex items-center gap-1.5 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded-lg hover:bg-emerald-500/20 transition-colors"
              >
                Agregar posición
              </Link>
          </div>
        </div>
      </div>
    )
  }

  const dayPositive = (stats.dayPnL || 0) >= 0
  const totalPositive = (stats.totalPnL || 0) >= 0

  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-emerald-400" />
          Portafolio
        </h2>
        <div className="flex items-center gap-4">
           <div className="text-right">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider">Capital Virtual</p>
              <p className="text-sm font-bold text-emerald-400 font-mono">{formatCurrency(stats.virtualBalance ?? 10000)}</p>
           </div>
           <Link href="/portfolio" className="text-xs text-emerald-400 hover:text-emerald-300">
             Ver todo →
           </Link>
        </div>
      </div>

      <div className="p-5 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Valor total"
          value={formatCurrency(stats.totalValue)}
          className="col-span-2 lg:col-span-1"
        />
        <StatCard
          label="P&L total"
          value={formatCurrency(Math.abs(stats.totalPnL))}
          sub={formatPercent(stats.totalPnLPercent)}
          positive={totalPositive}
        />
        <StatCard
          label="P&L del día"
          value={formatCurrency(Math.abs(stats.dayPnL))}
          sub={formatPercent(stats.dayPnLPercent)}
          positive={dayPositive}
        />
        <StatCard
          label="Posiciones"
          value={String(stats.positionsCount)}
          sub="abiertas"
        />
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  positive,
  className,
}: {
  label: string
  value: string
  sub?: string
  positive?: boolean
  className?: string
}) {
  return (
    <div className={cn('p-3 rounded-lg bg-gray-800/40', className)}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={cn(
        'text-lg font-bold font-mono',
        positive === undefined ? 'text-white'
          : positive ? 'text-emerald-400' : 'text-red-400'
      )}>
        {positive !== undefined && (positive ? '+' : '-')}{value}
      </p>
      {sub && (
        <p className={cn(
          'text-xs font-mono mt-0.5',
          positive === undefined ? 'text-gray-500'
            : positive ? 'text-emerald-400/70' : 'text-red-400/70'
        )}>
          {sub}
        </p>
      )}
    </div>
  )
}
