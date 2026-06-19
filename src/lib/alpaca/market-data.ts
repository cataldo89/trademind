import type { Candle, Market, Quote, Timeframe } from '@/types'

const ALPACA_CRYPTO_DATA_BASE_URL = 'https://data.alpaca.markets/v1beta3/crypto/us'

type AlpacaCryptoQuote = {
  ap?: number
  as?: number
  bp?: number
  bs?: number
  t?: string
}

type AlpacaCryptoBar = {
  c?: number
  h?: number
  l?: number
  n?: number
  o?: number
  t?: string
  v?: number
  vw?: number
}

type AlpacaLatestQuotesResponse = {
  quotes?: Record<string, AlpacaCryptoQuote>
}

type AlpacaLatestBarsResponse = {
  bars?: Record<string, AlpacaCryptoBar>
}

type AlpacaBarsResponse = {
  bars?: Record<string, AlpacaCryptoBar[]>
  next_page_token?: string
}

export function isUsdCryptoSymbol(symbol: string) {
  return /-USD$/i.test(symbol)
}

export function toAlpacaCryptoSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/-USD$/i, '/USD')
}

export function fromAlpacaCryptoSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\/USD$/i, '-USD')
}

function getAlpacaHeaders() {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const keyId = process.env.ALPACA_API_KEY_ID || process.env.APCA_API_KEY_ID
  const secretKey = process.env.ALPACA_API_SECRET_KEY || process.env.APCA_API_SECRET_KEY

  if (keyId && secretKey) {
    headers['APCA-API-KEY-ID'] = keyId
    headers['APCA-API-SECRET-KEY'] = secretKey
  }

  return headers
}

async function fetchAlpacaCrypto<T>(path: string, params: Record<string, string>) {
  const url = new URL(`${ALPACA_CRYPTO_DATA_BASE_URL}${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))

  const response = await fetch(url, {
    headers: getAlpacaHeaders(),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Alpaca crypto market data failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}

function midpoint(quote?: AlpacaCryptoQuote) {
  const bid = Number(quote?.bp)
  const ask = Number(quote?.ap)
  if (Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0) {
    return (bid + ask) / 2
  }
  if (Number.isFinite(ask) && ask > 0) return ask
  if (Number.isFinite(bid) && bid > 0) return bid
  return null
}

function normalizeLatestQuote(originalSymbol: string, quote?: AlpacaCryptoQuote, bar?: AlpacaCryptoBar): (Quote & { provider: 'alpaca' }) | null {
  const price = midpoint(quote) ?? Number(bar?.c)
  const previousClose = Number(bar?.o || bar?.c || price)

  if (!Number.isFinite(price) || price <= 0) return null

  const change = Number.isFinite(previousClose) && previousClose > 0 ? price - previousClose : 0
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0

  return {
    symbol: originalSymbol,
    name: `${originalSymbol.replace('-USD', '')} / USD`,
    price,
    previousClose,
    change,
    changePercent,
    volume: Math.max(0, Number(bar?.v) || 0),
    avgVolume: 0,
    high: Number(bar?.h || price),
    low: Number(bar?.l || price),
    open: Number(bar?.o || previousClose || price),
    marketCap: undefined,
    pe: undefined,
    exchange: 'Alpaca Crypto',
    market: 'US' as Market,
    currency: 'USD',
    timestamp: quote?.t ? Date.parse(quote.t) : bar?.t ? Date.parse(bar.t) : Date.now(),
    provider: 'alpaca',
  }
}

export async function fetchAlpacaCryptoQuotes(symbols: string[]) {
  const cryptoSymbols = Array.from(new Set(symbols.filter(isUsdCryptoSymbol).map(toAlpacaCryptoSymbol)))
  if (cryptoSymbols.length === 0) return new Map<string, Quote & { provider: 'alpaca' }>()

  const symbolsParam = cryptoSymbols.join(',')
  const [quotesResponse, barsResponse] = await Promise.all([
    fetchAlpacaCrypto<AlpacaLatestQuotesResponse>('/latest/quotes', { symbols: symbolsParam }),
    fetchAlpacaCrypto<AlpacaLatestBarsResponse>('/latest/bars', { symbols: symbolsParam }),
  ])

  const results = new Map<string, Quote & { provider: 'alpaca' }>()
  for (const alpacaSymbol of cryptoSymbols) {
    const originalSymbol = fromAlpacaCryptoSymbol(alpacaSymbol)
    const normalized = normalizeLatestQuote(
      originalSymbol,
      quotesResponse.quotes?.[alpacaSymbol],
      barsResponse.bars?.[alpacaSymbol]
    )
    if (normalized) {
      results.set(originalSymbol, normalized)
      results.set(originalSymbol.toUpperCase(), normalized)
      results.set(alpacaSymbol, normalized)
      results.set(alpacaSymbol.toUpperCase(), normalized)
    }
  }

  return results
}

function alpacaTimeframe(timeframe: Timeframe) {
  const map: Record<Timeframe, string> = {
    '1m': '1Min',
    '5m': '5Min',
    '15m': '15Min',
    '30m': '30Min',
    '1h': '1Hour',
    '4h': '4Hour',
    '1d': '1Day',
    '1w': '1Week',
  }
  return map[timeframe] || '1Day'
}

function normalizeBar(bar: AlpacaCryptoBar): Candle | null {
  const time = bar.t ? Math.floor(Date.parse(bar.t) / 1000) : 0
  const open = Number(bar.o)
  const high = Number(bar.h)
  const low = Number(bar.l)
  const close = Number(bar.c)

  if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
    return null
  }

  return {
    time,
    open,
    high: Math.max(high, open, close),
    low: Math.min(low, open, close),
    close,
    volume: Math.max(0, Number(bar.v) || 0),
  }
}

export async function fetchAlpacaCryptoCandles(symbol: string, timeframe: Timeframe, period1: Date): Promise<Candle[]> {
  if (!isUsdCryptoSymbol(symbol)) return []

  const alpacaSymbol = toAlpacaCryptoSymbol(symbol)
  const response = await fetchAlpacaCrypto<AlpacaBarsResponse>('/bars', {
    symbols: alpacaSymbol,
    timeframe: alpacaTimeframe(timeframe),
    start: period1.toISOString(),
    limit: '10000',
  })

  return (response.bars?.[alpacaSymbol] || [])
    .map(normalizeBar)
    .filter((candle): candle is Candle => Boolean(candle))
    .sort((a, b) => a.time - b.time)
}
