import type { Metadata } from 'next'
import { SignalsClient } from '@/components/signals/signals-client'

export const metadata: Metadata = { title: 'Señales' }

export default function SignalsPage() {
  return <SignalsClient />
}

# bumped: 2026-05-05T04:21:00