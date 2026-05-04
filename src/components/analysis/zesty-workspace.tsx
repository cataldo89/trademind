'use client'

import { useCallback, useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { getCategorizedZestySymbols } from '@/lib/market-data'
import { CHART_RANGES, type ChartRange } from '@/lib/chart-ranges'
import { Market } from '@/types'
import { CandlestickChart } from '@/components/analysis/candlestick-chart'
import { TechnicalSummary } from '@/components/analysis/technical-summary'
import { QuoteHeader } from '@/components/analysis/quote-header'
import { cn } from '@/lib/utils'
import { Search, Activity, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { isMarketOpen } from '@/lib/market-schedule'

type ZestySymbol = { symbol: string; name: string }

const SYMBOL_ALIASES: Record<string, string[]> = {
  ALL: ['allstate', 'allstate corporation', 'the allstate corporation', 'insurance'],
  NVDA: ['nvidia', 'envidia', 'nvdia', 'nvidia corp', 'nvidia corporation', 'gpu', 'ia chips'],
  AMD: ['advanced micro devices', 'amd', 'ryzen'],
  TSLA: ['tesla', 'tesla motors', 'elon'],
  AAPL: ['apple', 'iphone'],
  MSFT: ['microsoft', 'azure'],
  GOOGL: ['google', 'alphabet'],
  META: ['facebook', 'instagram'],
  AMZN: ['amazon', 'aws'],
  QQQ: ['nasdaq', 'nasdaq 100'],
  SPY: ['s&p500', 's&p 500', 'sp500'],
}

const QUICK_SYMBOLS = [
  { symbol: 'NVDA', label: 'Nvidia' },
  { symbol: 'AAPL', label: 'Apple' },
  { symbol: 'MSFT', label: 'Microsoft' },
  { symbol: 'TSLA', label: 'Tesla' },
  { symbol: 'SPY', label: 'S&P 500' },
  { symbol: 'QQQ', label: 'Nasdaq' },
]

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

function getSearchTokens(value: string) {
  return normalizeSearchText(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function startsWithSearchTerm(value: string, query: string) {
  return getSearchTokens(value).some((token) => token.startsWith(query))
}

function getSearchScore(item: ZestySymbol, query: string) {
  const normalizedSymbol = normalizeSearchText(item.symbol)
  const normalizedName = normalizeSearchText(item.name)
  const normalizedAliases = (SYMBOL_ALIASES[item.symbol] || []).map(normalizeSearchText)

  if (normalizedSymbol === query) return 0
  if (normalizedAliases.some((alias) => alias === query)) return 1
  if (normalizedSymbol.startsWith(query)) return 2
  if (startsWithSearchTerm(normalizedName, query)) return 3
  if (normalizedAliases.some((alias) => startsWithSearchTerm(alias, query))) return 4
  if (query.length >= 3 && normalizedSymbol.includes(query)) return 5
  if (query.length >= 3 && normalizedName.includes(query)) return 6
  if (query.length >= 3 && normalizedAliases.some((alias) => alias.includes(query))) return 7

  return null
}

export function ZestyWorkspace() {
  const searchParams = useSearchParams()
  const categories = useMemo(() => getCategorizedZestySymbols(), [])
  const initialSymbol = searchParams.get('symbol')?.trim().toUpperCase() || categories[0]?.symbols[0]?.symbol || 'SPY'
  const initialMarket = (searchParams.get('market') || 'US') as Market
  
  const [activeCategoryId, setActiveCategoryId] = useState<string>(categories[0]?.id || '')
  const [searchQuery, setSearchQuery] = useState('')
  const [symbol, setSymbol] = useState(initialSymbol)
  const [market, setMarket] = useState<Market>(initialMarket)
  const [chartRange, setChartRange] = useState<ChartRange>('1D')
  const [effectiveRange, setEffectiveRange] = useState<ChartRange>('1D')
  const [marketOpen, setMarketOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(true)
  const [symbolsOpen, setSymbolsOpen] = useState(!searchParams.get('symbol'))
  const [summaryOpen, setSummaryOpen] = useState(true)

  // Check market status
  useEffect(() => {
    const check = () => setMarketOpen(isMarketOpen(market))
    check()
    const interval = setInterval(check, 60000)
    return () => clearInterval(interval)
  }, [market])

  useEffect(() => {
    const nextSymbol = searchParams.get('symbol')?.trim().toUpperCase()
    const nextMarket = (searchParams.get('market') || 'US') as Market

    if (nextSymbol) {
      setSymbol(nextSymbol)
      setMarket(nextMarket)
      setSearchQuery('')
      setSymbolsOpen(false)
    }
  }, [searchParams])

  const normalizedSearchQuery = normalizeSearchText(searchQuery)
  const isSearching = normalizedSearchQuery.length > 0

  const handleSymbolSelect = useCallback((nextSymbol: string) => {
    setSymbol(nextSymbol)
    setMarket('US')
    setSymbolsOpen(false)
  }, [])

  const handleRangeSelect = useCallback((nextRange: ChartRange) => {
    setChartRange(nextRange)
    setEffectiveRange(nextRange)
  }, [])

  const handleChartMetadataChange = useCallback((metadata: { range: ChartRange } | undefined) => {
    setEffectiveRange(metadata?.range ?? chartRange)
  }, [chartRange])

  const activeCategory = categories.find(c => c.id === activeCategoryId)

  const allSymbols = useMemo(() => {
    const uniqueSymbols = new Map<string, ZestySymbol>()

    categories.forEach((category) => {
      category.symbols.forEach((item) => {
        if (!uniqueSymbols.has(item.symbol)) {
          uniqueSymbols.set(item.symbol, item)
        }
      })
    })

    return Array.from(uniqueSymbols.values())
  }, [categories])

  const filteredSymbols = useMemo(() => {
    if (!activeCategory) return []
    if (!normalizedSearchQuery) return activeCategory.symbols

    return allSymbols
      .map((item, index) => ({ item, index, score: getSearchScore(item, normalizedSearchQuery) }))
      .filter((result): result is { item: ZestySymbol; index: number; score: number } => result.score !== null)
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map((result) => result.item)
  }, [activeCategory, allSymbols, normalizedSearchQuery])

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Top navbar for Workspace */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-800 bg-gray-900/60">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold">
          <Activity className="w-5 h-5" />
          <span>Zesty Workspace</span>
        </div>
        
        <div className="w-px h-6 bg-gray-700 mx-2" />

        {/* Range selector */}
        <div className="flex items-center gap-0.5 bg-gray-800/50 rounded-lg p-0.5">
          {CHART_RANGES.map((item) => (
            <button
              key={item.range}
              onClick={() => handleRangeSelect(item.range)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                chartRange === item.range
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1 rounded-lg bg-gray-800/40 p-0.5">
          <button
            type="button"
            onClick={() => setCategoriesOpen((open) => !open)}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
              categoriesOpen ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            )}
            title="Mostrar u ocultar categorías"
          >
            {categoriesOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
            Categorías
          </button>
          <button
            type="button"
            onClick={() => setSymbolsOpen((open) => !open)}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
              symbolsOpen ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            )}
            title="Mostrar u ocultar buscador"
          >
            {symbolsOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
            Buscador
          </button>
          <button
            type="button"
            onClick={() => setSummaryOpen((open) => !open)}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
              summaryOpen ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            )}
            title="Mostrar u ocultar indicadores"
          >
            {summaryOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            Indicadores
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar: Categories */}
        <div className={cn(
          'flex flex-col border-r border-gray-800 bg-gray-900/30 flex-shrink-0 transition-[width] duration-300',
          categoriesOpen ? 'w-[clamp(9.5rem,13vw,13rem)] overflow-y-auto' : 'w-10 overflow-hidden'
        )}>
          {!categoriesOpen && (
            <button
              type="button"
              onClick={() => setCategoriesOpen(true)}
              className="flex h-full w-full items-start justify-center px-2 py-4 text-gray-500 hover:bg-gray-800/40 hover:text-emerald-400"
              title="Abrir categorías"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}
          {categoriesOpen && (
          <div className="p-4">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Categorías Zesty</h2>
            <div className="space-y-1">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setActiveCategoryId(cat.id)
                    setSearchQuery('')
                    // Opcionalmente seleccionar el primer símbolo de la nueva categoría
                    // if (cat.symbols.length > 0) setSymbol(cat.symbols[0].symbol)
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex justify-between items-center',
                    activeCategoryId === cat.id 
                      ? 'bg-emerald-500/10 text-emerald-400' 
                      : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                  )}
                >
                  <span className="truncate pr-2">{cat.name}</span>
                  <span className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded text-gray-500">
                    {cat.symbols.length}
                  </span>
                </button>
              ))}
            </div>
          </div>
          )}
        </div>

        {/* Middle Sidebar: Symbols List */}
        <div className={cn(
          'flex flex-col border-r border-gray-800 bg-gray-900/30 flex-shrink-0 transition-[width] duration-300',
          symbolsOpen ? 'w-[clamp(15rem,22vw,20rem)]' : 'w-10 overflow-hidden'
        )}>
          {!symbolsOpen && (
            <button
              type="button"
              onClick={() => setSymbolsOpen(true)}
              className="flex h-full w-full items-start justify-center px-2 py-4 text-gray-500 hover:bg-gray-800/40 hover:text-emerald-400"
              title="Abrir buscador"
            >
              <Search className="h-4 w-4" />
            </button>
          )}
          {symbolsOpen && (
          <>
           <div className="p-3 border-b border-gray-800">
             <div className="relative">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
               <input 
                 type="text" 
                 placeholder="Buscar acción o ETF: NVDA, Nvidia, envidia..."
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 className="w-full bg-gray-800/50 border border-gray-700 rounded-lg py-1.5 pl-9 pr-3 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 transition-colors"
               />
             </div>
           </div>
           <div className="flex-1 overflow-y-auto p-2 space-y-1">
             {isSearching ? (
               <div className="px-2 pb-1 text-xs font-medium text-gray-400">
                 Resultados globales <span className="text-emerald-400">{filteredSymbols.length}</span>
               </div>
              ) : (
                <div className="px-2 pb-2">
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">Accesos rápidos</div>
                 <div className="flex flex-wrap gap-1.5">
                   {QUICK_SYMBOLS.map((item) => (
                     <button
                       key={item.symbol}
                       onClick={() => handleSymbolSelect(item.symbol)}
                       className={cn(
                         'rounded-full border px-2 py-0.5 text-left transition-colors whitespace-nowrap',
                         symbol === item.symbol
                           ? 'border-emerald-400 bg-emerald-500 text-white'
                           : 'border-gray-700 bg-gray-800/50 text-gray-300 hover:border-emerald-500/60 hover:text-white'
                       )}
                     >
                       <span className="text-xs font-bold">{item.symbol}</span>
                       <span className={cn('ml-1 text-[9px]', symbol === item.symbol ? 'text-emerald-100' : 'text-gray-500')}>
                         {item.label}
                       </span>
                     </button>
                   ))}
                 </div>
               </div>
             )}
            {filteredSymbols.length === 0 ? (
              <div className="mx-2 mt-8 rounded-xl border border-gray-800 bg-gray-900/60 p-4 text-center">
                <div className="text-sm font-medium text-gray-300">No se encontraron símbolos</div>
                <div className="mt-1 text-xs text-gray-500">Prueba “NVDA” o “Nvidia”.</div>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredSymbols.map((item) => (
                  <button
                    key={item.symbol}
                    onClick={() => handleSymbolSelect(item.symbol)}
                    className={cn(
                      'w-full text-left p-3 rounded-lg transition-colors group',
                      symbol === item.symbol 
                        ? 'bg-emerald-500 text-white' 
                        : 'hover:bg-gray-800/50'
                    )}
                  >
                    <div className={cn('font-bold text-sm', symbol === item.symbol ? 'text-white' : 'text-gray-200')}>
                      {item.symbol}
                    </div>
                    <div className={cn('text-xs truncate mt-0.5', symbol === item.symbol ? 'text-emerald-100' : 'text-gray-500 group-hover:text-gray-400')}>
                      {item.name}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          </>
          )}
        </div>

        {/* Main Content: Chart & Summary */}
        <div className="flex-1 flex flex-col min-w-0 bg-gray-950">
          <QuoteHeader symbol={symbol} market={market} />
          
          <div className="flex flex-1 overflow-hidden">
            {/* Chart */}
            <div className="flex-1 min-w-0 p-4">
              <div className="relative h-[58vh] min-h-[340px] max-h-[520px] w-full">
                <div className="absolute bottom-3 right-3 z-20 flex items-center gap-2 bg-gray-900/80 backdrop-blur border border-gray-800 px-3 py-1.5 rounded-full">
                  <span className={`w-2 h-2 rounded-full ${marketOpen ? 'bg-emerald-500 animate-pulse' : 'bg-gray-500'}`} />
                  <span className={`text-xs font-medium ${marketOpen ? 'text-emerald-400' : 'text-gray-400'}`}>{marketOpen ? 'EN VIVO' : 'CERRADO'}</span>
                  <span className="text-xs text-gray-500 mx-1">•</span>
                  <span className="text-xs text-gray-400">{CHART_RANGES.find((item) => item.range === effectiveRange)?.label ?? effectiveRange}</span>
                </div>
                <CandlestickChart
                  symbol={symbol}
                  market={market}
                  range={chartRange}
                  onMetadataChange={handleChartMetadataChange}
                />
              </div>
            </div>

            {/* Right panel: Technical Summary */}
            <div className={cn(
              'border-l border-gray-800 bg-gray-900/20 flex-shrink-0 transition-[width] duration-300',
              summaryOpen ? 'w-[clamp(15rem,18vw,18rem)] overflow-y-auto' : 'w-10 overflow-hidden'
            )}>
              {!summaryOpen && (
                <button
                  type="button"
                  onClick={() => setSummaryOpen(true)}
                  className="flex h-full w-full items-start justify-center px-2 py-4 text-gray-500 hover:bg-gray-800/40 hover:text-emerald-400"
                  title="Abrir indicadores"
                >
                  <PanelRightOpen className="h-4 w-4" />
                </button>
              )}
              {summaryOpen && (
              <TechnicalSummary symbol={symbol} market={market} range={chartRange} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
