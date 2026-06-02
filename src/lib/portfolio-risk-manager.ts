export type PortfolioRiskStatus = 'OK' | 'WARNING' | 'BLOCKED'

export interface PortfolioRiskResult {
  symbol: string
  portfolio_risk_status: PortfolioRiskStatus
  action_allowed: boolean
  adjusted_action: 'BUY' | 'SELL' | 'HOLD'
  max_position_size: number
  suggested_position_size: number
  current_exposure_pct: number
  projected_exposure_pct: number
  concentration_risk: string
  liquidity_warning?: string | null
  drawdown_warning?: string | null
  correlation_warning?: string | null
  blocking_reasons: string[]
  warnings: string[]
  explanation: string
  raw_diagnostics: Record<string, unknown>
}
