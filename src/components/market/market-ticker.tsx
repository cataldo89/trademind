'use client'

import { useQuery } from '@tanstack/react-query'
import { cn, formatPercent } from '@/lib/utils'
import { ArrowUp, ArrowDown } from 'lucide-react'

// Default symbols to show in the ticker
const TICKER_SYMBOLS = [
  'SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GOOGL',
  'BTC-USD', 'ETH-USD',
]

interface TickerQuote {
  symbol: string
  price: number
  change: number
  changePercent: number
}

async function fetchTickerQuotes(): Promise<TickerQuote[]> {
  try {
    const symbolString = TICKER_SYMBOLS.join(',')
    const res = await fetch(`/api/market/quote?symbol=${symbolString}&market=US`, {
      next: { revalidate: 60 },
    })
    
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data.data) ? data.data : [data.data]
  } catch (error) {
    console.error('[Ticker] Fetch error:', error)
    return []
  }
}

export function MarketTicker() {
  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ['ticker-quotes'],
    queryFn: fetchTickerQuotes,
    refetchInterval: 60 * 1000, // Refresh every 60s
    staleTime: 30 * 1000,
  })

  if (isLoading) {
    return (
      <div className="h-8 bg-gray-900/60 border-b border-gray-800 flex items-center px-4">
        <div className="flex gap-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-3 w-20 bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (quotes.length === 0) return null

  // Duplicate for seamless loop
  const displayQuotes = [...quotes, ...quotes]

  return (
    <div className="h-8 bg-gray-900/60 border-b border-gray-800 overflow-hidden flex items-center">
      <div className="ticker-track flex items-center gap-0 whitespace-nowrap">
        {displayQuotes.map((q, i) => (
          <TickerItem key={`${q.symbol}-${i}`} quote={q} />
        ))}
      </div>
    </div>
  )
}

function TickerItem({ quote }: { quote: TickerQuote }) {
  const isPositive = quote.changePercent >= 0

  return (
    <div className="flex items-center gap-1.5 px-4 border-r border-gray-800/50 text-xs h-8">
      <span className="font-mono font-semibold text-gray-300">{quote.symbol}</span>
      <span className="font-mono text-white">{quote.price?.toFixed(2)}</span>
      <span
        className={cn(
          'flex items-center gap-0.5 font-mono',
          isPositive ? 'text-emerald-400' : 'text-red-400'
        )}
      >
        {isPositive ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
        {formatPercent(quote.changePercent)}
      </span>
    </div>
  )
}

# bumped: 2026-05-05T04:21:00