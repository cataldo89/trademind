import type { Metadata } from 'next'
import { Suspense } from 'react'
import { MarketMoversWidget } from '@/components/dashboard/market-movers-widget'
import { WatchlistWidget } from '@/components/dashboard/watchlist-widget'
import { PortfolioSummaryWidget } from '@/components/dashboard/portfolio-summary-widget'
import { ActiveSignalsWidget } from '@/components/dashboard/active-signals-widget'
import { MarketCalendarWidget } from '@/components/dashboard/market-calendar-widget'
import { SkeletonCard } from '@/components/ui/skeleton-card'

export const metadata: Metadata = { title: 'Dashboard' }

export default function DashboardPage() {
  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Resumen de mercados USA
        </p>
      </div>

      {/* Top row: Portfolio + Calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Suspense fallback={<SkeletonCard className="h-40" />}>
            <PortfolioSummaryWidget />
          </Suspense>
        </div>
        <div>
          <Suspense fallback={<SkeletonCard className="h-40" />}>
            <MarketCalendarWidget />
          </Suspense>
        </div>
      </div>

      {/* Middle row: Gainers/Losers + Signals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Suspense fallback={<SkeletonCard className="h-64" />}>
            <MarketMoversWidget />
          </Suspense>
        </div>
        <div>
          <Suspense fallback={<SkeletonCard className="h-64" />}>
            <ActiveSignalsWidget />
          </Suspense>
        </div>
      </div>

      {/* Bottom: Watchlist */}
      <Suspense fallback={<SkeletonCard className="h-72" />}>
        <WatchlistWidget />
      </Suspense>
    </div>
  )
}
