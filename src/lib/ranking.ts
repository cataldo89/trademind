import { Candle } from '@/types'
import { calculateRSI, calculateMACD, calculateSMA, interpretRSI } from './indicators'
import type { MarketDataQualityResult } from './market-data-quality'
import type { PortfolioRiskResult } from './portfolio-risk-manager'
import type { RobustBacktestResult } from './robust-backtest'
import { assessSignalQuality, type SignalQualityResult } from './signal-quality'
import type { CryptoMlDecision } from './crypto-ml-policy'
import type { FinalDecisionGateResult } from './final-decision-gate'

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
  priceVsMA100: 'above' | 'below' | null
  noData: boolean
  recentIpoFallback?: boolean
  indicatorMode?: 'full' | 'recent_ipo_short_history'
  historyCandles?: number
  isLeveragedOrInverse: boolean
  suggestions: { type: string, label: string }[]
  score: number // Preliminary score
  marketDataQuality?: MarketDataQualityResult
  providerFallback?: Record<string, unknown>
}

export interface QuantResultData {
  action?: 'BUY' | 'SELL' | 'HOLD' | string
  label?: string
  confidence?: number
  market_regime?: string
  var_95?: number
  ml_prediction?: number
  graham_passed?: boolean
  graham_reason?: string
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
  signal_quality?: SignalQualityResult
  robust_backtest?: RobustBacktestResult
  portfolio_risk?: PortfolioRiskResult
  crypto_ml_decision?: CryptoMlDecision
  trade_execution_guard?: unknown
  model_status?: string
}

export interface FinalQuantScore extends PreliminaryTechData {
  quant?: QuantResultData
  isFallback: boolean
  finalScore: number
  ranking_score: number
  decision_score: number
  display_score: number
  decisionGate?: FinalDecisionGateResult
  marketDataQuality?: MarketDataQualityResult
  signalQuality?: SignalQualityResult
  robustBacktest?: RobustBacktestResult
  portfolioRisk?: PortfolioRiskResult
  cryptoMlDecision?: CryptoMlDecision
}


function isMarketDataQualityBlocked(preliminary: PreliminaryTechData): boolean {
  const quality = preliminary.marketDataQuality
  if (preliminary.recentIpoFallback) return preliminary.noData || quality?.status === 'FAILED'
  return preliminary.noData || quality?.status === 'FAILED' || quality?.usable_for_ml === false
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
  let priceVsMA100: 'above' | 'below' | null = null
  let noData = false
  let recentIpoFallback = false
  let indicatorMode: 'full' | 'recent_ipo_short_history' = 'full'
  const suggestions: { type: string, label: string }[] = []
  
  const price = quote.price
  let score = 50 // Base score
  const historyCandles = candles?.length || 0
  const hasUsableQuote = price !== null && Number.isFinite(price) && price > 0
  const hasImmediateChange = quote.changePercent !== null && Number.isFinite(quote.changePercent)

  if ((!candles || candles.length < 10) && !hasUsableQuote) {
    noData = true
    score -= 30 // Heavy penalty for incomplete data
  } else {
    recentIpoFallback = historyCandles < 50 && hasUsableQuote
    if (recentIpoFallback) {
      indicatorMode = 'recent_ipo_short_history'
      rsiSignal = historyCandles >= 15 ? 'Historia corta' : 'Desactivado (<15 velas)'
      macdSignal = 'Desactivado (<50 velas)'
      suggestions.push({ type: 'neutral', label: 'IPO reciente: MA50/MACD desactivados' })

      const latest = candles?.[candles.length - 1]
      const previous = candles?.[candles.length - 2]
      const immediateChange = hasImmediateChange
        ? Number(quote.changePercent)
        : latest && previous && previous.close > 0
          ? ((latest.close - previous.close) / previous.close) * 100
          : 0
      const effectiveVolume = Number(quote.volume ?? latest?.volume ?? 0)

      score += Math.max(-25, Math.min(25, immediateChange * 1.25))
      if (effectiveVolume > 0) score += Math.min(12, Math.log10(effectiveVolume))
      if (immediateChange > 2) suggestions.push({ type: 'opportunity', label: 'Momentum inmediato positivo' })
      if (immediateChange < -2) suggestions.push({ type: 'warning', label: 'Momentum inmediato negativo' })
      if (effectiveVolume > 100000) suggestions.push({ type: 'opportunity', label: 'Volumen del dia valido' })
    }

    const rsiCalc = calculateRSI(candles, 14)
    const macdCalc = recentIpoFallback ? [] : calculateMACD(candles)
    const ma20Calc = calculateSMA(candles, 20)
    const ma50Calc = recentIpoFallback ? [] : calculateSMA(candles, 50)
    const ma100Calc = (recentIpoFallback || historyCandles < 100) ? [] : calculateSMA(candles, 100)

    rsi = rsiCalc[rsiCalc.length - 1]?.value ?? null
    const lastMACD = macdCalc[macdCalc.length - 1]
    const prevMACD = macdCalc[macdCalc.length - 2]
    const ma20 = ma20Calc[ma20Calc.length - 1]?.value ?? null
    const ma50 = ma50Calc[ma50Calc.length - 1]?.value ?? null
    const ma100 = ma100Calc[ma100Calc.length - 1]?.value ?? null

    if (rsi !== null) {
      rsiSignal = interpretRSI(rsi).signal
      if (rsi < 30) { score += 15; suggestions.push({ type: 'opportunity', label: 'Sobreventa' }) }
      else if (rsi > 70) { score -= 15; suggestions.push({ type: 'warning', label: 'Sobrecompra' }) }
      else if (rsi > 50) score += 5
      else score -= 5
    }

    if (!recentIpoFallback && lastMACD && prevMACD) {
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
    if (price !== null && ma100 !== null) {
      priceVsMA100 = price > ma100 ? 'above' : 'below'
      if (priceVsMA100 === 'above') score += 5
      else score -= 5
    }

    if (!recentIpoFallback && priceVsMA50 === 'above' && priceVsMA20 === 'below') {
      score += 15; suggestions.push({ type: 'opportunity', label: 'Cruce MA20→MA50' })
    } else if (!recentIpoFallback && priceVsMA50 === 'below' && priceVsMA20 === 'above') {
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
    priceVsMA100,
    noData,
    recentIpoFallback,
    indicatorMode,
    historyCandles,
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
  if (preliminary.marketDataQuality?.status === 'FAILED' || preliminary.noData) {
    const blockedSignal = assessSignalQuality({
      symbol: preliminary.symbol,
      market: preliminary.market,
      selected_provider: preliminary.marketDataQuality?.provider,
      market_data_quality: preliminary.marketDataQuality,
      workflow_action: quantData?.action || 'HOLD',
      workflow_confidence: Number(quantData?.confidence ?? 0),
      sentiment_result: { sentiment: quantData?.weekend_sentiment?.sentiment || quantData?.news_sentiment },
      allow_recent_ipo_fallback: preliminary.recentIpoFallback === true,
    })
    return {
      ...preliminary,
      quant: quantData ? { ...quantData, signal_quality: blockedSignal } : undefined,
      isFallback,
      finalScore: 0,
      ranking_score: 0,
      decision_score: 0,
      display_score: 0,
      signalQuality: blockedSignal,
      cryptoMlDecision: quantData?.crypto_ml_decision,
    }
  }

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
    finalScore = 0
  } else if (preliminary.marketDataQuality?.usable_for_ml === false && !preliminary.recentIpoFallback) {
    finalScore = Math.min(finalScore, 20)
  }

  const signalQuality = assessSignalQuality({
    symbol: preliminary.symbol,
    market: preliminary.market,
    selected_provider: preliminary.marketDataQuality?.provider,
    market_data_quality: preliminary.marketDataQuality,
    technical_indicators: {
      rsi: preliminary.rsi,
      macd_signal: preliminary.macdSignal,
      price_vs_ma20: preliminary.priceVsMA20,
      price_vs_ma50: preliminary.priceVsMA50,
      price_vs_ma100: preliminary.priceVsMA100,
    },
    ml_prediction: quantData?.ml_prediction,
    risk_metrics: { var_95: quantData?.var_95 },
    graham_result: { passed: quantData?.graham_passed, reason: quantData?.graham_reason },
    sentiment_result: { sentiment: quantData?.weekend_sentiment?.sentiment || quantData?.news_sentiment },
    workflow_action: quantData?.action || 'HOLD',
    workflow_confidence: Number(quantData?.confidence ?? 0),
    reasons: [
      preliminary.recentIpoFallback ? 'recent_ipo_fallback' : null,
      quantData?.engine_reason,
      quantData?.xai_explanation,
    ].filter(Boolean) as string[],
    allow_recent_ipo_fallback: preliminary.recentIpoFallback === true,
  })

  const robustBacktest = quantData?.robust_backtest
  const portfolioRisk = quantData?.portfolio_risk
  if (signalQuality.signal_status === 'BLOCKED') finalScore = 0
  else if (signalQuality.signal_status === 'CONFLICTED') finalScore = Math.min(finalScore, 49)
  else if (signalQuality.signal_status === 'WEAK') finalScore = Math.min(finalScore, 69)
  else finalScore = Math.min(finalScore, signalQuality.signal_score)

  if (robustBacktest && !robustBacktest.usable_for_decision) finalScore = Math.min(finalScore, 49)
  if (robustBacktest?.backtest_status === 'BLOCKED' || robustBacktest?.backtest_status === 'FAILED') finalScore = 0
  else if (robustBacktest?.backtest_status === 'WEAK') finalScore = Math.min(finalScore, 60)
  if (portfolioRisk?.portfolio_risk_status === 'BLOCKED' || portfolioRisk?.action_allowed === false) finalScore = 0
  else if (portfolioRisk?.portfolio_risk_status === 'WARNING') finalScore = Math.min(finalScore, 60)

  const cryptoMlDecision = quantData?.crypto_ml_decision
  if (cryptoMlDecision?.isCrypto) {
    finalScore -= cryptoMlDecision.scorePenalty
    finalScore = Math.min(finalScore, cryptoMlDecision.confidenceCap)
    if (cryptoMlDecision.isStablecoin) {
      finalScore = Math.min(finalScore, 45)
    }
  }

  // Clamp 0-100
  finalScore = Math.max(0, Math.min(100, finalScore))

  const ranking_score = finalScore
  const decision_score = signalQuality ? Number(signalQuality.final_confidence ?? 0) : finalScore
  const display_score = decision_score
  return {
    ...preliminary,
    quant: quantData ? { ...quantData, signal_quality: signalQuality } : undefined,
    isFallback,
    finalScore,
    ranking_score,
    decision_score,
    display_score,
    signalQuality,
    robustBacktest,
    portfolioRisk,
    cryptoMlDecision,
  }
}

export function rankScreenerResults(results: FinalQuantScore[]): FinalQuantScore[] {
  return results.sort((a, b) => {
    const blockedA = isMarketDataQualityBlocked(a)
    const blockedB = isMarketDataQualityBlocked(b)
    if (blockedA !== blockedB) {
      return blockedA ? 1 : -1
    }

    // 1. Principal: ranking_score (or finalScore)
    const scoreA = a.ranking_score ?? a.finalScore
    const scoreB = b.ranking_score ?? b.finalScore
    if (scoreB !== scoreA) {
      return scoreB - scoreA
    }
    
    // 2. Desempate: Momentum diario (changePercent), pero solo si no está sobreextendido y tiene validación de riesgo
    const isOverextendedA = (a.changePercent || 0) > 6 || (a.rsi || 50) > 70 || a.portfolioRisk?.portfolio_risk_status === 'BLOCKED'
    const isOverextendedB = (b.changePercent || 0) > 6 || (b.rsi || 50) > 70 || b.portfolioRisk?.portfolio_risk_status === 'BLOCKED'
    
    if (!isOverextendedA && !isOverextendedB) {
      const changeA = a.changePercent || 0
      const changeB = b.changePercent || 0
      if (changeB !== changeA) {
        return changeB - changeA
      }
    }
    
    // 3. Desempate: Volumen
    const volA = a.volume || 0
    const volB = b.volume || 0
    return volB - volA
  })
}
