'use client'

import { useQuery } from '@tanstack/react-query'
import { Market } from '@/types'
import { ArrowUp, ArrowDown, Loader2 } from 'lucide-react'
import { cn, formatCurrency, formatPercent, formatLargeNumber } from '@/lib/utils'

interface QuoteHeaderProps {
  symbol: string
  market: Market
}

interface QuoteData {
  name: string
  price: number
  change: number
  changePercent: number
  high: number
  low: number
  open: number
  volume: number
  marketCap?: number
  currency: string
}

export function QuoteHeader({ symbol, market }: QuoteHeaderProps) {
  const { data: quote, isLoading, error } = useQuery<QuoteData>({
    queryKey: ['quote-header', symbol, market],
    queryFn: async () => {
      const res = await fetch(`/api/market/quote?symbol=${encodeURIComponent(symbol)}&market=${market}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const message = typeof body?.error === 'string' ? body.error : 'Quote error'
        throw new Error(`${res.status}:${message}`)
      }
      const data = await res.json()
      return data.data
    },
    refetchInterval: 30 * 1000,
    staleTime: 15 * 1000,
  })

  if (isLoading) {
    return (
      <div className="px-6 py-3 border-b border-gray-800 flex items-center gap-3">
        <div className="h-8 w-24 bg-gray-800 rounded animate-pulse" />
        <div className="h-6 w-32 bg-gray-800 rounded animate-pulse" />
      </div>
    )
  }

  const errorMessage = error instanceof Error ? error.message : ''
  const notFound = errorMessage.startsWith('404:') || !quote

  if (error && !notFound) {
    return (
      <div className="px-6 py-3 border-b border-gray-800">
        <span className="text-sm text-amber-400">Error al cargar cotización de {symbol}</span>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="px-6 py-3 border-b border-gray-800">
        <span className="text-sm text-gray-500">Símbolo no encontrado: {symbol}</span>
      </div>
    )
  }

  const isPositive = quote.changePercent >= 0

  return (
    <div className="px-6 py-3 border-b border-gray-800 bg-gray-900/30 flex flex-wrap items-center gap-x-6 gap-y-2">
      {/* Symbol + Price */}
      <div className="flex items-baseline gap-3">
        <span className="text-lg font-bold font-mono text-white">{symbol}</span>
        <span className="text-2xl font-bold font-mono text-white">
          {formatCurrency(quote.price, quote.currency)}
        </span>
        <div className={cn('flex items-center gap-1', isPositive ? 'text-emerald-400' : 'text-red-400')}>
          {isPositive ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
          <span className="text-sm font-semibold font-mono">
            {isPositive ? '+' : ''}{quote.change.toFixed(2)} ({formatPercent(quote.changePercent)})
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <Stat label="Apertura" value={quote.open.toFixed(2)} />
        <Stat label="Máx" value={quote.high.toFixed(2)} className="text-emerald-400" />
        <Stat label="Mín" value={quote.low.toFixed(2)} className="text-red-400" />
        <Stat label="Volumen" value={formatLargeNumber(quote.volume)} />
        {quote.marketCap && (
          <Stat label="Cap. Mercado" value={formatLargeNumber(quote.marketCap)} />
        )}
        <span className="text-gray-600">
          {'🇺🇸 NYSE/NASDAQ'}
        </span>
      </div>
    </div>
  )
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span>
      {label}:{' '}
      <span className={cn('font-mono text-white', className)}>{value}</span>
    </span>
  )
}
