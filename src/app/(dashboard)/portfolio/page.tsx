import type { Metadata } from 'next'
import { PortfolioClient } from '@/components/portfolio/portfolio-client'

export const metadata: Metadata = { title: 'Portafolio' }

export default function PortfolioPage() {
  return <PortfolioClient />
}

# bumped: 2026-05-05T04:21:00