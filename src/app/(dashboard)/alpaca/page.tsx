import type { Metadata } from 'next'
import { AlpacaOverviewClient } from '@/components/alpaca/alpaca-overview-client'

export const metadata: Metadata = { title: 'Alpaca Paper' }

export default function AlpacaPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Alpaca Paper</h1>
        <p className="mt-0.5 text-sm text-gray-400">
          Cuenta, posiciones y ordenes conectadas desde Alpaca Connect.
        </p>
      </div>

      <AlpacaOverviewClient />
    </div>
  )
}
