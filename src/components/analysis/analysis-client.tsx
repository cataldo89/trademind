'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CHART_RANGES, type ChartRange } from '@/lib/chart-ranges'
import { Market } from '@/types'
import { CandlestickChart } from '@/components/analysis/candlestick-chart'
import { TechnicalSummary } from '@/components/analysis/technical-summary'
import { QuoteHeader } from '@/components/analysis/quote-header'
import { SymbolSearch } from '@/components/analysis/symbol-search'
import { cn } from '@/lib/utils'

export function AnalysisClient() {
  const searchParams = useSearchParams()
  const initialSymbol = searchParams.get('symbol') || 'AAPL'
  const initialMarket = (searchParams.get('market') || 'US') as Market

  const [symbol, setSymbol] = useState(initialSymbol)
  const [market, setMarket] = useState<Market>(initialMarket)
  const [chartRange, setChartRange] = useState<ChartRange>('1D')

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
          <button
            key="US"
            onClick={() => setMarket('US')}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
              market === 'US' ? 'bg-emerald-500 text-white' : 'text-gray-400 hover:text-white'
            )}
          >
            US
          </button>
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
          <TechnicalSummary symbol={symbol} market={market} range={chartRange} />
        </div>
      </div>
    </div>
  )
}

# bumped: 2026-05-05T04:21:00