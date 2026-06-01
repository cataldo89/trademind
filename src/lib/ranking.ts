import { Candle } from '@/types'
import { calculateRSI, calculateMACD, calculateSMA, interpretRSI } from './indicators'
import type { MarketDataQualityResult } from './market-data-quality'

export interface PreliminaryTechData {
  symbol: string
  name: string
  market: string
  price: number | null
  changePercent: number | null
  volume: number | null
  rsi: number | null
  rsiSignal: string
  macdSignal: string
  priceVsMA20: 'above' | 'below' | null
  priceVsMA50: 'above' | 'below' | null
  noData: boolean
  isLeveragedOrInverse: boolean
  suggestions: { type: string, label: string }[]
  score: number // Preliminary score
  marketDataQuality?: MarketDataQualityResult
}

export interface QuantResultData {
  action?: 'BUY' | 'SELL' | 'HOLD' | string
  label?: string
  confidence?: number
  market_regime?: string
  var_95?: number
  ml_prediction?: number
  graham_passed?: boolean
  error_reason?: string
  xai_explanation?: string
  engine_status?: 'ok' | 'partial' | 'failed' | 'skipped'
  data_quality?: 'complete' | 'partial' | 'insufficient'
  engine_reason?: string
  quant_symbol?: string
  data_status?: string
  market_data_quality?: MarketDataQualityResult
  weekend_sentiment?: { sentiment: string; score: number }
  news_sentiment?: string
  news_articles?: string[]
}

export interface FinalQuantScore extends PreliminaryTechData {
  quant?: QuantResultData
  isFallback: boolean
  finalScore: number
  marketDataQuality?: MarketDataQualityResult
}

function isLeveragedOrInverse(name: string, category: string): boolean {
  const nameUpper = name.toUpperCase()
  if (category === 'etf-apalancados' || category === 'etf-inversos') return true
  if (nameUpper.includes('2X') || nameUpper.includes('3X') || nameUpper.includes('DOUBLE') || nameUpper.includes('TRIPLE')) return true
  if (nameUpper.includes('SHORT') || nameUpper.includes('BEAR') || nameUpper.includes('INVERSE')) return true
  return false
}

export function calculatePreliminaryScore(
  symbol: string,
  name: string,
  market: string,
  category: string,
  candles: Candle[],
  quote: { price: number | null; changePercent: number | null; volume: number | null }
): PreliminaryTechData {
  let rsi = null
  let rsiSignal = 'Sin datos'
  let macdSignal = 'Sin datos'
  let priceVsMA20: 'above' | 'below' | null = null
  let priceVsMA50: 'above' | 'below' | null = null
  let noData = false
  const suggestions: { type: string, label: string }[] = []
  
  const price = quote.price
  let score = 50 // Base score

  if (!candles || candles.length < 10) {
    noData = true
    score -= 30 // Heavy penalty for incomplete data
  } else {
    const rsiCalc = calculateRSI(candles, 14)
    const macdCalc = calculateMACD(candles)
    const ma20Calc = calculateSMA(candles, 20)
    const ma50Calc = calculateSMA(candles, 50)

    rsi = rsiCalc[rsiCalc.length - 1]?.value ?? null
    const lastMACD = macdCalc[macdCalc.length - 1]
    const prevMACD = macdCalc[macdCalc.length - 2]
    const ma20 = ma20Calc[ma20Calc.length - 1]?.value ?? null
    const ma50 = ma50Calc[ma50Calc.length - 1]?.value ?? null

    if (rsi !== null) {
      rsiSignal = interpretRSI(rsi).signal
      if (rsi < 30) { score += 15; suggestions.push({ type: 'opportunity', label: 'Sobreventa' }) }
      else if (rsi > 70) { score -= 15; suggestions.push({ type: 'warning', label: 'Sobrecompra' }) }
      else if (rsi > 50) score += 5
      else score -= 5
    }

    if (lastMACD && prevMACD) {
      if (lastMACD.histogram > 0 && prevMACD.histogram <= 0) {
        macdSignal = 'Cruce alcista'; score += 20; suggestions.push({ type: 'opportunity', label: 'Cruce MACD alcista' })
      } else if (lastMACD.histogram < 0 && prevMACD.histogram >= 0) {
        macdSignal = 'Cruce bajista'; score -= 20; suggestions.push({ type: 'warning', label: 'Cruce MACD bajista' })
      } else if (lastMACD.histogram > 0) {
        macdSignal = 'Positivo'; score += 5
      } else {
        macdSignal = 'Negativo'; score -= 5
      }
    }

    if (price !== null && ma20 !== null) {
      priceVsMA20 = price > ma20 ? 'above' : 'below'
      if (priceVsMA20 === 'above') score += 10
      else score -= 10
    }
    if (price !== null && ma50 !== null) {
      priceVsMA50 = price > ma50 ? 'above' : 'below'
    }

    if (priceVsMA50 === 'above' && priceVsMA20 === 'below') {
      score += 15; suggestions.push({ type: 'opportunity', label: 'Cruce MA20→MA50' })
    } else if (priceVsMA50 === 'below' && priceVsMA20 === 'above') {
      score -= 15; suggestions.push({ type: 'warning', label: 'Ruptura MA50' })
    }
  }

  // Momentum (Absolute change)
  if (quote.changePercent !== null) {
    if (quote.changePercent > 5) { score += 10; suggestions.push({ type: 'neutral', label: 'Subida fuerte' }) }
    if (quote.changePercent < -5) { score -= 10; suggestions.push({ type: 'warning', label: 'Caída fuerte' }) }
  }

  // Penalty for inverse / leveraged
  const leveraged = isLeveragedOrInverse(name, category)
  if (leveraged) {
    score -= 10 // Risk penalty
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score))

  return {
    symbol,
    name,
    market,
    price,
    changePercent: quote.changePercent,
    volume: quote.volume,
    rsi,
    rsiSignal,
    macdSignal,
    priceVsMA20,
    priceVsMA50,
    noData,
    isLeveragedOrInverse: leveraged,
    suggestions,
    score
  }
}

export function calculateFinalQuantScore(
  preliminary: PreliminaryTechData,
  quantData: QuantResultData | null,
  isFallback: boolean
): FinalQuantScore {
  let finalScore = preliminary.score

  if (isFallback || !quantData) {
    finalScore -= 10 // Penalty for fallback
  } else {
    // Incorporate Python results
    const action = quantData.action
    const conf = quantData.confidence ?? 0
    const graham = quantData.graham_passed
    const regime = quantData.market_regime
    const ml = quantData.ml_prediction

    if (action === 'BUY') {
      finalScore += (conf * 0.3) // Max +30
    } else if (action === 'SELL') {
      finalScore -= (conf * 0.3) // Max -30
    }

    const regimeText = String(regime || '').toLowerCase()
    const isUnknownRegime = !regime || regimeText === 'unknown' || regimeText.includes('desconocido')
    const isBearRegime = regimeText.includes('bear')
    const isBullRegime = regimeText.includes('bull')

    if (graham) finalScore += 5
    if (isBullRegime) finalScore += 5
    if (isBearRegime) finalScore -= 12
    if (isUnknownRegime) finalScore -= 20

    if (ml && ml > 0.6) finalScore += 10
    if (ml && ml < 0.4) finalScore -= 10
    
    // Fallback penalty if confidence is 0 and no data
    if (conf === 0 && action === 'HOLD') {
        finalScore -= 20
    }
  }

  // Penalty for no data
  if (preliminary.noData) {
    finalScore = Math.min(finalScore, 20) // Cap the score really low if no data
  }

  // Clamp 0-100
  finalScore = Math.max(0, Math.min(100, finalScore))

  return {
    ...preliminary,
    quant: quantData || undefined,
    isFallback,
    finalScore
  }
}

export function rankScreenerResults(results: FinalQuantScore[]): FinalQuantScore[] {
  return results.sort((a, b) => {
    // 1. Principal: finalScore
    if (b.finalScore !== a.finalScore) {
      return b.finalScore - a.finalScore
    }
    // 2. Desempate: Momentum diario (changePercent)
    const changeA = a.changePercent || 0
    const changeB = b.changePercent || 0
    if (changeB !== changeA) {
      return changeB - changeA
    }
    // 3. Desempate: Volumen
    const volA = a.volume || 0
    const volB = b.volume || 0
    return volB - volA
  })
}
