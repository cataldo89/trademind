import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ScreenerClient } from '@/components/screener/screener-client'
import { Loader2 } from 'lucide-react'

export const metadata: Metadata = { title: 'Screener' }

export default function ScreenerPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    }>
      <ScreenerClient />
    </Suspense>
  )
}
