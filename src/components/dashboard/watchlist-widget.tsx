'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Market } from '@/types'
import { formatPercent } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { ArrowUp, ArrowDown, Plus, X, Loader2, Star } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'

interface WatchlistItemData {
  id: string
  symbol: string
  name: string
  market: Market
  price?: number
  change?: number
  changePercent?: number
}

async function fetchWatchlist(): Promise<WatchlistItemData[]> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data: items } = await supabase
      .from('watchlist_items')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)

    if (!items || items.length === 0) return []

    // Fetch live prices for each item
    const withPrices = await Promise.all(
      items.map(async (item) => {
        try {
          const res = await fetch(`/api/market/quote?symbol=${item.symbol}&market=${item.market}`)
          if (!res.ok) return item
          const data = await res.json()
          const q = data.data
          return { ...item, price: q?.price, change: q?.change, changePercent: q?.changePercent }
        } catch {
          return item
        }
      })
    )

    return withPrices
  } catch (e) {
    console.error('[Watchlist] Sync error:', e)
    return []
  }
}

export function WatchlistWidget() {
  const [addingSymbol, setAddingSymbol] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  const { data: items = [], isLoading, refetch } = useQuery({
    queryKey: ['watchlist'],
    queryFn: fetchWatchlist,
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  })

  const supabase = createClient()

  const handleAddSymbol = async () => {
    if (!addingSymbol.trim()) return
    setIsAdding(true)
    try {
      const symbol = addingSymbol.toUpperCase().trim()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { error } = await supabase.from('watchlist_items').insert({
        user_id: user.id,
        symbol,
        name: symbol,
        market: 'US',
      })

      if (error) {
        if (error.code === '23505') toast.error('El símbolo ya está en tu watchlist')
        else toast.error('Error al agregar')
        return
      }

      toast.success(`${symbol} agregado a tu watchlist`)
      setAddingSymbol('')
      refetch()
    } catch {
      toast.error('Error inesperado')
    } finally {
      setIsAdding(false)
    }
  }

  const handleRemove = async (id: string, symbol: string) => {
    const { error } = await supabase.from('watchlist_items').delete().eq('id', id)
    if (error) { toast.error('Error al eliminar'); return }
    toast.success(`${symbol} eliminado`)
    refetch()
  }

  return (
    <div className="glass rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Star className="w-4 h-4 text-emerald-400" />
          Watchlist
        </h2>

        {/* Add symbol input */}
        <div className="flex items-center gap-2">
          <input
            value={addingSymbol}
            onChange={(e) => setAddingSymbol(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()}
            placeholder="AAPL, MSFT…"
            className="h-7 px-3 text-xs bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 outline-none focus:border-emerald-500 w-32"
          />
          <button
            onClick={handleAddSymbol}
            disabled={isAdding}
            className="h-7 w-7 flex items-center justify-center bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>

      {/* Items */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center">
          <Star className="w-8 h-8 text-gray-700 mx-auto mb-2" />
          <p className="text-sm text-gray-500">Tu watchlist está vacía</p>
          <p className="text-xs text-gray-600 mt-1">Agrega símbolos como AAPL, MSFT</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-800/50">
          {items.map((item, idx) => {
            const isPositive = (item.changePercent ?? 0) >= 0
            return (
              <div key={`${item.id}-${idx}`} className="flex items-center px-5 py-3 hover:bg-gray-800/20 transition-colors group">
                <Link
                  href={`/analysis?symbol=${item.symbol}&market=${item.market}`}
                  className="flex items-center justify-between flex-1 min-w-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-gray-400">{item.symbol.slice(0, 2)}</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white font-mono">{item.symbol}</p>
                      <p className="text-xs text-gray-500">NYSE/NASDAQ</p>
                    </div>
                  </div>

                  <div className="text-right">
                    {item.price ? (
                      <>
                        <p className="text-sm font-semibold text-white font-mono">{item.price.toFixed(2)}</p>
                        <p className={cn('text-xs flex items-center justify-end gap-0.5 font-mono', isPositive ? 'text-emerald-400' : 'text-red-400')}>
                          {isPositive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                          {formatPercent(item.changePercent ?? 0)}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-gray-600">—</p>
                    )}
                  </div>
                </Link>

                <button
                  onClick={() => handleRemove(item.id, item.symbol)}
                  className="ml-3 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
