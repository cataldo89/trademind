import type { Market } from '@/types'

export interface AdvisorScreenerContext {
  source: 'screener'
  symbol: string
  market: Market
  displayAction?: string
  finalScore?: number
  decisionScore?: number
  sentiment?: string
  sentimentScore?: number
  regime?: string
  quantAction?: string
  confidence?: number
  macd?: string
  rsi?: number
  changePercent?: number
}
