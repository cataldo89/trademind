'use client'

import { useState, useCallback } from 'react'
import { Market } from '@/types'
import { Search, X, Loader2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { debounce } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { POPULAR_US_SYMBOLS, AI_TECH_SYMBOLS, POPULAR_ETFS, ZESTY_SYMBOLS } from '@/lib/market-data'

interface SymbolSearchProps {
  symbol: string
  market: Market
  onSelect: (symbol: string, market: Market) => void
}

interface SearchResult {
  symbol: string
  name: string
  market: Market
}

const QUICK_SYMBOLS: SearchResult[] = [
  ...POPULAR_US_SYMBOLS.slice(0, 5).map(s => ({ ...s, market: 'US' as Market })),
  ...POPULAR_ETFS.slice(0, 3).map(s => ({ ...s, market: 'US' as Market })),
  ...ZESTY_SYMBOLS.map(s => ({ ...s, market: 'US' as Market })),
]

export function SymbolSearch({ symbol, market, onSelect }: SymbolSearchProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filteredQuick = QUICK_SYMBOLS.filter(
    (s) =>
      s.symbol.toLowerCase().includes(query.toLowerCase()) ||
      s.name.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/60 border border-gray-700 rounded-lg text-sm hover:border-emerald-500/50 transition-colors min-w-32"
      >
        <Search className="w-3.5 h-3.5 text-gray-400" />
        <span className="font-mono font-semibold text-white">{symbol}</span>
        <span className="text-xs text-gray-500 ml-1">{market}</span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          <div className="absolute top-10 left-0 z-50 w-80 glass rounded-xl shadow-2xl overflow-hidden border border-gray-700">
            {/* Search input */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-800">
              <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar símbolo... (AAPL, MSFT)"
                className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
              />
              {query && (
                <button onClick={() => setQuery('')}>
                  <X className="w-3.5 h-3.5 text-gray-400" />
                </button>
              )}
            </div>

            {/* Results */}
            <div className="max-h-72 overflow-y-auto">
              {!query && (
                <p className="px-3 py-2 text-xs text-gray-600 uppercase font-semibold tracking-wider">
                  Populares
                </p>
              )}

              {filteredQuick.length === 0 && (
                <div className="py-6 text-center text-sm text-gray-500">
                  No se encontraron resultados
                </div>
              )}

              {filteredQuick.map((item, idx) => (
                <button
                  key={`${item.symbol}-quick-${idx}`}
                  onClick={() => {
                    onSelect(item.symbol, item.market)
                    setIsOpen(false)
                    setQuery('')
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-800/60 transition-colors text-left',
                    symbol === item.symbol && 'bg-emerald-500/5'
                  )}
                >
                  <div>
                    <p className="text-sm font-mono font-semibold text-white">
                      {item.symbol}
                    </p>
                    <p className="text-xs text-gray-500 truncate max-w-52">{item.name}</p>
                  </div>
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded font-medium',
                    'bg-emerald-500/10 text-emerald-400'
                  )}>
                    {item.market}
                  </span>
                </button>
              ))}

              {/* Categories */}
              {!query && (
                <>
                  <p className="px-3 py-2 text-xs text-gray-600 uppercase font-semibold tracking-wider border-t border-gray-800 mt-1">
                    IA & Tecnología
                  </p>
                  {AI_TECH_SYMBOLS.slice(0, 4).map((item, idx) => (
                    <button
                      key={`${item.symbol}-ai-${idx}`}
                      onClick={() => {
                        onSelect(item.symbol, 'US')
                        setIsOpen(false)
                      }}
                      className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-800/60 transition-colors text-left"
                    >
                      <div>
                        <p className="text-sm font-mono font-semibold text-white">{item.symbol}</p>
                        <p className="text-xs text-gray-500">{item.name}</p>
                      </div>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">US</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
