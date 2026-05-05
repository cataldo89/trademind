// ============================================================
// TradeMind — Tipos globales del sistema
// ============================================================

// ---- AUTH --------------------------------------------------
export interface UserProfile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  plan: 'free' | 'pro' | 'enterprise'
  created_at: string
  updated_at: string
}

// ---- MARKET ------------------------------------------------
export type Market = 'US'
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w'
export type SignalType = 'BUY' | 'SELL' | 'HOLD'

export interface MarketStatus {
  market: Market
  isOpen: boolean
  session: 'pre' | 'regular' | 'after' | 'closed'
  openTime: string
  closeTime: string
  timezone: string
  nextOpen?: string
}

export interface Quote {
  symbol: string
  name: string
  price: number
  previousClose: number
  change: number
  changePercent: number
  volume: number
  avgVolume: number
  high: number
  low: number
  open: number
  marketCap?: number
  pe?: number
  exchange: string
  market: Market
  currency: string
  timestamp: number
}

export interface Candle {
  time: number  // Unix timestamp
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface OHLCV {
  symbol: string
  timeframe: Timeframe
  candles: Candle[]
}

// ---- INDICATORS --------------------------------------------
export interface RSIResult {
  time: number
  value: number
}

export interface MACDResult {
  time: number
  macd: number
  signal: number
  histogram: number
}

export interface BollingerBandsResult {
  time: number
  upper: number
  middle: number
  lower: number
}

export interface MovingAverageResult {
  time: number
  value: number
}

export interface TechnicalIndicators {
  rsi: RSIResult[]
  macd: MACDResult[]
  bollingerBands: BollingerBandsResult[]
  ma20: MovingAverageResult[]
  ma50: MovingAverageResult[]
  ma200: MovingAverageResult[]
}

// ---- SIGNALS -----------------------------------------------
export interface TradingSignal {
  id: string
  symbol: string
  type: SignalType
  strength: number  // 0-100
  reason: string
  indicators: string[]
  price: number
  targetPrice?: number
  stopLoss?: number
  riskReward?: number
  timeframe: Timeframe
  market: Market
  createdAt: string
  expiresAt?: string
}

// ---- PORTFOLIO ---------------------------------------------
export interface Position {
  id: string
  userId: string
  symbol: string
  name: string
  market: Market
  quantity: number
  entryPrice: number
  currentPrice: number
  entryDate: string
  pnl: number
  pnlPercent: number
  value: number
  cost: number
  currency: string
}

export interface Transaction {
  id: string
  userId: string
  symbol: string
  name: string
  market: Market
  type: 'BUY' | 'SELL'
  quantity: number
  price: number
  total: number
  commission: number
  currency: string
  executedAt: string
  notes?: string
}

export interface PortfolioSummary {
  totalValue: number
  totalCost: number
  totalPnL: number
  totalPnLPercent: number
  dayPnL: number
  dayPnLPercent: number
  positions: Position[]
  currency: string
}

// ---- WATCHLIST ---------------------------------------------
export interface WatchlistItem {
  id: string
  userId: string
  symbol: string
  name: string
  market: Market
  notes?: string
  addedAt: string
  quote?: Quote
}

export interface Watchlist {
  id: string
  userId: string
  name: string
  items: WatchlistItem[]
  createdAt: string
}

// ---- ALERTS ------------------------------------------------
export type AlertCondition =
  | 'price_above'
  | 'price_below'
  | 'change_percent_above'
  | 'change_percent_below'
  | 'volume_above'
  | 'rsi_above'
  | 'rsi_below'
  | 'ma_crossover_bull'
  | 'ma_crossover_bear'

export type AlertStatus = 'active' | 'triggered' | 'expired' | 'paused'

export interface Alert {
  id: string
  userId: string
  symbol: string
  name: string
  market: Market
  condition: AlertCondition
  value: number
  currentValue?: number
  status: AlertStatus
  notifyEmail: boolean
  notifyApp: boolean
  message?: string
  createdAt: string
  triggeredAt?: string
  expiresAt?: string
}

// ---- MARKET MOVER ------------------------------------------
export interface MarketMover {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
  volume: number
  market: Market
}

export interface MarketMovers {
  gainers: MarketMover[]
  losers: MarketMover[]
  mostActive: MarketMover[]
}

// ---- API RESPONSES -----------------------------------------
export interface ApiResponse<T> {
  data: T | null
  error: string | null
  loading?: boolean
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

// ---- GARCH / RISK ------------------------------------------
export interface VolatilityMetrics {
  symbol: string
  historicalVolatility: number  // Annualized
  garchForecast: number         // Next-day volatility forecast
  var99: number                  // Value at Risk at 1%
  var95: number                  // Value at Risk at 5%
  sharpeRatio?: number
  beta?: number
}

// ---- ADMIN -------------------------------------------------
export interface AdminStats {
  totalUsers: number
  activeUsers: number
  totalAlerts: number
  triggeredAlerts: number
  totalPositions: number
  apiCallsToday: number
}

# bumped: 2026-05-05T04:21:00