'use client'

import { useQuery } from '@tanstack/react-query'
import { getAllMarketStatus } from '@/lib/market-schedule'
import type { Market, MarketStatus } from '@/types'

export function useMarketStatus() {
  const { data } = useQuery({
    queryKey: ['market-status-api'],
    queryFn: async () => {
      const res = await fetch('/api/market/status')
      if (!res.ok) throw new Error('Failed to fetch market status')
      const body = await res.json()
      return body.data as Record<Market, MarketStatus>
    },
    refetchInterval: 30000, // Refresh every 30s
    staleTime: 15000,
  })

  // Fallback to client-side calculations while loading or in case of error
  return data || getAllMarketStatus()
}
