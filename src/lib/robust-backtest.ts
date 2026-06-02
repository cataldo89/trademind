export type BacktestStatus = 'OK' | 'WEAK' | 'FAILED' | 'BLOCKED'

export interface RobustBacktestResult {
  symbol: string
  backtest_status: BacktestStatus
  usable_for_decision: boolean
  total_return: number
  annualized_return: number
  volatility: number
  max_drawdown: number
  sharpe_ratio: number
  win_rate: number
  trades_count: number
  exposure_time: number
  benchmark_return: number
  warnings: string[]
  blocking_reasons: string[]
  explanation: string
  raw_diagnostics: Record<string, unknown>
}

export function isBacktestBlockingOpportunity(backtest?: RobustBacktestResult) {
  return backtest?.backtest_status === 'BLOCKED' || backtest?.backtest_status === 'FAILED'
}
