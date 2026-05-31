'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CHART_RANGES, type ChartRange } from '@/lib/chart-ranges'
import { Market } from '@/types'
import type { AdvisorScreenerContext } from '@/lib/ai-advisor-context'
import { CandlestickChart } from '@/components/analysis/candlestick-chart'
import { TechnicalSummary } from '@/components/analysis/technical-summary'
import { QuoteHeader } from '@/components/analysis/quote-header'
import { SymbolSearch } from '@/components/analysis/symbol-search'
import { cn } from '@/lib/utils'

function parseFiniteNumber(value: string | null) {
  if (value === null || value.trim() === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function isChartRange(value: string | null): value is ChartRange {
  return CHART_RANGES.some((item) => item.range === value)
}

function buildScreenerContext(
  params: Pick<URLSearchParams, 'get'>,
  symbol: string,
  market: Market
): AdvisorScreenerContext | undefined {
  if (params.get('from') !== 'screener') return undefined

  return {
    source: 'screener',
    symbol: symbol.toUpperCase(),
    market,
    displayAction: params.get('screenerAction') || undefined,
    finalScore: parseFiniteNumber(params.get('screenerScore')),
    decisionScore: parseFiniteNumber(params.get('decisionScore')),
    sentiment: params.get('sentiment') || undefined,
    sentimentScore: parseFiniteNumber(params.get('sentimentScore')),
    regime: params.get('regime') || undefined,
    quantAction: params.get('quantAction') || undefined,
    confidence: parseFiniteNumber(params.get('confidence')),
    macd: params.get('macd') || undefined,
    rsi: parseFiniteNumber(params.get('rsi')),
    changePercent: parseFiniteNumber(params.get('change')),
  }
}

export function AnalysisClient() {
  const searchParams = useSearchParams()
  const initialSymbol = searchParams.get('symbol') || 'AAPL'
  const initialMarket = (searchParams.get('market') || 'US') as Market
  const requestedRange = searchParams.get('range')
  const initialRange = isChartRange(requestedRange) ? requestedRange : '1D'

  const [symbol, setSymbol] = useState(initialSymbol)
  const [market, setMarket] = useState<Market>(initialMarket)
  const [chartRange, setChartRange] = useState<ChartRange>(initialRange)

  const screenerContext = useMemo(
    () => buildScreenerContext(searchParams, initialSymbol, initialMarket),
    [searchParams, initialSymbol, initialMarket]
  )
  const activeScreenerContext = screenerContext?.symbol === symbol.toUpperCase() && screenerContext.market === market
    ? screenerContext
    : undefined

  const handleSymbolSelect = (sym: string, mkt: Market) => {
    setSymbol(sym)
    setMarket(mkt)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top toolbar */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-800 bg-gray-900/40">
        {/* Symbol search */}
        <SymbolSearch
          symbol={symbol}
          market={market}
          onSelect={handleSymbolSelect}
        />

        {/* Market toggle */}
        <div className="flex items-center gap-1 bg-gray-800/50 rounded-lg p-0.5">
          {(['US', 'CL'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setMarket(item)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                market === item ? 'bg-emerald-500 text-white' : 'text-gray-400 hover:text-white'
              )}
            >
              {item}
            </button>
          ))}
        </div>

        {/* Range selector */}
        <div className="flex items-center gap-0.5 bg-gray-800/50 rounded-lg p-0.5 ml-2">
          {CHART_RANGES.map((item) => (
            <button
              key={item.range}
              onClick={() => setChartRange(item.range)}
              className={cn(
                'px-2 py-1 text-xs font-medium rounded-md transition-all',
                chartRange === item.range
                  ? 'bg-emerald-500 text-white'
                  : 'text-gray-400 hover:text-white'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quote header */}
      <QuoteHeader symbol={symbol} market={market} />

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chart */}
        <div className="flex-1 min-w-0">
          <CandlestickChart symbol={symbol} market={market} range={chartRange} />
        </div>

        {/* Right panel: Technical Summary */}
        <div className="w-72 border-l border-gray-800 overflow-y-auto">
          <TechnicalSummary symbol={symbol} market={market} range={chartRange} screenerContext={activeScreenerContext} />
        </div>
      </div>
    </div>
  )
}

