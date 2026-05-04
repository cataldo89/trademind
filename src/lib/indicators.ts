/**
 * Technical Indicators
 * Calculated client-side from OHLCV data
 * Sources: Wilder's RSI, MACD (EMA-based), Bollinger Bands, SMA
 */

import { Candle, RSIResult, MACDResult, BollingerBandsResult, MovingAverageResult } from '@/types'

// ---- Simple Moving Average ---------------------------------
export function calculateSMA(candles: Candle[], period: number): MovingAverageResult[] {
  const results: MovingAverageResult[] = []
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1)
    const avg = slice.reduce((sum, c) => sum + c.close, 0) / period
    results.push({ time: candles[i].time, value: avg })
  }
  return results
}

// ---- Exponential Moving Average ----------------------------
function calculateEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const ema: number[] = [values[0]]
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k))
  }
  return ema
}

export function calculateEMACandles(candles: Candle[], period: number): MovingAverageResult[] {
  if (candles.length < period) return []
  const closes = candles.map((c) => c.close)
  const ema = calculateEMA(closes, period)
  return candles.map((c, i) => ({ time: c.time, value: ema[i] })).slice(period - 1)
}

// ---- RSI (Wilder's Smoothing) ------------------------------
export function calculateRSI(candles: Candle[], period = 14): RSIResult[] {
  if (candles.length < period + 1) return []

  const results: RSIResult[] = []
  const closes = candles.map((c) => c.close)
  const gains: number[] = []
  const losses: number[] = []

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    gains.push(diff > 0 ? diff : 0)
    losses.push(diff < 0 ? Math.abs(diff) : 0)
  }

  // First RSI using simple average
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
  results.push({ time: candles[period].time, value: 100 - 100 / (1 + rs) })

  // Subsequent RSI using Wilder's smoothing
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    results.push({ time: candles[i + 1].time, value: 100 - 100 / (1 + rs) })
  }

  return results
}

// ---- MACD --------------------------------------------------
export function calculateMACD(
  candles: Candle[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDResult[] {
  if (candles.length < slowPeriod + signalPeriod) return []

  const closes = candles.map((c) => c.close)
  const fastEMA = calculateEMA(closes, fastPeriod)
  const slowEMA = calculateEMA(closes, slowPeriod)

  const macdLine: number[] = []
  const times: number[] = []

  for (let i = slowPeriod - 1; i < closes.length; i++) {
    macdLine.push(fastEMA[i] - slowEMA[i])
    times.push(candles[i].time)
  }

  const signalLine = calculateEMA(macdLine, signalPeriod)
  const results: MACDResult[] = []

  for (let i = signalPeriod - 1; i < macdLine.length; i++) {
    results.push({
      time: times[i],
      macd: macdLine[i],
      signal: signalLine[i],
      histogram: macdLine[i] - signalLine[i],
    })
  }

  return results
}

// ---- Bollinger Bands ---------------------------------------
export function calculateBollingerBands(
  candles: Candle[],
  period = 20,
  stdDev = 2
): BollingerBandsResult[] {
  if (candles.length < period) return []

  const results: BollingerBandsResult[] = []

  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1)
    const closes = slice.map((c) => c.close)
    const mean = closes.reduce((a, b) => a + b, 0) / period
    const variance = closes.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / period
    const std = Math.sqrt(variance)

    results.push({
      time: candles[i].time,
      upper: mean + stdDev * std,
      middle: mean,
      lower: mean - stdDev * std,
    })
  }

  return results
}

// ---- VWAP (Volume Weighted Average Price) ------------------
export function calculateVWAP(candles: Candle[]): MovingAverageResult[] {
  let cumulativeTPV = 0
  let cumulativeVolume = 0

  return candles.map((c) => {
    const typicalPrice = (c.high + c.low + c.close) / 3
    cumulativeTPV += typicalPrice * c.volume
    cumulativeVolume += c.volume
    return {
      time: c.time,
      value: cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice,
    }
  })
}

// ---- ATR (Average True Range) ------------------------------
export function calculateATR(candles: Candle[], period = 14): MovingAverageResult[] {
  if (candles.length < period + 1) return []

  const trueRanges: number[] = []

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high
    const low = candles[i].low
    const prevClose = candles[i - 1].close
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    trueRanges.push(tr)
  }

  const results: MovingAverageResult[] = []
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period
  results.push({ time: candles[period].time, value: atr })

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period
    results.push({ time: candles[i + 1].time, value: atr })
  }

  return results
}

// ---- RSI Signal interpretation -----------------------------
export function interpretRSI(rsiValue: number): { signal: string; color: string } {
  if (rsiValue > 70) return { signal: 'Sobrecomprado', color: 'text-red-400' }
  if (rsiValue < 30) return { signal: 'Sobrevendido', color: 'text-emerald-400' }
  if (rsiValue > 60) return { signal: 'Alcista', color: 'text-emerald-300' }
  if (rsiValue < 40) return { signal: 'Bajista', color: 'text-red-300' }
  return { signal: 'Neutral', color: 'text-gray-400' }
}

// ---- Trading Signal Generator ------------------------------
export function generateSignal(candles: Candle[]): {
  type: 'BUY' | 'SELL' | 'HOLD'
  strength: number
  reasons: string[]
} {
  const minCandles = 50
  if (candles.length < minCandles) return { type: 'HOLD', strength: 50, reasons: ['Datos insuficientes para análisis (mínimo 50 velas)'] }

  const reasons: string[] = []
  let bullPoints = 0
  let bearPoints = 0

  const rsi = calculateRSI(candles)
  const macd = calculateMACD(candles)
  const bb = calculateBollingerBands(candles)
  const ma20 = calculateSMA(candles, 20)
  const ma50 = calculateSMA(candles, 50)

  const lastCandle = candles[candles.length - 1]
  const lastRSI = rsi[rsi.length - 1]?.value
  const lastMACD = macd[macd.length - 1]
  const lastBB = bb[bb.length - 1]
  const lastMA20 = ma20[ma20.length - 1]?.value
  const lastMA50 = ma50[ma50.length - 1]?.value

  reasons.push(`Análisis basado en ${candles.length} velas (1Y - largo plazo)`)

  // RSI analysis
  if (lastRSI !== undefined) {
    if (lastRSI < 35) { bullPoints += 2; reasons.push(`RSI sobrevendido (${lastRSI.toFixed(1)})`) }
    else if (lastRSI > 65) { bearPoints += 2; reasons.push(`RSI sobrecomprado (${lastRSI.toFixed(1)})`) }
  }

  // MACD crossover
  if (lastMACD) {
    if (lastMACD.histogram > 0 && macd[macd.length - 2]?.histogram <= 0) {
      bullPoints += 3; reasons.push('Cruce MACD alcista')
    } else if (lastMACD.histogram < 0 && macd[macd.length - 2]?.histogram >= 0) {
      bearPoints += 3; reasons.push('Cruce MACD bajista')
    } else if (lastMACD.macd > lastMACD.signal) {
      bullPoints += 1; reasons.push('MACD positivo')
    } else {
      bearPoints += 1; reasons.push('MACD negativo')
    }
  }

  // Bollinger Bands
  if (lastBB) {
    if (lastCandle.close <= lastBB.lower) { bullPoints += 2; reasons.push('Precio en banda inferior BB') }
    else if (lastCandle.close >= lastBB.upper) { bearPoints += 2; reasons.push('Precio en banda superior BB') }
  }

  // MA crossover
  if (lastMA20 && lastMA50) {
    if (lastMA20 > lastMA50) { bullPoints += 1; reasons.push('MA20 > MA50 (tendencia alcista)') }
    else { bearPoints += 1; reasons.push('MA20 < MA50 (tendencia bajista)') }
  }

  // Price vs MA20
  if (lastMA20) {
    if (lastCandle.close > lastMA20) { bullPoints += 1; reasons.push('Precio sobre MA20') }
    else { bearPoints += 1; reasons.push('Precio bajo MA20') }
  }

  const total = bullPoints + bearPoints
  const strength = total > 0 ? Math.round((Math.max(bullPoints, bearPoints) / total) * 100) : 50

  if (bullPoints > bearPoints + 2) return { type: 'BUY', strength, reasons }
  if (bearPoints > bullPoints + 2) return { type: 'SELL', strength, reasons }
  return { type: 'HOLD', strength: 50, reasons: reasons.slice(0, 3) }
}
