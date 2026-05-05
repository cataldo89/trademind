'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCategorizedZestySymbols } from '@/lib/market-data'
import { Market, Candle } from '@/types'
import { cn } from '@/lib/utils'
import {
  ArrowUp, ArrowDown, ArrowRightLeft, TrendingUp, TrendingDown,
  AlertCircle, Loader2, Search, ChevronRight, Activity, Eye
} from 'lucide-react'
import Link from 'next/link'
import { calculateRSI, calculateMACD, calculateSMA, interpretRSI } from '@/lib/indicators'

const MAX_SCAN_SYMBOLS = 80

interface ScanResult {
  symbol: string
  name: string
  market: Market
  price: number
  changePercent: number
  volume: number
  rsi: number
  rsiSignal: string
  rsiColor: string
  macdSignal: string
  macdColor: string
  ma20: number
  ma50: number
  priceVsMA20: 'above' | 'below'
  priceVsMA50: 'above' | 'below'
  suggestions: Suggestion[]
}

interface Suggestion {
  type: 'opportunity' | 'warning' | 'neutral'
  label: string
  description: string
  icon: 'trending-up' | 'trending-down' | 'activity' | 'alert'
}

async function fetchCandles(symbol: string, market: Market): Promise<Candle[]> {
  const res = await fetch(`/api/market/candles?symbol=${encodeURIComponent(symbol)}&range=1Y&market=${market}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.data || []
}

async function fetchQuote(symbol: string, market: Market): Promise<{ symbol: string; price: number; changePercent: number; volume: number; name: string } | null> {
  const res = await fetch(`/api/market/quote?symbol=${encodeURIComponent(symbol)}&market=${market}`)
  if (!res.ok) return null
  const data = await res.json()
  const q = data.data || data
  if (!q?.symbol) return null
  return {
    symbol,
    price: q.price || q.regularMarketPrice || 0,
    changePercent: q.changePercent || q.regularMarketChangePercent || 0,
    volume: q.volume || q.regularMarketVolume || 0,
    name: q.name || q.shortName || q.longName || symbol,
  }
}

function analyzeSymbol(symbol: string, name: string, market: Market, candles: Candle[], quote: { price: number; changePercent: number; volume: number }): ScanResult {
  const rsi = calculateRSI(candles, 14)
  const macd = calculateMACD(candles)
  const ma20 = calculateSMA(candles, 20)
  const ma50 = calculateSMA(candles, 50)

  const lastRSI = rsi[rsi.length - 1]?.value ?? 50
  const rsiInterp = interpretRSI(lastRSI)

  const lastMACD = macd[macd.length - 1]
  const prevMACD = macd[macd.length - 2]
  let macdSignal = 'Neutral'
  let macdColor = 'text-gray-400'
  if (lastMACD && prevMACD) {
    if (lastMACD.histogram > 0 && prevMACD.histogram <= 0) {
      macdSignal = 'Cruce alcista'
      macdColor = 'text-emerald-400'
    } else if (lastMACD.histogram < 0 && prevMACD.histogram >= 0) {
      macdSignal = 'Cruce bajista'
      macdColor = 'text-red-400'
    } else if (lastMACD.histogram > 0) {
      macdSignal = 'Positivo'
      macdColor = 'text-emerald-300'
    } else {
      macdSignal = 'Negativo'
      macdColor = 'text-red-300'
    }
  }

  const lastMA20 = ma20[ma20.length - 1]?.value ?? 0
  const lastMA50 = ma50[ma50.length - 1]?.value ?? 0
  const price = quote.price

  const priceVsMA20 = price > lastMA20 ? 'above' : 'below'
  const priceVsMA50 = price > lastMA50 ? 'above' : 'below'

  // Generate suggestions
  const suggestions: Suggestion[] = []

  if (lastRSI < 30) {
    suggestions.push({
      type: 'opportunity',
      label: 'Sobreventa técnica',
      description: `RSI ${lastRSI.toFixed(1)} — Posible rebote cercano`,
      icon: 'trending-up',
    })
  } else if (lastRSI > 70) {
    suggestions.push({
      type: 'warning',
      label: 'Sobrecompra técnica',
      description: `RSI ${lastRSI.toFixed(1)} — Posible corrección`,
      icon: 'trending-down',
    })
  }

  if (macdSignal === 'Cruce alcista') {
    suggestions.push({
      type: 'opportunity',
      label: 'Cruce MACD alcista',
      description: 'Posible inicio de tendencia alcista',
      icon: 'trending-up',
    })
  } else if (macdSignal === 'Cruce bajista') {
    suggestions.push({
      type: 'warning',
      label: 'Cruce MACD bajista',
      description: 'Posible inicio de tendencia bajista',
      icon: 'trending-down',
    })
  }

  if (priceVsMA50 === 'above' && priceVsMA20 === 'below') {
    suggestions.push({
      type: 'opportunity',
      label: 'Cruce MA20→MA50',
      description: 'Precio rompió sobre MA50 — posible breakout',
      icon: 'activity',
    })
  } else if (priceVsMA50 === 'below' && priceVsMA20 === 'above') {
    suggestions.push({
      type: 'warning',
      label: 'Ruptura MA50',
      description: 'Precio cayó sobre MA50 — posible breakdown',
      icon: 'alert',
    })
  }

  if (quote.changePercent < -5) {
    suggestions.push({
      type: 'warning',
      label: 'Caída fuerte',
      description: `${quote.changePercent.toFixed(1)}% hoy — monitorear`,
      icon: 'alert',
    })
  } else if (quote.changePercent > 5) {
    suggestions.push({
      type: 'neutral',
      label: 'Subida fuerte',
      description: `${quote.changePercent.toFixed(1)}% hoy — confirmar continuidad`,
      icon: 'activity',
    })
  }

  return {
    symbol,
    name,
    market,
    price,
    changePercent: quote.changePercent,
    volume: quote.volume,
    rsi: lastRSI,
    rsiSignal: rsiInterp.signal,
    rsiColor: rsiInterp.color,
    macdSignal,
    macdColor,
    ma20: lastMA20,
    ma50: lastMA50,
    priceVsMA20,
    priceVsMA50,
    suggestions,
  }
}

export function ScreenerClient() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'opportunities' | 'warnings'>('all')
  const [category, setCategory] = useState('zesty-all')
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)

  const categories = useMemo(() => getCategorizedZestySymbols(), [])
  const selectedCategory = categories.find((cat) => cat.id === category) ?? categories[0]
  const scanSymbols = useMemo(() => {
    return (selectedCategory?.symbols ?? [])
      .slice(0, MAX_SCAN_SYMBOLS)
      .map((s) => ({ ...s, market: 'US' as Market }))
  }, [selectedCategory])

  const categoryTotal = selectedCategory?.symbols.length ?? 0

  const { data: quotes = [], isLoading: quotesLoading } = useQuery({
    queryKey: ['screener-quotes', category, scanSymbols.map(s => s.symbol)],
    queryFn: async () => {
      const results = await Promise.allSettled(
        scanSymbols.map(s => fetchQuote(s.symbol, s.market))
      )
      return results
        .filter((r): r is PromiseFulfilledResult<{ symbol: string; price: number; changePercent: number; volume: number; name: string } | null> => r.status === 'fulfilled')
        .map(r => r.value)
        .filter(Boolean)
    },
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })

  const { data: scanResults = [], isLoading: scanLoading } = useQuery({
    queryKey: ['screener-scan', category, scanSymbols.map(s => s.symbol)],
    queryFn: async () => {
      const quoteMap = new Map()
      quotes.forEach(q => {
        if (q) quoteMap.set(q.symbol, q)
      })

      const candlePromises = scanSymbols.map(async (s) => {
        const candles = await fetchCandles(s.symbol, s.market)
        const quote = quoteMap.get(s.symbol) || { price: 0, changePercent: 0, volume: 0, name: s.name }
        return analyzeSymbol(s.symbol, s.name, s.market, candles, quote)
      })
      return Promise.all(candlePromises)
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  })

  const allSuggestions = scanResults
    .flatMap(r => r.suggestions.map(s => ({ ...s, symbol: r.symbol, name: r.name, result: r })))
    .filter(s => s.type !== 'neutral')

  const opportunities = allSuggestions.filter(s => s.type === 'opportunity')
  const warnings = allSuggestions.filter(s => s.type === 'warning')

  const filtered = scanResults
    .filter(r => {
      if (filter === 'opportunities') return r.suggestions.some(s => s.type === 'opportunity')
      if (filter === 'warnings') return r.suggestions.some(s => s.type === 'warning')
      return true
    })
    .filter(r => {
      if (!search) return true
      return r.symbol.toLowerCase().includes(search.toLowerCase()) || r.name.toLowerCase().includes(search.toLowerCase())
    })
    .sort((a, b) => {
      if (a.suggestions.length > b.suggestions.length) return -1
      if (b.suggestions.length > a.suggestions.length) return 1
      return Math.abs(b.changePercent) - Math.abs(a.changePercent)
    })

  const selectedResult = scanResults.find(r => r.symbol === selectedSymbol)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">TradeMind Intelligence</h1>
        <p className="text-sm text-gray-400 mt-1">
          Escaneo {scanSymbols.length} de {categoryTotal} activos en {selectedCategory?.name ?? 'Zesty'} · {allSuggestions.length} señales detectadas
        </p>
      </div>

      {/* Suggestions Panel */}
      {allSuggestions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            TradeMind sugiere que mires
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {allSuggestions.slice(0, 9).map((s, i) => (
              <Link
                key={`${s.symbol}-${i}`}
                href={`/analysis?symbol=${s.symbol}&market=${s.result.market}`}
                className={cn(
                  'p-4 rounded-xl border transition-all hover:scale-[1.02]',
                  s.type === 'opportunity'
                    ? 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15'
                    : 'bg-red-500/10 border-red-500/30 hover:bg-red-500/15'
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={cn(
                    'text-xs font-bold',
                    s.type === 'opportunity' ? 'text-emerald-400' : 'text-red-400'
                  )}>
                    {s.label}
                  </span>
                  <span className="text-xs font-mono text-gray-400 bg-gray-800 px-2 py-0.5 rounded">
                    {s.symbol}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mb-2">{s.description}</p>
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <Eye className="w-3 h-3" />
                  <span>Ver análisis</span>
                  <ChevronRight className="w-3 h-3" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {allSuggestions.length === 0 && (
        <div className="p-8 text-center rounded-xl border border-gray-800 bg-gray-900/30">
          <Activity className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-500">Escaneando mercados...</p>
        </div>
      )}

      {/* Category tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {categories.map((cat) => {
          const count = cat.symbols.length
          return (
            <button
              key={cat.id}
              onClick={() => {
                setCategory(cat.id)
                setSelectedSymbol(null)
              }}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-lg transition-all',
                category === cat.id
                  ? 'bg-emerald-500 text-white'
                  : 'text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-800'
              )}
            >
              {cat.name}
              <span className={cn('ml-1 text-xs', category === cat.id ? 'opacity-70' : 'opacity-50')}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar símbolo..."
            className="w-full pl-9 pr-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 outline-none focus:border-emerald-500"
          />
        </div>
        <div className="flex items-center gap-1">
          {([
            { key: 'all', label: 'Todos' },
            { key: 'opportunities', label: 'Oportunidades' },
            { key: 'warnings', label: 'Alertas' },
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-lg transition-all',
                filter === f.key
                  ? f.key === 'opportunities' ? 'bg-emerald-500 text-white'
                    : f.key === 'warnings' ? 'bg-red-500 text-white'
                    : 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-800'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedResult && (
        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center">
                <span className="text-sm font-bold text-gray-400">{selectedResult.symbol.slice(0, 3)}</span>
              </div>
              <div>
                <p className="font-mono font-semibold text-white">{selectedResult.symbol}</p>
                <p className="text-xs text-gray-500">{selectedResult.name}</p>
              </div>
            </div>
            <Link
              href={`/analysis?symbol=${selectedResult.symbol}&market=${selectedResult.market}`}
              className="px-3 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
            >
              Ver gráfico →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gray-800/50 rounded-lg p-2">
              <p className="text-[10px] text-gray-500 uppercase">Precio</p>
              <p className="text-sm font-mono font-semibold text-white">${selectedResult.price.toFixed(2)}</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-2">
              <p className="text-[10px] text-gray-500 uppercase">Cambio</p>
              <p className={cn('text-sm font-mono font-semibold', selectedResult.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {selectedResult.changePercent >= 0 ? '+' : ''}{selectedResult.changePercent.toFixed(2)}%
              </p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-2">
              <p className="text-[10px] text-gray-500 uppercase">RSI (14)</p>
              <p className={cn('text-sm font-mono font-semibold', selectedResult.rsiColor)}>{selectedResult.rsi.toFixed(1)}</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-2">
              <p className="text-[10px] text-gray-500 uppercase">MACD</p>
              <p className={cn('text-sm font-mono font-semibold', selectedResult.macdColor)}>{selectedResult.macdSignal}</p>
            </div>
          </div>
          {selectedResult.suggestions.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-gray-500 uppercase">Señales detectadas</p>
              {selectedResult.suggestions.map((s, i) => (
                <div key={i} className={cn(
                  'flex items-center gap-2 text-xs px-2 py-1 rounded',
                  s.type === 'opportunity' ? 'bg-emerald-500/10 text-emerald-300'
                    : s.type === 'warning' ? 'bg-red-500/10 text-red-300'
                    : 'bg-gray-800/50 text-gray-300'
                )}>
                  <ChevronRight className="w-3 h-3 flex-shrink-0" />
                  <span className="font-medium">{s.label}:</span>
                  <span className="text-gray-400">{s.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="glass rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Activo</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Precio</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cambio %</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">RSI</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">MACD</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">vs MA20</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">vs MA50</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Señales</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {(scanLoading || quotesLoading) && (
                <tr>
                  <td colSpan={9} className="py-12 text-center">
                    <Loader2 className="w-5 h-5 text-emerald-400 animate-spin mx-auto" />
                  </td>
                </tr>
              )}
              {!scanLoading && !quotesLoading && filtered.map((r) => (
                <tr
                  key={r.symbol}
                  onClick={() => setSelectedSymbol(selectedSymbol === r.symbol ? null : r.symbol)}
                  className={cn(
                    'hover:bg-gray-800/20 transition-colors cursor-pointer',
                    selectedSymbol === r.symbol ? 'bg-emerald-500/5' : ''
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-gray-400">{r.symbol.slice(0, 2)}</span>
                      </div>
                      <div>
                        <p className="font-mono font-semibold text-white">{r.symbol}</p>
                        <p className="text-xs text-gray-500 max-w-36 truncate">{r.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-white font-semibold">
                    ${r.price.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('flex items-center justify-end gap-0.5 font-mono font-semibold text-sm', r.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {r.changePercent >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                      {r.changePercent >= 0 ? '+' : ''}{r.changePercent.toFixed(2)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('font-mono font-semibold text-sm', r.rsiColor)}>
                      {r.rsi.toFixed(1)}
                    </span>
                    <span className={cn('text-[10px] ml-1', r.rsiColor)}>{r.rsiSignal}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('text-xs', r.macdColor)}>{r.macdSignal}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('text-xs', r.priceVsMA20 === 'above' ? 'text-emerald-400' : 'text-red-400')}>
                      {r.priceVsMA20 === 'above' ? '↑' : '↓'} {r.ma20.toFixed(0)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('text-xs', r.priceVsMA50 === 'above' ? 'text-emerald-400' : 'text-red-400')}>
                      {r.priceVsMA50 === 'above' ? '↑' : '↓'} {r.ma50.toFixed(0)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.suggestions.length > 0 ? (
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full',
                        r.suggestions.some(s => s.type === 'warning')
                          ? 'bg-red-500/10 text-red-400'
                          : 'bg-emerald-500/10 text-emerald-400'
                      )}>
                        {r.suggestions.length} señal{r.suggestions.length > 1 ? 'es' : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/analysis?symbol=${r.symbol}&market=${r.market}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-gray-500 hover:text-emerald-400 transition-colors"
                    >
                      <ArrowRightLeft className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
              {!scanLoading && !quotesLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center">
                    <AlertCircle className="w-5 h-5 text-gray-600 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No se encontraron resultados</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
