import type { Metadata } from 'next'
import { AlertsClient } from '@/components/alerts/alerts-client'

export const metadata: Metadata = { title: 'Alertas' }

export default function AlertsPage() {
  return <AlertsClient />
}
