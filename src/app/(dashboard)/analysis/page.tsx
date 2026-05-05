import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ZestyWorkspace } from '@/components/analysis/zesty-workspace'
import { Loader2 } from 'lucide-react'

export const metadata: Metadata = { title: 'Análisis técnico Zesty' }

export default function AnalysisPage() {
  return (
    <div className="h-full">
      <Suspense fallback={
        <div className="flex flex-col items-center justify-center h-full bg-gray-950">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
        </div>
      }>
        <ZestyWorkspace />
      </Suspense>
    </div>
  )
}

# bumped: 2026-05-05T04:21:00