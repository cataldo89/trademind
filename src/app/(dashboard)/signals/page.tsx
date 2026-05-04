import type { Metadata } from 'next'
import { SignalsClient } from '@/components/signals/signals-client'

export const metadata: Metadata = { title: 'Señales' }

export default function SignalsPage() {
  return <SignalsClient />
}
