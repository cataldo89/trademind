export type SupportedMarket = 'US' | 'CL'
export type SupportedSignalType = 'BUY' | 'SELL' | 'HOLD'

const SUPPORTED_MARKETS = new Set<SupportedMarket>(['US', 'CL'])
const SUPPORTED_SIGNAL_TYPES = new Set<SupportedSignalType>(['BUY', 'SELL', 'HOLD'])

function marketFromSymbol(symbol?: unknown): SupportedMarket | null {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase()
  if (/\.SN$|\.SA$|\.CL$/i.test(normalizedSymbol)) return 'CL'
  return null
}

export function normalizeMarket(value: unknown, symbol?: unknown): SupportedMarket {
  const parsed = parseMarketOrLegacy(value, symbol)
  return parsed || marketFromSymbol(symbol) || 'US'
}

export function parseMarket(value: unknown): SupportedMarket | null {
  const market = String(value || '').trim().toUpperCase()
  return SUPPORTED_MARKETS.has(market as SupportedMarket) ? market as SupportedMarket : null
}

export function parseMarketOrLegacy(value: unknown, symbol?: unknown): SupportedMarket | null {
  const market = String(value || '').trim().toUpperCase()
  if (!market) return marketFromSymbol(symbol) || 'US'
  if (SUPPORTED_MARKETS.has(market as SupportedMarket)) return market as SupportedMarket
  if (market === 'EQUITY') return 'US'
  return marketFromSymbol(symbol)
}

export function normalizeSymbol(value: unknown): string | null {
  const symbol = String(value || '').trim().toUpperCase()
  if (!symbol || symbol.length > 24) return null
  if (!/^[A-Z0-9._-]+$/.test(symbol)) return null
  return symbol
}

export function normalizeSignalType(value: unknown): SupportedSignalType {
  const type = String(value || '').trim().toUpperCase()
  if (SUPPORTED_SIGNAL_TYPES.has(type as SupportedSignalType)) return type as SupportedSignalType
  if (type === 'COMPRAR' || type === 'BUY_SIGNAL') return 'BUY'
  if (type === 'VENDER' || type === 'SELL_SIGNAL') return 'SELL'
  return 'HOLD'
}

export function parseSignalType(value: unknown): SupportedSignalType | null {
  const type = String(value || '').trim().toUpperCase()
  return SUPPORTED_SIGNAL_TYPES.has(type as SupportedSignalType) ? type as SupportedSignalType : null
}

export function normalizeStrength(value: unknown): number {
  const strength = Number(value)
  if (!Number.isFinite(strength)) return 50
  return Math.max(0, Math.min(100, strength))
}