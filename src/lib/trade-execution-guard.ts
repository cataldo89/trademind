export type TradeExecutionStatus = 'ALLOWED' | 'BLOCKED' | 'REQUIRES_CONFIRMATION'

export type TradeExecutionGuardResult = {
  execution_status: TradeExecutionStatus
  action_to_execute: 'BUY' | 'SELL' | 'NONE'
  approved_amount: number
  approved_quantity: number
  max_allowed_amount: number
  price_used: number
  guardrails_passed: string[]
  blocking_reasons: string[]
  warnings: string[]
  confirmation_required: boolean
  explanation: string
  raw_diagnostics: Record<string, unknown>
}
