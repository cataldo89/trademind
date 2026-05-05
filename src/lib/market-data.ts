/**
 * Market Data Service
 * Primary: Alpha Vantage (API key required - 25 req/day free, 500 req/day premium)
 * Fallback: Finnhub (API key required - 60 req/min free)
 * Yahoo Finance via proxy: No key required for basic quotes
 *
 * US Markets: NYSE, NASDAQ — symbols standard (AAPL, MSFT, etc.)
 */

import { Candle, Quote, MarketMover, Market, Timeframe } from '@/types'

// Category mapping for Zesty symbols (from Antecedentes PDFs)
export const SYMBOL_CATEGORY_MAP: Record<string, string> = {
  // Bitcoin & Crypto
  'BITX': 'bitcoin',
  'BABA': 'ia', // Alibaba in AI/Tech
  
  // Semiconductores
  'NVDA': 'semiconductores',
  'AMD': 'semiconductores',
  'INTC': 'semiconductores',
  'TSM': 'semiconductores',
  'ASML': 'semiconductores',
  'AMAT': 'semiconductores',
  'SOXX': 'semiconductores',
  
  // Tecnología
  'AAPL': 'tecnologia',
  'MSFT': 'tecnologia',
  'GOOGL': 'tecnologia',
  'META': 'tecnologia',
  'ADBE': 'tecnologia',
  'CRM': 'tecnologia',
  'ORCL': 'tecnologia',
  'CSCO': 'tecnologia',
  'DOCU': 'tecnologia',
  'SNAP': 'tecnologia',
  'NFLX': 'tecnologia',
  'PLTR': 'tecnologia',
  
  // IA (C3.ai específicamente)
  'AI': 'ia',
  'BOTZ': 'ia',
  
  // Biotecnología
  'IBB': 'biotecnologia',
  'CRSP': 'biotecnologia',
  'BMRN': 'biotecnologia',
  'BIO': 'biotecnologia',
  'AXSM': 'biotecnologia',
  'EXEL': 'biotecnologia',
  'GILD': 'biotecnologia',
  'INCY': 'biotecnologia',
  'IONS': 'biotecnologia',
  'JAZZ': 'biotecnologia',
  'MRNA': 'biotecnologia',
  
  // Salud
  'PFE': 'salud',
  'UNH': 'salud',
  'BDX': 'salud',
  'BMY': 'salud',
  'MDT': 'salud',
  'DUK': 'salud',
  
  // S&P 500 / Índices
  'SPY': 'sp500',
  'VOO': 'sp500',
  'IVV': 'sp500',
  'QQQ': 'tecnologia',
  'IWM': 'bajo-riesgo',
  
  // ETFs por países
  'EWG': 'etf-paises',
  'EWJ': 'etf-paises',
  'EWU': 'etf-paises',
  'EWP': 'etf-paises',
  'EWI': 'etf-paises',
  'EWQ': 'etf-paises',
  'EWY': 'etf-paises',
  'EWZ': 'etf-paises',
  'EWM': 'etf-paises',
  'EWN': 'etf-paises',
  'EWS': 'etf-paises',
  'EWA': 'etf-paises',
  'EWD': 'etf-paises',
  'EWL': 'etf-paises',
  'EWH': 'etf-paises',
  
  // ETFs Apalancados
  'SPXL': 'etf-apalancados',
  'UPRO': 'etf-apalancados',
  'TARK': 'etf-apalancados',
  'UVIX': 'etf-apalancados',
  'SOXL': 'etf-apalancados',
  'TECL': 'etf-apalancados',
  'LABU': 'etf-apalancados',
  'TSLL': 'etf-apalancados',
  'NVDU': 'etf-apalancados',
  
  // ETFs Inversos
  'SPXS': 'etf-inversos',
  'SPDN': 'etf-inversos',
  'SVIX': 'etf-inversos',
  'SARK': 'etf-inversos',
  'SOXS': 'etf-inversos',
  'TECS': 'etf-inversos',
  'LABD': 'etf-inversos',
  'TSLQ': 'etf-inversos',
  'PSQ': 'etf-inversos',
  'SH': 'etf-inversos',
  
  // Renta Fija
  'AGG': 'renta-fija',
  'BND': 'renta-fija',
  'TLT': 'renta-fija',
  'IEF': 'renta-fija',
  'SHY': 'renta-fija',
  'GOVT': 'renta-fija',
  'HYG': 'renta-fija',
  'EMB': 'renta-fija',
  
  // Altos dividendos
  'VYM': 'altos-div',
  'VIG': 'altos-div',
  'HDV': 'altos-div',
  'SCHD': 'altos-div',
  'SPYD': 'altos-div',
  'DGRO': 'altos-div',
  
  // Materias primas
  'GLD': 'materias-primas',
  'USO': 'materias-primas',
  'DBC': 'materias-primas',
  'DBA': 'materias-primas',
  'UNG': 'materias-primas',
  'WEAT': 'materias-primas',
  
  // Gaming
  'GME': 'gaming',
  'EA': 'gaming',
  'ATVI': 'gaming',
  
  // Acciones Populares/50 más populares
  'AMZN': 'acciones-pop',
  'TSLA': 'acciones-pop',
  'COST': 'acciones-pop',
  'JPM': 'acciones-pop',
  'MA': 'acciones-pop',
  'V': 'acciones-pop',
  'WMT': 'acciones-pop',
  'PG': 'acciones-pop',
  'JNJ': 'acciones-pop',
  'KO': 'acciones-pop',
}

const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query'
const FINNHUB_BASE = 'https://finnhub.io/api/v1'
const YAHOO_PROXY = '/api/market' // Our own Next.js API routes that proxy Yahoo Finance

// ---- Symbol helpers ----------------------------------------

export function getYahooSymbol(symbol: string, _market: Market): string {
  return symbol
}

export function getAlphaVantageInterval(timeframe: Timeframe): string {
  const map: Record<Timeframe, string> = {
    '1m': '1min',
    '5m': '5min',
    '15m': '15min',
    '30m': '30min',
    '1h': '60min',
    '4h': '60min',
    '1d': 'daily',
    '1w': 'weekly',
  }
  return map[timeframe] || 'daily'
}

// ---- Fetch with timeout & error handling -------------------

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, next: { revalidate: 60 } })
    clearTimeout(timer)
    return res
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

// ---- Alpha Vantage: Quote ----------------------------------

export async function fetchAlphaVantageQuote(
  symbol: string,
  apiKey: string
): Promise<Quote | null> {
  try {
    const url = `${ALPHA_VANTAGE_BASE}?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${apiKey}`
    const res = await fetchWithTimeout(url)
    const data = await res.json()

    if (data['Note'] || data['Information']) {
      console.warn('[AlphaVantage] Rate limit reached:', data['Note'] || data['Information'])
      return null
    }

    const q = data['Global Quote']
    if (!q || !q['05. price']) return null

    const price = parseFloat(q['05. price'])
    const prevClose = parseFloat(q['08. previous close'])
    const change = parseFloat(q['09. change'])
    const changePercent = parseFloat(q['10. change percent'].replace('%', ''))

    return {
      symbol: q['01. symbol'],
      name: symbol,
      price,
      previousClose: prevClose,
      change,
      changePercent,
      volume: parseInt(q['06. volume']),
      avgVolume: 0,
      high: parseFloat(q['03. high']),
      low: parseFloat(q['04. low']),
      open: parseFloat(q['02. open']),
      exchange: 'NYSE',
      market: 'US',
      currency: 'USD',
      timestamp: Date.now(),
    }
  } catch (err) {
    console.error('[AlphaVantage] Quote error:', err)
    return null
  }
}

// ---- Alpha Vantage: Intraday OHLCV -------------------------

export async function fetchAlphaVantageIntraday(
  symbol: string,
  timeframe: Timeframe,
  apiKey: string
): Promise<Candle[]> {
  try {
    const interval = getAlphaVantageInterval(timeframe)
    const isIntraday = ['1m', '5m', '15m', '30m', '1h'].includes(timeframe)
    const func = isIntraday ? 'TIME_SERIES_INTRADAY' : 'TIME_SERIES_DAILY'

    let url = `${ALPHA_VANTAGE_BASE}?function=${func}&symbol=${symbol}&apikey=${apiKey}&outputsize=compact`
    if (isIntraday) url += `&interval=${interval}`

    const res = await fetchWithTimeout(url)
    const data = await res.json()

    if (data['Note'] || data['Information']) {
      console.warn('[AlphaVantage] Rate limit:', data['Note'] || data['Information'])
      return []
    }

    const seriesKey = isIntraday
      ? `Time Series (${interval})`
      : 'Time Series (Daily)'

    const series = data[seriesKey]
    if (!series) return []

    const candles: Candle[] = Object.entries(series)
      .map(([time, values]: [string, unknown]) => {
        const v = values as Record<string, string>
        return {
          time: Math.floor(new Date(time).getTime() / 1000),
          open: parseFloat(v['1. open']),
          high: parseFloat(v['2. high']),
          low: parseFloat(v['3. low']),
          close: parseFloat(v['4. close']),
          volume: parseInt(v['5. volume']),
        }
      })
      .sort((a, b) => a.time - b.time)

    return candles
  } catch (err) {
    console.error('[AlphaVantage] Intraday error:', err)
    return []
  }
}

// ---- Finnhub: Real-time Quote ------------------------------

export async function fetchFinnhubQuote(
  symbol: string,
  apiKey: string
): Promise<Quote | null> {
  try {
    const url = `${FINNHUB_BASE}/quote?symbol=${symbol}&token=${apiKey}`
    const res = await fetchWithTimeout(url)
    const data = await res.json()

    if (!data.c || data.c === 0) return null

    return {
      symbol,
      name: symbol,
      price: data.c,
      previousClose: data.pc,
      change: data.d || data.c - data.pc,
      changePercent: data.dp || 0,
      volume: 0,
      avgVolume: 0,
      high: data.h,
      low: data.l,
      open: data.o,
      exchange: 'NYSE',
      market: 'US',
      currency: 'USD',
      timestamp: data.t * 1000,
    }
  } catch (err) {
    console.error('[Finnhub] Quote error:', err)
    return null
  }
}

// ---- Finnhub: Candles (supports 1m, 5m, 15m, 30m, 60m, D, W) --

export async function fetchFinnhubCandles(
  symbol: string,
  timeframe: Timeframe,
  apiKey: string,
  fromTimestamp?: number,
  toTimestamp?: number
): Promise<Candle[]> {
  try {
    const resolutionMap: Record<Timeframe, string> = {
      '1m': '1', '5m': '5', '15m': '15', '30m': '30',
      '1h': '60', '4h': '60', '1d': 'D', '1w': 'W',
    }
    const resolution = resolutionMap[timeframe] || 'D'
    const to = toTimestamp || Math.floor(Date.now() / 1000)
    const from = fromTimestamp || to - 7 * 24 * 60 * 60 // 7 days default

    const url = `${FINNHUB_BASE}/stock/candle?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}&token=${apiKey}`
    const res = await fetchWithTimeout(url)
    const data = await res.json()

    if (data.s !== 'ok' || !data.t) return []

    return data.t.map((time: number, i: number) => ({
      time,
      open: data.o[i],
      high: data.h[i],
      low: data.l[i],
      close: data.c[i],
      volume: data.v[i],
    }))
  } catch (err) {
    console.error('[Finnhub] Candles error:', err)
    return []
  }
}

// ---- Market Movers via our API routes ----------------------

export async function fetchMarketMovers(market: Market): Promise<MarketMover[]> {
  try {
    const res = await fetch(`/api/market/movers?market=${market}`, {
      next: { revalidate: 300 },
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.data || []
  } catch (err) {
    console.error('[MarketMovers] Error:', err)
    return []
  }
}

// ---- Quote via our API route (proxies multiple sources) ----

export async function fetchQuote(symbol: string, market: Market): Promise<Quote | null> {
  try {
    const yahooSymbol = getYahooSymbol(symbol, market)
    const res = await fetch(`/api/market/quote?symbol=${encodeURIComponent(yahooSymbol)}&market=${market}`, {
      next: { revalidate: 30 },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.data || null
  } catch (err) {
    console.error('[Quote] Error:', err)
    return null
  }
}

// ---- OHLCV via our API route -------------------------------

export async function fetchCandles(
  symbol: string,
  market: Market,
  timeframe: Timeframe
): Promise<Candle[]> {
  try {
    const yahooSymbol = getYahooSymbol(symbol, market)
    const res = await fetch(
      `/api/market/candles?symbol=${encodeURIComponent(yahooSymbol)}&timeframe=${timeframe}&market=${market}`,
      { next: { revalidate: 60 } }
    )
    if (!res.ok) return []
    const data = await res.json()
    return data.data || []
  } catch (err) {
    console.error('[Candles] Error:', err)
    return []
  }
}

// ---- Popular symbol lists (USA) --------------------
// Based on the PDFs in Inversiones folder

export const POPULAR_US_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corp.' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.' },
  { symbol: 'META', name: 'Meta Platforms' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway' },
  { symbol: 'JPM', name: 'JPMorgan Chase' },
  { symbol: 'JNJ', name: 'Johnson & Johnson' },
  { symbol: 'V', name: 'Visa Inc.' },
  { symbol: 'UNH', name: 'UnitedHealth Group' },
  { symbol: 'XOM', name: 'ExxonMobil Corp.' },
  { symbol: 'WMT', name: 'Walmart Inc.' },
  { symbol: 'MA', name: 'Mastercard Inc.' },
]

export const AI_TECH_SYMBOLS = [
  { symbol: 'NVDA', name: 'NVIDIA Corp.' },
  { symbol: 'AMD', name: 'Advanced Micro Devices' },
  { symbol: 'INTC', name: 'Intel Corp.' },
  { symbol: 'AVGO', name: 'Broadcom Inc.' },
  { symbol: 'TSM', name: 'Taiwan Semi (ADR)' },
  { symbol: 'SMCI', name: 'Super Micro Computer' },
  { symbol: 'ARM', name: 'ARM Holdings' },
  { symbol: 'PLTR', name: 'Palantir Technologies' },
  { symbol: 'AI', name: 'C3.ai Inc.' },
  { symbol: 'SOUN', name: 'SoundHound AI' },
]

export const POPULAR_ETFS = [
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF' },
  { symbol: 'QQQ', name: 'Invesco QQQ (NASDAQ)' },
  { symbol: 'IWM', name: 'iShares Russell 2000' },
  { symbol: 'VTI', name: 'Vanguard Total Market' },
  { symbol: 'GLD', name: 'SPDR Gold Shares' },
  { symbol: 'TLT', name: 'iShares 20+ Year Treasury' },
  { symbol: 'SQQQ', name: 'ProShares UltraPro Short QQQ' },
  { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ' },
  { symbol: 'SOXX', name: 'iShares Semiconductor ETF' },
  { symbol: 'ARKK', name: 'ARK Innovation ETF' },
]

export const CRYPTO_SYMBOLS = [
  { symbol: 'BTC-USD', name: 'Bitcoin' },
  { symbol: 'ETH-USD', name: 'Ethereum' },
  { symbol: 'BNB-USD', name: 'BNB' },
  { symbol: 'SOL-USD', name: 'Solana' },
]

export interface ZestyCategory {
  id: string
  name: string
  symbols: { symbol: string; name: string }[]
}

export const ZESTY_SYMBOLS = [
  { symbol: 'BITX', name: '2x Bitcoin Strategy ETF' },
  { symbol: 'UVIX', name: '2x Long VIX Futures ETF' },
  { symbol: 'SVIX', name: '-1x Short VIX Futures ETF' },
  { symbol: 'ZIVB', name: '-1x Short VIX Mid-Term Futures Strategy ETF' },
  { symbol: 'MMM', name: '3M CO' },
  { symbol: 'YEAR', name: 'AB Ultra Short Income ETF' },
  { symbol: 'ACN', name: 'Accenture plc' },
  { symbol: 'ADBE', name: 'Adobe Inc.' },
  { symbol: 'AMD', name: 'Adv Micro Devices' },
  { symbol: 'DWSH', name: 'AdvisorShares Dorsey Wright Short ETF' },
  { symbol: 'MSOX', name: 'AdvisorShares MSOS 2X Daily ETF' },
  { symbol: 'BABA', name: 'Alibaba Group Holding Limited' },
  { symbol: 'GOOGL', name: 'Alphabet Inc. Class A' },
  { symbol: 'OEUR', name: 'ALPS O\'Shares Europe Quality Dividend ETF' },
  { symbol: 'SDOG', name: 'ALPS Sector Dividend Dogs ETF' },
  { symbol: 'MO', name: 'Altria Group' },
  { symbol: 'AMZN', name: 'Amazon.com' },
  { symbol: 'AAL', name: 'American Airlines Group Inc.' },
  { symbol: 'ALL', name: 'The Allstate Corporation' },
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'AMAT', name: 'Applied Materials' },
  { symbol: 'AMOMX', name: 'AQR Momentum Fund' },
  { symbol: 'ARKG', name: 'ARK Genomic Revolution ETF' },
  { symbol: 'ASML', name: 'Asml Hld NY Reg' },
  { symbol: 'AIZ', name: 'Assurant' },
  { symbol: 'TARK', name: 'AXS 2X Innovation ETF' },
  { symbol: 'SARK', name: 'AXS Short Innovation Daily ETF' },
  { symbol: 'TSLQ', name: 'AXS TSLA Bear Daily ETF' },
  { symbol: 'AXSM', name: 'Axsome Therapeutics, Inc.' },
  { symbol: 'BIDU', name: 'Baidu' },
  { symbol: 'BDX', name: 'Becton Dickinson And Co' },
  { symbol: 'BMRN', name: 'BioMarin Pharmaceutical Inc.' },
  { symbol: 'BIO', name: 'Bio-Rad Laboratories, Inc.' },
  { symbol: 'BKNG', name: 'Booking Holdings Inc.' },
  { symbol: 'BWA', name: 'Borgwarner' },
  { symbol: 'BXP', name: 'Boston Properties' },
  { symbol: 'BMY', name: 'Bristol-Myers Squibb Company' },
  { symbol: 'BAMU', name: 'Brookstone Ultra-Short Bond ETF' },
  { symbol: 'BF.B', name: 'Brown-Forman Corporation Class B' },
  { symbol: 'CHRW', name: 'C.H. Robinson Worldwide' },
  { symbol: 'AI', name: 'C3.ai, Inc.' },
  { symbol: 'CZR', name: 'Caesars Entertainment, Inc.' },
  { symbol: 'CPB', name: 'Campbell Soup Co' },
  { symbol: 'DAY', name: 'Ceridian HCM Holding' },
  { symbol: 'CSCO', name: 'Cisco Systems' },
  { symbol: 'OPER', name: 'ClearShares Ultra-Short Maturity ETF' },
  { symbol: 'KO', name: 'Coca-Cola Company' },
  { symbol: 'CSRSX', name: 'Cohen & Steers Realty Shares Fund' },
  { symbol: 'CL', name: 'Colgate-Palmolive Company' },
  { symbol: 'CMA', name: 'Comerica' },
  { symbol: 'COST', name: 'Costco Wholesale' },
  { symbol: 'CRSP', name: 'CRISPR Therapeutics AG' },
  { symbol: 'CRWD', name: 'Crowdstrike Holdings' },
  { symbol: 'CSX', name: 'Csx Corp' },
  { symbol: 'DVA', name: 'DaVita Inc.' },
  { symbol: 'DZZ', name: 'DB Gold Double Short ETN' },
  { symbol: 'DGZ', name: 'DB Gold Short ETN' },
  { symbol: 'DFLVX', name: 'DFA US Large Cap Value Portfolio' },
  { symbol: 'DFSVX', name: 'DFA US Small Cap Value Portfolio' },
  { symbol: 'TMF', name: 'Direxion Daily 20+ Year Treasury Bull 3X Shares' },
  { symbol: 'AAPD', name: 'Direxion Daily AAPL Bear 1X Shares' },
  { symbol: 'AIBD', name: 'Direxion Daily AI and Big Data Bear 2X Shares' },
  { symbol: 'AIBU', name: 'Direxion Daily AI and Big Data Bull 2X Shares' },
  { symbol: 'AMZD', name: 'Direxion Daily AMZN Bear 1X Shares' },
  { symbol: 'CLDL', name: 'Direxion Daily Cloud Computing Bull 2X Shares' },
  { symbol: 'QQAD', name: 'Direxion Daily Concentrated Qs Bear 1X Shares' },
  { symbol: 'CHAU', name: 'Direxion Daily CSI 300 China A Share Bull 2X Shares' },
  { symbol: 'CWEB', name: 'Direxion Daily CSI China Internet Index Bull 2X Shares' },
  { symbol: 'ERY', name: 'Direxion Daily Energy Bear 2X Shares' },
  { symbol: 'ERX', name: 'Direxion Daily Energy Bull 2X Shares' },
  { symbol: 'FAZ', name: 'Direxion Daily Financial Bear 3x Shares' },
  { symbol: 'YANG', name: 'Direxion Daily FTSE China Bear 3X Shares' },
  { symbol: 'YINN', name: 'Direxion Daily FTSE China Bull 3X Shares' },
  { symbol: 'EURL', name: 'Direxion Daily FTSE Europe Bull 3x Shares' },
  { symbol: 'DUST', name: 'Direxion Daily Gold Miners Index Bear 2X Shares' },
  { symbol: 'NUGT', name: 'Direxion Daily Gold Miners Index Bull 2X Shares' },
  { symbol: 'GGLS', name: 'Direxion Daily GOOGL Bear 1X Shares' },
  { symbol: 'NAIL', name: 'Direxion Daily Homebuilders & Supplies Bull 3X Shares' },
  { symbol: 'JDST', name: 'Direxion Daily Junior Gold Miners Index Bear 2X Shares' },
  { symbol: 'JNUG', name: 'Direxion Daily Junior Gold Miners Index Bull 2X Shares' },
  { symbol: 'MIDU', name: 'Direxion Daily Mid Cap Bull 3X Shares' },
  { symbol: 'BRZU', name: 'Direxion Daily MSCI Brazil Bull 2X Shares' },
  { symbol: 'XXCH', name: 'Direxion Daily MSCI Emerging Markets ex China Bull 2X' },
  { symbol: 'INDL', name: 'Direxion Daily MSCI India Bull 2X Shares' },
  { symbol: 'MEXX', name: 'Direxion Daily MSCI Mexico Bull 3X Shares' },
  { symbol: 'NVDU', name: 'Direxion Daily NVDA Bull 1.5X Shares' },
  { symbol: 'UBOT', name: 'Direxion Daily Robotics, AI & Automation Bull 2X Shares' },
  { symbol: 'SPDN', name: 'Direxion Daily S&P 500 Bear 1X Shares' },
  { symbol: 'SPXS', name: 'Direxion Daily S&P 500 Bear 3X Shares' },
  { symbol: 'SPUU', name: 'Direxion Daily S&P 500 Bull 2X Shares' },
  { symbol: 'SPXL', name: 'Direxion Daily S&P 500 Bull 3X Shares' },
  { symbol: 'HIBS', name: 'Direxion Daily S&P 500 High Beta Bear 3X Shares' },
  { symbol: 'LABD', name: 'Direxion Daily S&P Biotech Bear 3X Shares' },
  { symbol: 'LABU', name: 'Direxion Daily S&P Biotech Bull 3x Shares' },
  { symbol: 'DRIP', name: 'Direxion Daily S&P Oil & Gas Exp. & Prod. Bear 2X' },
  { symbol: 'GUSH', name: 'Direxion Daily S&P Oil & Gas Exp. & Prod. Bull 2X' },
  { symbol: 'SOXS', name: 'Direxion Daily Semiconductor Bear 3x Shares' },
  { symbol: 'SOXL', name: 'Direxion Daily Semiconductor Bull 3x Shares' },
  { symbol: 'TZA', name: 'Direxion Daily Small Cap Bear 3X Shares' },
  { symbol: 'KORU', name: 'Direxion Daily South Korea Bull 3X Shares' },
  { symbol: 'TECS', name: 'Direxion Daily Technology Bear 3x Shares' },
  { symbol: 'TECL', name: 'Direxion Daily Technology Bull 3x Shares' },
  { symbol: 'OOTO', name: 'Direxion Daily Travel & Vacation Bull 2X Shares' },
  { symbol: 'TSLL', name: 'Direxion Daily TSLA Bull 1.5X Shares' },
  { symbol: 'DOCU', name: 'DocuSign, Inc.' },
  { symbol: 'DUK', name: 'Duke Energy Corporation' },
  { symbol: 'EQIX', name: 'Equinix' },
  { symbol: 'ACWI', name: 'ETF Acciones Mundiales iShares' },
  { symbol: 'VTI', name: 'ETF Acciones Mundiales Vanguard' },
  { symbol: 'EWG', name: 'ETF Alemania' },
  { symbol: 'KSA', name: 'ETF Arabia Saudita' },
  { symbol: 'ARKQ', name: 'ETF Autos autónomos ARK' },
  { symbol: 'GOVT', name: 'ETF Bonos del Tesoro' },
  { symbol: 'EWZ', name: 'ETF Brasil' },
  { symbol: 'QAT', name: 'ETF Catar' },
  { symbol: 'MCHI', name: 'ETF China' },
  { symbol: 'EWY', name: 'ETF Corea del Sur' },
  { symbol: 'AOA', name: 'ETF Diversificado Agresivo' },
  { symbol: 'AOM', name: 'ETF Diversificado Moderado' },
  { symbol: 'UAE', name: 'ETF Emiratos Árabes Unidos' },
  { symbol: 'EWP', name: 'ETF España' },
  { symbol: 'SPY', name: 'ETF Estados Unidos' },
  { symbol: 'EPHE', name: 'ETF Filipinas' },
  { symbol: 'EWQ', name: 'ETF Francia' },
  { symbol: 'GREK', name: 'ETF Grecia' },
  { symbol: 'PIN', name: 'ETF India' },
  { symbol: 'EIDO', name: 'ETF Indonesia' },
  { symbol: 'EIRL', name: 'ETF Irlanda' },
  { symbol: 'EIS', name: 'ETF Israel' },
  { symbol: 'EWI', name: 'ETF Italia' },
  { symbol: 'EWJ', name: 'ETF Japón' },
  { symbol: 'KWT', name: 'ETF Kuwait' },
  { symbol: 'EWM', name: 'ETF Malasia' },
  { symbol: 'VEA', name: 'ETF Mercados Desarrollados' },
  { symbol: 'IEFA', name: 'ETF Mercados Desarrollados Core ex US' },
  { symbol: 'EEM', name: 'ETF Mercados Emergentes' },
  { symbol: 'NORW', name: 'ETF Noruega' },
  { symbol: 'ENZL', name: 'ETF Nueva Zelanda' },
  { symbol: 'EWN', name: 'ETF Países Bajos' },
  { symbol: 'EPU', name: 'ETF Perú' },
  { symbol: 'EPOL', name: 'ETF Polonia' },
  { symbol: 'EWU', name: 'ETF Reino Unido' },
  { symbol: 'AGG', name: 'ETF Renta Fija Agregada' },
  { symbol: 'IVV', name: 'ETF S&P 500' },
  { symbol: 'EWS', name: 'ETF Singapur' },
  { symbol: 'EZA', name: 'ETF Sudáfrica' },
  { symbol: 'EWD', name: 'ETF Suecia' },
  { symbol: 'EWL', name: 'ETF Suiza' },
  { symbol: 'THD', name: 'ETF Tailandia' },
  { symbol: 'EWT', name: 'ETF Taiwán' },
  { symbol: 'QQQ', name: 'ETF Tecnología' },
  { symbol: 'TIP', name: 'ETF TIPS' },
  { symbol: 'TUR', name: 'ETF Turquía' },
  { symbol: 'VNM', name: 'ETF Vietnam' },
  { symbol: 'BNO', name: 'United States Brent Oil Fund, LP' },
  { symbol: 'CPER', name: 'United States Copper Index Fund' },
  { symbol: 'DBA', name: 'Invesco DB Agriculture Fund' },
  { symbol: 'DBB', name: 'Invesco DB Base Metals Fund' },
  { symbol: 'DBC', name: 'Invesco DB Commodity Index Tracking Fund' },
  { symbol: 'GLD', name: 'SPDR Gold Shares' },
  { symbol: 'IAU', name: 'iShares Gold Trust' },
  { symbol: 'SLV', name: 'iShares Silver Trust' },
  { symbol: 'UGA', name: 'United States Gasoline Fund' },
  { symbol: 'UNG', name: 'United States Natural Gas Fund' },
  { symbol: 'USCI', name: 'United States Commodity Index Fund' },
  { symbol: 'USO', name: 'United States Oil Fund, LP' },
  { symbol: 'WEAT', name: 'Teucrium Wheat Fund' },
  { symbol: 'USML', name: 'ETRACS 2x Leveraged MSCI US Minimum Volatility Factor' },
  { symbol: 'MTUL', name: 'ETRACS 2x Leveraged MSCI US Momentum Factor' },
  { symbol: 'IWML', name: 'ETRACS 2x Leveraged US Size Factor' },
  { symbol: 'IWDL', name: 'ETRACS 2x Leveraged US Value Factor' },
  { symbol: 'HDLB', name: 'ETRACS 2xMonthly Pay Leveraged US High Dividend Low Volatility' },
  { symbol: 'SMHB', name: 'ETRACS 2xMonthly Pay Leveraged US Small Cap High Dividend' },
  { symbol: 'PFFL', name: 'ETRACS Monthly Pay 2xLeveraged Preferred Stock ETN' },
  { symbol: 'ETSY', name: 'Etsy' },
  { symbol: 'EXEL', name: 'Exelixis, Inc.' },
  { symbol: 'TTAI', name: 'FCF International Quality ETF' },
  { symbol: 'FRT', name: 'Federal Realty Invs Trust' },
  { symbol: 'FTEC', name: 'Fidelity MSCI Information Technology Index ETF' },
  { symbol: 'FTEXX', name: 'Fidelity Municipal Money Market Fund' },
  { symbol: 'FRESX', name: 'Fidelity Real Estate Investment Portfolio' },
  { symbol: 'FSHX', name: 'Fidelity Spartan International Index Fund' },
  { symbol: 'FRXIX', name: 'Fidelity Spartan Real Estate Index Fund' },
  { symbol: 'FSTMX', name: 'Fidelity Spartan Total Index' },
  { symbol: 'FDL', name: 'First Trust Morningstar Dividend Leaders Index Fund' },
  { symbol: 'FBT', name: 'First Trust NYSE Arca Biotechnology Index Fund' },
  { symbol: 'FUMB', name: 'First Trust Ultra Short Duration Municipal ETF' },
  { symbol: 'FMC', name: 'Fmc Corp' },
  { symbol: 'FOXA', name: 'Fox Corp Clase A' },
  { symbol: 'FLAX', name: 'Franklin FTSE Asia ex Japan ETF' },
  { symbol: 'FLAU', name: 'Franklin FTSE Australia ETF' },
  { symbol: 'FLBR', name: 'Franklin FTSE Brazil ETF' },
  { symbol: 'FLCA', name: 'Franklin FTSE Canada ETF' },
  { symbol: 'FLCH', name: 'Franklin FTSE China ETF' },
  { symbol: 'FLEE', name: 'Franklin FTSE Europe ETF' },
  { symbol: 'FLEU', name: 'Franklin FTSE Eurozone ETF' },
  { symbol: 'FLGR', name: 'Franklin FTSE Germany ETF' },
  { symbol: 'FLHK', name: 'Franklin FTSE Hong Kong ETF' },
  { symbol: 'FLIN', name: 'Franklin FTSE India ETF' },
  { symbol: 'FLJP', name: 'Franklin FTSE Japan ETF' },
  { symbol: 'FLJH', name: 'Franklin FTSE Japan Hedged ETF' },
  { symbol: 'FLLA', name: 'Franklin FTSE Latin America' },
  { symbol: 'FLMX', name: 'Franklin FTSE Mexico ETF' },
  { symbol: 'FLSA', name: 'Franklin FTSE Saudi Arabia ETF' },
  { symbol: 'FLKR', name: 'Franklin FTSE South Korea ETF' },
  { symbol: 'FLSW', name: 'Franklin FTSE Switzerland ETF' },
  { symbol: 'FLTW', name: 'Franklin FTSE Taiwan ETF' },
  { symbol: 'FLGB', name: 'Franklin FTSE United Kingdom ETF' },
  { symbol: 'BEN', name: 'Franklin Resources' },
  { symbol: 'FLUD', name: 'Franklin Ultra Short Bond ETF' },
  { symbol: 'FCX', name: 'Freeport-Mcmoran' },
  { symbol: 'GME', name: 'Gamestop Corp' },
  { symbol: 'GNRC', name: 'Generac Holdings Inc.' },
  { symbol: 'GILD', name: 'Gilead Sciences' },
  { symbol: 'ASEA', name: 'Global X FTSE Southeast Asia ETF' },
  { symbol: 'GNOM', name: 'Global X Funds Global X Genomics & Biotechnology ETF' },
  { symbol: 'BOTZ', name: 'Global X Funds Global X Robotics & Artificial Intelligence ETF' },
  { symbol: 'SRET', name: 'Global X Funds Global X SuperDividend REIT ETF' },
  { symbol: 'MLPA', name: 'Global X MLP ETF' },
  { symbol: 'COLO', name: 'Global X MSCI Colombia ETF' },
  { symbol: 'VNAM', name: 'Global X MSCI Vietnam ETF' },
  { symbol: 'SDIV', name: 'Global X SuperDividend ETF' },
  { symbol: 'GL', name: 'Globe Life' },
  { symbol: 'SHRT', name: 'Gotham Short Strategies ETF' },
  { symbol: 'TSDD', name: 'GraniteShares 1.5x Short TSLA Daily ETF' },
  { symbol: 'AMDL', name: 'GraniteShares 2x Long AMD Daily ETF' },
  { symbol: 'AMZZ', name: 'GraniteShares 2x Long AMZN Daily ETF' },
  { symbol: 'MSFL', name: 'GraniteShares 2x Long MSFT Daily ETF' },
  { symbol: 'NVDL', name: 'GraniteShares 2x Long NVDA Daily ETF' },
  { symbol: 'AAPB', name: 'GraniteShares 2x Long Tilray Daily ETF' },
  { symbol: 'NVD', name: 'GraniteShares 2x Short NVDA Daily ETF' },
  { symbol: 'EWRI', name: 'Guggenheim Russell 1000 Equal Weight ETF' },
  { symbol: 'HAS', name: 'Hasbro' },
  { symbol: 'HSIC', name: 'Henry Schein, Inc.' },
  { symbol: 'HRL', name: 'Hormel Foods Corp' },
  { symbol: 'ITW', name: 'Illinois Tool Works Inc.' },
  { symbol: 'INCY', name: 'Incyte Corp' },
  { symbol: 'INTC', name: 'Intel Corp' },
  { symbol: 'IBM', name: 'International Business Machines Corporation' },
  { symbol: 'DJD', name: 'Invesco Dow Jones Industrial Average Dividend ETF' },
  { symbol: 'PRF', name: 'Invesco FTSE RAFI US 1000 ETF' },
  { symbol: 'PEY', name: 'Invesco High Yield Equity Dividend Achievers ETF' },
  { symbol: 'KBWD', name: 'Invesco KBW High Dividend Yield Financial ETF' },
  { symbol: 'IVZ', name: 'Invesco Ltd.' },
  { symbol: 'SPHD', name: 'Invesco S&P 500 High Dividend Low Volatility ETF' },
  { symbol: 'RDIV', name: 'Invesco S&P Ultra Dividend Revenue ETF' },
  { symbol: 'PHO', name: 'Invesco Water Resources ETF' },
  { symbol: 'IONS', name: 'Ionis Pharmaceuticals, Inc.' },
  { symbol: 'SGOV', name: 'iShares 0-3 Month Treasury Bond ETF' },
  { symbol: 'SHY', name: 'iShares 1-3 Year Treasury Bond ETF' },
  { symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF' },
  { symbol: 'TLTW', name: 'iShares 20+ Year Treasury Bond BuyWrite Strategy ETF' },
  { symbol: 'IEI', name: 'iShares 3-7 Year Treasury Bond ETF' },
  { symbol: 'IEF', name: 'iShares 7-10 Year Treasury Bond ETF' },
  { symbol: 'IBB', name: 'iShares Biotechnology ETF' },
  { symbol: 'ICP', name: 'iShares Cohen & Steers REIT ETF' },
  { symbol: 'HDV', name: 'iShares Core High Dividend ETF' },
  { symbol: 'IUSB', name: 'iShares Core Total USD Bond Market ETF' },
  { symbol: 'IUSV', name: 'iShares Core US Value ETF' },
  { symbol: 'DVYE', name: 'iShares Emerging Markets Dividend ETF' },
  { symbol: 'SUSB', name: 'iShares ESG 1-5 Year USD Corporate Bond ETF' },
  { symbol: 'USXF', name: 'iShares ESG Advanced MSCI USA ETF' },
  { symbol: 'EUSB', name: 'iShares ESG Advanced Total USD Bond Market ETF' },
  { symbol: 'ESGD', name: 'iShares ESG Aware MSCI EAFE ETF' },
  { symbol: 'ESGE', name: 'iShares ESG Aware MSCI EM ETF' },
  { symbol: 'ESGU', name: 'iShares ESG Aware MSCI USA ETF' },
  { symbol: 'IGM', name: 'iShares Expanded Tech Sector ETF' },
  { symbol: 'FLOT', name: 'iShares Floating Rate Bond ETF' },
  { symbol: 'IDNA', name: 'iShares Genomics Immunology and Healthcare ETF' },
  { symbol: 'ICLN', name: 'iShares Global Clean Energy ETF' },
  { symbol: 'IXN', name: 'iShares Global Tech ETF' },
  { symbol: 'IBTE', name: 'iShares iBonds Dec 2024 Term Treasury ETF' },
  { symbol: 'HYG', name: 'iShares iBoxx $ High Yield Corporate Bond ETF' },
  { symbol: 'EMB', name: 'iShares J.P. Morgan USD Emerging Markets Bond ETF' },
  { symbol: 'MBB', name: 'iShares MBS ETF' },
  { symbol: 'EWZS', name: 'iShares MSCI Brazil Small-Cap ETF' },
  { symbol: 'TCHI', name: 'iShares MSCI China Multisector Tech ETF' },
  { symbol: 'SMIN', name: 'iShares MSCI India Small-Cap ETF' },
  { symbol: 'SCJ', name: 'iShares MSCI Japan Small-Cap ETF' },
  { symbol: 'EWJV', name: 'iShares MSCI Japan Value ETF' },
  { symbol: 'EWW', name: 'iShares MSCI Mexico ETF' },
  { symbol: 'EWUS', name: 'iShares MSCI United Kingdom Small-Cap ETF' },
  { symbol: 'SUSA', name: 'iShares MSCI USA ESG Select ETF' },
  { symbol: 'USMV', name: 'iShares MSCI USA Min Vol Factor ETF' },
  { symbol: 'SIZE', name: 'iShares MSCI USA Size Factor ETF' },
  { symbol: 'SMMV', name: 'iShares MSCI USA Small-Cap Min Vol Factor ETF' },
  { symbol: 'SMLF', name: 'iShares MSCI USA Small-Cap Multifactor ETF' },
  { symbol: 'VLUE', name: 'iShares MSCI USA Value Factor ETF' },
  { symbol: 'URTH', name: 'iShares MSCI World ETF' },
  { symbol: 'PFF', name: 'iShares Preferred & Income Securities ETF' },
  { symbol: 'IWB', name: 'iShares Russell 1000 ETF' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF' },
  { symbol: 'IJS', name: 'iShares S&P Small-Cap 600 Value' },
  { symbol: 'SOXX', name: 'iShares Semiconductor ETF' },
  { symbol: 'SHV', name: 'iShares Short Treasury Bond ETF' },
  { symbol: 'IGSB', name: 'iShares Trust iShares 1-5 Year Investment Grade Corporate Bond ETF' },
  { symbol: 'IYW', name: 'iShares U.S. Technology ETF' },
  { symbol: 'JAZZ', name: 'Jazz Pharmaceuticals plc' },
  { symbol: 'JPM', name: 'JP Morgan Chase' },
  { symbol: 'JEPQ', name: 'JPMorgan Nasdaq Equity Premium Income ETF' },
  { symbol: 'JSCP', name: 'JPMorgan Short Duration Core Plus ETF' },
  { symbol: 'JPST', name: 'JPMorgan Ultra-Short Income ETF' },
  { symbol: 'JMST', name: 'JPMorgan Ultra-Short Municipal Income ETF' },
  { symbol: 'KBA', name: 'KraneShares Bosera MSCI China A 50 Connect Index ETF' },
  { symbol: 'KURE', name: 'KraneShares MSCI All China Health Care Index ETF' },
  { symbol: 'KALL', name: 'KraneShares MSCI All China Index ETF' },
  { symbol: 'LMT', name: 'Lockheed Martin Corp' },
  { symbol: 'MKTX', name: 'MarketAxess Holdings Inc.' },
  { symbol: 'MA', name: 'Mastercard' },
  { symbol: 'MTCH', name: 'Match Group Inc' },
  { symbol: 'MCD', name: 'McDonald\'s Corp' },
  { symbol: 'MCK', name: 'Mckesson Corp' },
  { symbol: 'MDT', name: 'Medtronic Plc' },
  { symbol: 'META', name: 'Meta Platforms Inc.' },
  { symbol: 'WTID', name: 'MicroSectors Energy -3x Inverse Leveraged ETNs' },
  { symbol: 'WTIU', name: 'MicroSectors Energy 3x Leveraged ETNs' },
  { symbol: 'SHNY', name: 'MicroSectors Gold 3x Leveraged ETN' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'MRNA', name: 'Moderna' },
  { symbol: 'QCLN', name: 'Nasdaq Clean Edge Green Energy Index Fund FT' },
  { symbol: 'NFLX', name: 'Netflix' },
  { symbol: 'NWSA', name: 'News Corp Clase A' },
  { symbol: 'NIO', name: 'Nio' },
  { symbol: 'TIPD', name: 'Northern Trust 2055 Inflation-Linked Distributing Ladder ETF' },
  { symbol: 'NCLH', name: 'Norwegian Cruise Ord' },
  { symbol: 'NVDA', name: 'Nvidia' },
  { symbol: 'OMF', name: 'OneMain Holdings, Inc.' },
  { symbol: 'ORCL', name: 'Oracle Corp' },
  { symbol: 'AFTY', name: 'Pacer CSOP FTSE China A50 ETF' },
  { symbol: 'PLTR', name: 'Palantir Technologies' },
  { symbol: 'PARA', name: 'Paramount Global-Class B' },
  { symbol: 'PH', name: 'Parker Hannifin Corp' },
  { symbol: 'PAYC', name: 'Paycom Software' },
  { symbol: 'PYPL', name: 'Paypal Holdings' },
  { symbol: 'PEP', name: 'Pepsico' },
  { symbol: 'PFE', name: 'Pfizer' },
  { symbol: 'PFRL', name: 'PGIM Floating Rate Income ETF' },
  { symbol: 'PM', name: 'Philip Morris International' },
  { symbol: 'PSX', name: 'Phillips 66' },
  { symbol: 'DOC', name: 'Physicians Realty Trust' },
  { symbol: 'BILZ', name: 'PIMCO Ultra Short Government Active ETF' },
  { symbol: 'PNW', name: 'Pinnacle West Capital' },
  { symbol: 'SPLV', name: 'PowerShares S&P 500 Low Volatility Portfolio' },
  { symbol: 'TBF', name: 'ProShares Short 20+ Year Treasury ETF' },
  { symbol: 'TBX', name: 'ProShares Short 7-10 Year Treasury' },
  { symbol: 'DOG', name: 'ProShares Short Dow30' },
  { symbol: 'SETH', name: 'ProShares Short Ether Strategy ETF' },
  { symbol: 'SEF', name: 'ProShares Short Financials' },
  { symbol: 'YXI', name: 'ProShares Short FTSE China 50' },
  { symbol: 'MYY', name: 'ProShares Short MidCap400' },
  { symbol: 'EFZ', name: 'ProShares Short MSCI EAFE' },
  { symbol: 'EUM', name: 'ProShares Short MSCI Emerging Markets' },
  { symbol: 'PSQ', name: 'ProShares Short QQQ' },
  { symbol: 'REK', name: 'ProShares Short Real Estate' },
  { symbol: 'RWM', name: 'ProShares Short Russell2000' },
  { symbol: 'SH', name: 'ProShares Short S&P500' },
  { symbol: 'SBB', name: 'ProShares Short SmallCap600' },
  { symbol: 'XPP', name: 'ProShares Ultra FTSE China 50' },
  { symbol: 'UPV', name: 'ProShares Ultra FTSE Europe' },
  { symbol: 'UBR', name: 'ProShares Ultra MSCI Brazil Capped' },
  { symbol: 'EZJ', name: 'ProShares Ultra MSCI Japan' },
  { symbol: 'BIB', name: 'ProShares Ultra Nasdaq Biotechnology' },
  { symbol: 'TSLI', name: 'ProShares Ultra TSLA' },
  { symbol: 'TTT', name: 'ProShares UltraPro Short 20+ Year Treasury' },
  { symbol: 'SDOW', name: 'ProShares UltraPro Short Dow30' },
  { symbol: 'SMDD', name: 'ProShares UltraPro Short MidCap400' },
  { symbol: 'SRTY', name: 'ProShares UltraPro Short Russell2000' },
  { symbol: 'SPXU', name: 'ProShares UltraPro Short S&P500' },
  { symbol: 'EPV', name: 'ProShares UltraShort FTSE Europe' },
  { symbol: 'EWV', name: 'ProShares UltraShort MSCI Japan' },
  { symbol: 'PULT', name: 'Putnam ESG Ultra Short ETF' },
  { symbol: 'REG', name: 'Regency Centers Corp' },
  { symbol: 'RHI', name: 'Robert Half Intl' },
  { symbol: 'CRM', name: 'Salesforce, Inc.' },
  { symbol: 'SAP', name: 'SAP SE' },
  { symbol: 'SWISX', name: 'Schwab International Index' },
  { symbol: 'SWRXX', name: 'Schwab Total Stock Market Index' },
  { symbol: 'SCHX', name: 'Schwab U.S. Large-Cap ETF' },
  { symbol: 'SCHD', name: 'Schwab US Dividend Equity ETF' },
  { symbol: 'SCHH', name: 'Schwab US REIT ETF' },
  { symbol: 'SCHA', name: 'Schwab US Small-Cap ETF' },
  { symbol: 'SNAP', name: 'Snap Inc.' },
  { symbol: 'TAN', name: 'Solar Invesco ETF' },
  { symbol: 'SOLV', name: 'Solventum Corporation' },
  { symbol: 'BIL', name: 'SPDR Bloomberg 1-3 Month T-Bill ETF' },
  { symbol: 'RWR', name: 'SPDR DJ Wilshire REIT ETF' },
  { symbol: 'KOMP', name: 'SPDR Kensho New Economies Composite ETF' },
  { symbol: 'SPYD', name: 'SPDR Portfolio S&P 500 High Dividend ETF' },
  { symbol: 'SPSB', name: 'SPDR Portfolio Short Term Corporate Bond ETF' },
  { symbol: 'SPTS', name: 'SPDR Portfolio Short Term Treasury ETF' },
  { symbol: 'LGLV', name: 'SPDR Russell 1000 Low Volatility ETF' },
  { symbol: 'TWOK', name: 'SPDR Russell 2000' },
  { symbol: 'MMTM', name: 'SPDR S&P 1500 Momentum Tilt ETF' },
  { symbol: 'STLA', name: 'Stellantis N.V.' },
  { symbol: 'PTEXX', name: 'T. Rowe Price Tax-Exempt Money Market Fund' },
  { symbol: 'TBUX', name: 'T. Rowe Price Ultra Short-Term Bond ETF' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor Manufacturing' },
  { symbol: 'TPR', name: 'Tapestry' },
  { symbol: 'TFX', name: 'Teleflex' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'TMUS', name: 'T-Mobile US' },
  { symbol: 'TUSI', name: 'Touchstone Ultra Short Income ETF' },
  { symbol: 'TSLZ', name: 'T-Rex 2X Inverse Tesla Daily Target ETF' },
  { symbol: 'AAPX', name: 'T-Rex 2X Long Apple Daily Target ETF' },
  { symbol: 'MSFX', name: 'T-Rex 2X Long Microsoft Daily Target ETF' },
  { symbol: 'NVDX', name: 'T-Rex 2X Long NVIDIA Daily Target ETF' },
  { symbol: 'TSLT', name: 'T-REX 2X Long Tesla Daily Target ETF' },
  { symbol: 'VFIAX', name: 'Vanguard 500 Index Admiral' },
  { symbol: 'VTMGX', name: 'Vanguard Developed Markets Index' },
  { symbol: 'VIG', name: 'Vanguard Dividend Appreciation ETF' },
  { symbol: 'VDAIX', name: 'Vanguard Dividend Appreciation Index Fund' },
  { symbol: 'VDIGX', name: 'Vanguard Dividend Growth Fund' },
  { symbol: 'VEMAX', name: 'Vanguard Emerging Markets Stock Index Admiral' },
  { symbol: 'VEIRX', name: 'Vanguard Equity Income Fund Admiral' },
  { symbol: 'VSGX', name: 'Vanguard ESG International Stock ETF' },
  { symbol: 'ESGV', name: 'Vanguard ESG U.S. Stock ETF' },
  { symbol: 'VEU', name: 'Vanguard FTSE All-World ex US Index Fund' },
  { symbol: 'VGK', name: 'Vanguard FTSE Europe ETF' },
  { symbol: 'VPL', name: 'Vanguard FTSE Pacific ETF' },
  { symbol: 'VUG', name: 'Vanguard Growth ETF' },
  { symbol: 'VIGAX', name: 'Vanguard Growth Index Fund' },
  { symbol: 'VYM', name: 'Vanguard High Dividend Yield ETF' },
  { symbol: 'VGT', name: 'Vanguard Information Technology ETF' },
  { symbol: 'BIV', name: 'Vanguard Intermediate-Term Bond ETF' },
  { symbol: 'VGIT', name: 'Vanguard Intermediate-Term Treasury ETF' },
  { symbol: 'VYMI', name: 'Vanguard International High Dividend Yield ETF' },
  { symbol: 'VMBS', name: 'Vanguard Mortgage-Backed Securities ETF' },
  { symbol: 'VNQ', name: 'Vanguard REIT Index ETF' },
  { symbol: 'VGSLX', name: 'Vanguard REIT Index Fund Admiral' },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF' },
  { symbol: 'BSV', name: 'Vanguard Short-Term Bond ETF' },
  { symbol: 'VGSH', name: 'Vanguard Short-Term Treasury ETF' },
  { symbol: 'VSMAX', name: 'Vanguard Small Cap Index Admiral' },
  { symbol: 'VBR', name: 'Vanguard Small-Cap Value Index Fund' },
  { symbol: 'VTEB', name: 'Vanguard Tax-Exempt Bond Index Fund' },
  { symbol: 'VMSXX', name: 'Vanguard Tax-Exempt Money Market Fund' },
  { symbol: 'VXUS', name: 'Vanguard Total International Stock ETF' },
  { symbol: 'VTIAX', name: 'Vanguard Total International Stock Index Admiral' },
  { symbol: 'VTSAX', name: 'Vanguard Total Stock Market Index Admiral' },
  { symbol: 'VTWSX', name: 'Vanguard Total World Stock Index' },
  { symbol: 'VVIAX', name: 'Vanguard Value Index Fund' },
  { symbol: 'VZ', name: 'Verizon Communications' },
  { symbol: 'DIS', name: 'Walt Disney Company' },
  { symbol: 'EPS', name: 'WisdomTree Earnings 500 ETF' },
  { symbol: 'USFR', name: 'WisdomTree Floating Rate Treasury Fund' },
  { symbol: 'DLN', name: 'WisdomTree Large-Cap Dividend Fund' },
  { symbol: 'DTD', name: 'WisdomTree Total Dividend Fund' },
  { symbol: 'DGRW', name: 'WisdomTree US Dividend Growth Fund' },
  { symbol: 'WYNN', name: 'Wynn Resorts Ltd' },
  { symbol: 'USSG', name: 'Xtrackers MSCI USA ESG Leaders Equity ETF' },
  { symbol: 'CRSH', name: 'YieldMax Short TSLA Option Income Strategy ETF' },
  { symbol: 'ZTS', name: 'Zoetis' },
]

export function getCategorizedZestySymbols(): ZestyCategory[] {
  const categories: Record<string, ZestyCategory> = {
    'zesty-all': { id: 'zesty-all', name: 'Zesty All', symbols: [] },
    'acciones-pop': { id: 'acciones-pop', name: 'Acciones Populares', symbols: [] },
    'altos-div': { id: 'altos-div', name: 'Altos dividendos', symbols: [] },
    'bajo-riesgo': { id: 'bajo-riesgo', name: 'Bajo riesgo', symbols: [] },
    'biotecnologia': { id: 'biotecnologia', name: 'Biotecnología', symbols: [] },
    'bitcoin': { id: 'bitcoin', name: 'Bitcoin', symbols: [] },
    'etf-paises': { id: 'etf-paises', name: 'ETF por paises', symbols: [] },
    'etf-apalancados': { id: 'etf-apalancados', name: 'ETFs apalancados', symbols: [] },
    'etf-balanceados': { id: 'etf-balanceados', name: 'ETFs Balanceados', symbols: [] },
    'etf-inversos': { id: 'etf-inversos', name: 'ETFs inversos', symbols: [] },
    'etf-populares': { id: 'etf-populares', name: 'ETFs Populares', symbols: [] },
    'etf-sp500': { id: 'etf-sp500', name: 'ETFs S&P 500US', symbols: [] },
    'ethereum': { id: 'ethereum', name: 'Ethereum', symbols: [] },
    'gaming': { id: 'gaming', name: 'Gaming', symbols: [] },
    'ia': { id: 'ia', name: 'IA', symbols: [] },
    'materias-primas': { id: 'materias-primas', name: 'Materias primas', symbols: [] },
    'moda': { id: 'moda', name: 'Moda', symbols: [] },
    'renta-fija': { id: 'renta-fija', name: 'Renta fija', symbols: [] },
    'sp500': { id: 'sp500', name: 'S&P 500 US', symbols: [] },
    'salud': { id: 'salud', name: 'Salud', symbols: [] },
    'semiconductores': { id: 'semiconductores', name: 'Semiconductores', symbols: [] },
    'sustentabilidad': { id: 'sustentabilidad', name: 'Sustentabilidad', symbols: [] },
    'tecnologia': { id: 'tecnologia', name: 'Tecnología', symbols: [] },
    'otros': { id: 'otros', name: 'Otros Zesty', symbols: [] },
  }

  ZESTY_SYMBOLS.forEach((item) => {
    categories['zesty-all'].symbols.push(item)

    const categoryId = SYMBOL_CATEGORY_MAP[item.symbol]
    
    if (categoryId && categories[categoryId]) {
      categories[categoryId].symbols.push(item)
    } else {
      // Use keyword-based fallback for unmapped symbols
      const nameUpper = item.name.toUpperCase()
      let categorized = false
      
      if (nameUpper.includes('ETHEREUM') || nameUpper.includes('ETHER')) {
        categories['ethereum'].symbols.push(item)
        categorized = true
      }
      
      if (nameUpper.includes('ETF') && nameUpper.includes('S&P 500') && !categorized) {
        categories['etf-sp500'].symbols.push(item)
        categorized = true
      }
      
      if (nameUpper.includes('REIT') || nameUpper.includes('REAL ESTATE') && !categorized) {
        categories['etf-balanceados'].symbols.push(item)
        categorized = true
      }
      
      if (nameUpper.includes('ESG') || nameUpper.includes('CLEAN') || nameUpper.includes('GREEN') || nameUpper.includes('SUSTAIN') && !categorized) {
        categories['sustentabilidad'].symbols.push(item)
        categorized = true
      }
      
      if (nameUpper.includes('APPAREL') || nameUpper.includes('FASHION') || nameUpper.includes('FOOTWEAR') && !categorized) {
        categories['moda'].symbols.push(item)
        categorized = true
      }
      
      if (nameUpper.includes('ETF') && !categorized) {
        categories['etf-populares'].symbols.push(item)
        categorized = true
      }

      if (!categorized) {
        categories['otros'].symbols.push(item)
      }
    }
  })

  // Ensure unique symbols in each category
  Object.keys(categories).forEach(key => {
    const unique = new Map()
    categories[key].symbols.forEach(s => unique.set(s.symbol, s))
    categories[key].symbols = Array.from(unique.values()).sort((a, b) => a.symbol.localeCompare(b.symbol))
  })

  return Object.values(categories).filter((cat) => cat.symbols.length > 0).sort((a, b) => {
    // Sort categories by importance
    const priority: Record<string, number> = {
      'zesty-all': 1,
      'acciones-pop': 2,
      'tecnologia': 3,
      'semiconductores': 4,
      'ia': 5,
      'sp500': 6,
      'etf-sp500': 7,
      'etf-paises': 8,
      'etf-populares': 9,
      'etf-apalancados': 10,
      'etf-inversos': 11,
      'biotecnologia': 12,
      'salud': 13,
      'altos-div': 14,
      'renta-fija': 15,
      'materias-primas': 16,
      'gaming': 17,
      'sustentabilidad': 18,
      'moda': 19,
      'bajo-riesgo': 20,
      'bitcoin': 21,
      'ethereum': 22,
      'etf-balanceados': 23,
      'otros': 24,
    }
    return (priority[a.id] || 999) - (priority[b.id] || 999)
  })
}

# bumped: 2026-05-05T04:21:00