import type { MarketDataQualityResult } from './market-data-quality'

export type SignalStatus = 'OK' | 'WEAK' | 'CONFLICTED' | 'BLOCKED'
export type FinalAction = 'BUY' | 'SELL' | 'HOLD'
export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export interface SignalQualityResult {
  symbol: string
  signal_status: SignalStatus
  final_action: FinalAction
  final_confidence: number
  confidence_level: ConfidenceLevel
  signal_score: number
  supporting_factors: string[]
  contradicting_factors: string[]
  blocking_reasons: string[]
  warnings: string[]
  explanation: string
  raw_diagnostics: Record<string, unknown>
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 70) return 'HIGH'
  if (confidence >= 50) return 'MEDIUM'
  return 'LOW'
}

export function assessSignalQuality(input: {
  symbol: string
  market: string
  selected_provider?: string | null
  market_data_quality?: MarketDataQualityResult
  technical_indicators?: Record<string, unknown>
  ml_prediction?: unknown
  risk_metrics?: Record<string, unknown>
  graham_result?: Record<string, unknown>
  sentiment_result?: Record<string, unknown>
  workflow_action?: string
  workflow_confidence?: number
  reasons?: string[]
}): SignalQualityResult {
  const quality = input.market_data_quality
  const technical = input.technical_indicators ?? {}
  const risk = input.risk_metrics ?? {}
  const graham = input.graham_result ?? {}
  const sentiment = input.sentiment_result ?? {}
  const supporting: string[] = []
  const contradicting: string[] = []
  const blocking: string[] = []
  const warnings: string[] = []

  const qualityScore = Number(quality?.quality_score ?? 0)
  if (!quality?.usable_for_ml) blocking.push('market_data_quality.usable_for_ml=false')
  if (qualityScore < 60) blocking.push(`market_data_quality.quality_score=${qualityScore} < 60`)
  if (quality?.usable_for_chart && !quality?.usable_for_ml) warnings.push('Datos aptos solo para grafico; BUY/SELL prohibido.')

  const action = String(input.workflow_action || 'HOLD').toUpperCase()
  const confidence = clamp(Number(input.workflow_confidence ?? 0))
  let score = confidence
  const mlValue = Number(typeof input.ml_prediction === 'object' && input.ml_prediction !== null
    ? (input.ml_prediction as Record<string, unknown>).expected_return
    : input.ml_prediction) || 0
  const var95 = Number(risk.var_95 ?? risk.var_1d_95 ?? risk.var ?? 0) || 0
  const highRisk = var95 >= 0.05 || risk.high_risk === true
  const grahamPassed = graham.passed ?? graham.graham_passed
  const sentimentLabel = String(sentiment.sentiment ?? sentiment.label ?? 'NEUTRAL').toUpperCase()

  if (mlValue > 0.01) { supporting.push('ML positivo'); score += 10 }
  if (mlValue < -0.01) { contradicting.push('ML negativo'); score -= 10 }
  if (highRisk) { contradicting.push(`Riesgo alto VaR=${var95}`); score -= 25 }
  else if (var95 > 0) { supporting.push(`Riesgo controlado VaR=${var95}`); score += 5 }
  if (grahamPassed === false) { contradicting.push('Graham negativo'); score -= 15 }
  if (grahamPassed === true) { supporting.push('Graham positivo'); score += 5 }

  if (sentimentLabel === 'POSITIVE') {
    if (blocking.length) blocking.push('FinBERT positivo ignorado por mala calidad de datos')
    else if (mlValue <= 0 && action !== 'BUY') warnings.push('FinBERT positivo no confirma tecnico/ML; no infla la senal.')
    else { supporting.push('FinBERT positivo'); score += 5 }
  }
  if (sentimentLabel === 'NEGATIVE') { contradicting.push('FinBERT negativo'); score -= 10 }

  if (technical.macd_signal === 'Cruce alcista' || technical.macd_signal === 'Positivo') supporting.push('Tecnico alcista')
  if (technical.macd_signal === 'Cruce bajista') contradicting.push('Tecnico bajista')
  if (action === 'BUY' && highRisk) contradicting.push('Workflow BUY contradicho por riesgo alto')
  if (action === 'BUY' && grahamPassed === false) contradicting.push('Workflow BUY contradicho por Graham negativo')

  let final_action: FinalAction = 'HOLD'
  let final_confidence = 0
  let signal_status: SignalStatus = 'WEAK'

  if (blocking.length) {
    signal_status = 'BLOCKED'
    score = 0
  } else {
    score = clamp(score)
    if (action === 'BUY' && (highRisk || grahamPassed === false || contradicting.length >= 2)) {
      signal_status = 'CONFLICTED'
      final_confidence = Math.min(confidence, 49)
    } else if ((action === 'BUY' || action === 'SELL') && confidence >= 70 && supporting.length) {
      final_action = action as FinalAction
      final_confidence = clamp(score)
      signal_status = 'OK'
    } else if ((action === 'BUY' || action === 'SELL') && confidence >= 50) {
      final_action = contradicting.length ? 'HOLD' : action as FinalAction
      final_confidence = Math.min(clamp(score), 69)
      signal_status = contradicting.length ? 'CONFLICTED' : 'WEAK'
    } else {
      final_confidence = Math.min(clamp(score), 49)
    }
  }

  if (!supporting.length && !blocking.length) warnings.push('Sin factores de soporte suficientes para oportunidad.')
  if (signal_status === 'BLOCKED') final_confidence = 0

  return {
    symbol: input.symbol,
    signal_status,
    final_action,
    final_confidence,
    confidence_level: confidenceLevel(final_confidence),
    signal_score: clamp(score),
    supporting_factors: supporting,
    contradicting_factors: contradicting,
    blocking_reasons: blocking,
    warnings,
    explanation: `${signal_status}: accion final ${final_action} con confianza ${final_confidence}. Soporte=${supporting.length}, contradicciones=${contradicting.length}, bloqueos=${blocking.length}.`,
    raw_diagnostics: {
      market: input.market,
      selected_provider: input.selected_provider,
      workflow_action: action,
      workflow_confidence: confidence,
      quality_score: qualityScore,
      usable_for_ml: quality?.usable_for_ml === true,
      ml_prediction: mlValue,
      var_95: var95,
      sentiment: sentimentLabel,
      reasons: input.reasons ?? [],
    },
  }
}
