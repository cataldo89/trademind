'use client'

import { useEffect, useState } from 'react'
import { Market, MarketStatus } from '@/types'
import { getUSMarketStatus } from '@/lib/market-schedule'
import { cn } from '@/lib/utils'

interface MarketStatusBadgeProps {
  market: Market
}

export function MarketStatusBadge({ market }: MarketStatusBadgeProps) {
  const [status, setStatus] = useState<MarketStatus | null>(null)
  const [currentTime, setCurrentTime] = useState('')

  useEffect(() => {
    const update = () => {
      const s = getUSMarketStatus()
      setStatus(s)

      // Get current time in market timezone
      const tz = s.timezone
      const time = new Date().toLocaleTimeString('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      setCurrentTime(time)
    }

    update()
    const interval = setInterval(update, 30000) // Update every 30s
    return () => clearInterval(interval)
  }, [market])

  if (!status) return null

  const sessionLabel: Record<string, string> = {
    pre: 'Pre-Mkt',
    regular: 'Abierto',
    after: 'Post-Mkt',
    closed: 'Cerrado',
  }

  return (
    <div className="flex items-center gap-1.5 text-xs">
      {/* Status dot */}
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full flex-shrink-0',
          status.isOpen
            ? 'bg-emerald-400 animate-pulse'
            : status.session === 'pre' || status.session === 'after'
            ? 'bg-yellow-400'
            : 'bg-gray-500'
        )}
      />
      <span className="text-gray-400 font-medium">{market}</span>
      <span
        className={cn(
          'font-medium',
          status.isOpen
            ? 'text-emerald-400'
            : status.session === 'pre' || status.session === 'after'
            ? 'text-yellow-400'
            : 'text-gray-500'
        )}
      >
        {sessionLabel[status.session]}
      </span>
      {currentTime && (
        <span className="text-gray-600 font-mono">{currentTime}</span>
      )}
    </div>
  )
}

# bumped: 2026-05-05T04:21:00