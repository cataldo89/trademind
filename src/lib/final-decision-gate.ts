import { MarketDataQualityResult } from './market-data-quality'
import { SignalQualityResult } from './signal-quality'
import { RobustBacktestResult } from './robust-backtest'
import { PortfolioRiskResult } from './portfolio-risk-manager'
import { TradeExecutionGuardResult } from './trade-execution-guard'
import { SYMBOL_CATEGORY_MAP } from './market-data'

export type FinalDecisionAction =
  | 'BUY_CONFIRMED'
  | 'WATCHLIST'
  | 'HOLD'
  | 'AVOID'
  | 'BLOCKED_DATA'
  | 'BLOCKED_RISK'
  | 'BLOCKED_BACKTEST'
  | 'BLOCKED_EXECUTION'
  | 'ERROR'

export interface FinalDecisionGateResult {
  final_action: FinalDecisionAction
  decision_status: string
  decision_confidence: number
  decision_reason: string
  blocking_reasons: string[]
  supporting_factors: string[]
  contradicting_factors: string[]
  data_source: string
  data_timestamp: string
  is_actionable_now: boolean
  
  // Price reconciliation fields
  price_model_usd?: number | null
  price_display_clp?: number | null
  fx_usd_clp?: number | null
  price_source?: string | null
  price_timestamp?: string | null
  broker_symbol?: string | null
  model_symbol?: string | null
  market_data_symbol?: string | null
}

export function isCryptoSymbol(symbol: string): boolean {
  if (/-USD$/i.test(symbol)) return true
  const category = SYMBOL_CATEGORY_MAP[symbol.toUpperCase()]
  return category === 'crypto-mercado-pago' || category === 'zesty-alpaca-crypto'
}

export function evaluateFinalDecisionGate(input: {
  symbol: string
  market: 'US' | 'CL'
  isMarketOpen: boolean
  
  market_data_quality?: MarketDataQualityResult | null
  signal_quality?: SignalQualityResult | null
  robust_backtest?: RobustBacktestResult | null
  portfolio_risk?: PortfolioRiskResult | null
  trade_execution_guard?: any | null
  
  data_timestamp?: string | number | null
  data_source?: string | null
  
  // Price details
  price_model_usd?: number | null
  price_display_clp?: number | null
  fx_usd_clp?: number | null
  price_source?: string | null
  price_timestamp?: string | number | null
  broker_symbol?: string | null
  model_symbol?: string | null
  market_data_symbol?: string | null
}): FinalDecisionGateResult {
  const blocking_reasons: string[] = []
  const supporting_factors: string[] = []
  const contradicting_factors: string[] = []
  
  const symbolUpper = input.symbol.toUpperCase()
  const isCrypto = isCryptoSymbol(symbolUpper)
  
  // 1. Data Quality Checks
  const mdq = input.market_data_quality
  const mdqScore = mdq ? Number(mdq.quality_score ?? 0) : 0
  
  if (!mdq) {
    blocking_reasons.push('market_data_quality missing')
  } else {
    if (mdq.usable_for_ml !== true) {
      blocking_reasons.push('market_data_quality.usable_for_ml !== true')
    }
    if (mdqScore < 60) {
      blocking_reasons.push(`market_data_quality.quality_score=${mdqScore} < 60`)
    }
    if (isCrypto && mdq.provider && !/alpaca/i.test(mdq.provider)) {
      blocking_reasons.push(`crypto_market_provider_invalid: got ${mdq.provider}, mandatory Alpaca`)
    }
  }
  
  // 2. Data Freshness Policy
  let isStale = false
  const nowMs = Date.now()
  let dataTimeStr = ''
  
  if (input.data_timestamp) {
    const dataMs = typeof input.data_timestamp === 'number'
      ? input.data_timestamp * (input.data_timestamp < 10000000000 ? 1000 : 1)
      : Date.parse(input.data_timestamp)
      
    if (Number.isFinite(dataMs)) {
      dataTimeStr = new Date(dataMs).toISOString()
      const ageMinutes = (nowMs - dataMs) / (60 * 1000)
      
      if (isCrypto) {
        if (ageMinutes > 15) {
          isStale = true
          blocking_reasons.push(`stale_crypto_data: age is ${ageMinutes.toFixed(1)} mins (max 15 mins allowed)`)
        }
      } else {
        // Stocks
        if (input.isMarketOpen && ageMinutes > 30) {
          isStale = true
          blocking_reasons.push(`stale_stock_data: age is ${ageMinutes.toFixed(1)} mins during regular market hours`)
        }
      }
    } else {
      blocking_reasons.push('invalid_data_timestamp')
    }
  } else {
    blocking_reasons.push('missing_data_timestamp')
  }
  
  // 3. Price Reconciliation (USD vs CLP)
  let priceReconciliationWarning: string | undefined
  if (input.price_model_usd !== undefined && input.price_model_usd !== null) {
    const usdPrice = input.price_model_usd
    const fx = input.fx_usd_clp ?? 0
    const clpPrice = input.price_display_clp
    
    if (clpPrice !== undefined && clpPrice !== null && fx > 0) {
      const expectedClp = usdPrice * fx
      const diff = Math.abs(clpPrice - expectedClp)
      const diffPct = (diff / expectedClp) * 100
      
      if (diffPct > 2.0) {
        priceReconciliationWarning = `price_mismatch: USD model price converted to CLP ($${expectedClp.toFixed(2)}) differs from display price ($${clpPrice.toFixed(2)}) by ${diffPct.toFixed(2)}% (max 2% allowed)`
        blocking_reasons.push(priceReconciliationWarning)
      } else {
        supporting_factors.push(`price_reconciled: USD vs CLP difference is ${diffPct.toFixed(2)}%`)
      }
    }
  }

  // 4. Signal Quality Checks
  const sq = input.signal_quality
  if (!sq) {
    blocking_reasons.push('signal_quality missing')
  } else {
    if (sq.signal_status !== 'OK') {
      blocking_reasons.push(`signal_quality.signal_status=${sq.signal_status} !== OK`)
    }
    if (sq.final_action !== 'BUY') {
      blocking_reasons.push(`signal_quality.final_action=${sq.final_action} !== BUY`)
    }
    if (Number(sq.final_confidence ?? 0) < 70) {
      blocking_reasons.push(`signal_quality.final_confidence=${sq.final_confidence} < 70`)
    }
    if (Array.isArray(sq.supporting_factors)) {
      supporting_factors.push(...sq.supporting_factors)
    }
    if (Array.isArray(sq.contradicting_factors)) {
      contradicting_factors.push(...sq.contradicting_factors)
    }
  }
  
  // 5. Robust Backtest Checks
  const rb = input.robust_backtest
  if (!rb) {
    blocking_reasons.push('robust_backtest missing')
  } else {
    if (rb.usable_for_decision === false) {
      blocking_reasons.push('robust_backtest.usable_for_decision === false')
    }
    if (rb.backtest_status === 'BLOCKED' || rb.backtest_status === 'FAILED') {
      blocking_reasons.push(`robust_backtest.backtest_status=${rb.backtest_status}`)
    }
  }
  
  // 6. Portfolio Risk Checks
  const pr = input.portfolio_risk
  if (!pr) {
    blocking_reasons.push('portfolio_risk missing')
  } else {
    if (pr.action_allowed === false) {
      blocking_reasons.push('portfolio_risk.action_allowed === false')
    }
    if (pr.portfolio_risk_status === 'BLOCKED') {
      blocking_reasons.push('portfolio_risk.portfolio_risk_status === BLOCKED')
    }
  }
  
  // 7. Trade Execution Guard Checks
  const teg = input.trade_execution_guard
  if (teg) {
    const isBlocked = teg.execution_status === 'BLOCKED' || teg.action_allowed === false || (Array.isArray(teg.blocking_reasons) && teg.blocking_reasons.length > 0)
    if (isBlocked) {
      blocking_reasons.push('trade_execution_guard blocked')
    }
  }
  
  // Determine Final Action & Status
  let final_action: FinalDecisionAction = 'HOLD'
  let decision_status = 'HOLD'
  let decision_confidence = sq ? Number(sq.final_confidence ?? 0) : 0
  let decision_reason = ''
  
  const isMarketActionable = isCrypto || input.isMarketOpen
  
  // If there are blocking reasons, evaluate the nature of blockages to assign a specific blocked action
  if (blocking_reasons.length > 0) {
    decision_confidence = 0
    decision_status = 'BLOCKED'
    
    // Categorize main blockage to assign final_action
    const blockStr = blocking_reasons.join(' | ')
    if (priceReconciliationWarning || blockStr.includes('market_data_quality') || blockStr.includes('stale_') || blockStr.includes('crypto_market_provider_invalid') || blockStr.includes('timestamp')) {
      final_action = 'BLOCKED_DATA'
      decision_reason = priceReconciliationWarning || `Blocked due to data quality or freshness issues: ${blocking_reasons[0]}`
    } else if (blockStr.includes('robust_backtest')) {
      final_action = 'BLOCKED_BACKTEST'
      decision_reason = `Blocked due to backtest instability: ${blocking_reasons[0]}`
    } else if (blockStr.includes('portfolio_risk')) {
      final_action = 'BLOCKED_RISK'
      decision_reason = `Blocked due to portfolio risk limits: ${blocking_reasons[0]}`
    } else if (blockStr.includes('trade_execution_guard')) {
      final_action = 'BLOCKED_EXECUTION'
      decision_reason = `Blocked by execution guardrails: ${blocking_reasons[0]}`
    } else {
      // General signal blockages (e.g. signal status != OK)
      final_action = 'HOLD'
      decision_reason = `Hold: signal conditions not met. Details: ${blocking_reasons[0]}`
    }
  } else {
    // No blocking reasons!
    if (!isMarketActionable) {
      final_action = 'WATCHLIST'
      decision_status = 'OBSERVATION'
      decision_reason = 'Sólo observar: el mercado tradicional de EE.UU. está cerrado. El activo pasa la auditoría pero se mantiene en seguimiento.'
    } else {
      final_action = 'BUY_CONFIRMED'
      decision_status = 'OK'
      decision_reason = 'Compra confirmada: el activo superó con éxito la auditoría completa de datos, señal, backtest, riesgo y ejecución.'
    }
  }
  
  // Overwrites for general AVOID/SELL signals
  if (sq && sq.final_action === 'SELL') {
    final_action = 'AVOID'
    decision_status = 'AVOID'
    decision_reason = 'Evitar: señal de venta/evitación activa por análisis quant/técnico.'
  }
  
  return {
    final_action,
    decision_status,
    decision_confidence,
    decision_reason,
    blocking_reasons,
    supporting_factors,
    contradicting_factors,
    data_source: input.data_source || mdq?.provider || 'unknown',
    data_timestamp: dataTimeStr,
    is_actionable_now: isMarketActionable && final_action === 'BUY_CONFIRMED',
    
    price_model_usd: input.price_model_usd,
    price_display_clp: input.price_display_clp,
    fx_usd_clp: input.fx_usd_clp,
    price_source: input.price_source,
    price_timestamp: input.price_timestamp ? new Date(input.price_timestamp).toISOString() : null,
    broker_symbol: input.broker_symbol,
    model_symbol: input.model_symbol,
    market_data_symbol: input.market_data_symbol,
  }
}
