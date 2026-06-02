import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedContext, type AuthenticatedContext } from '@/lib/api/auth'
import { getAuthMetadataVirtualBalance, saveAuthMetadataVirtualBalance } from '@/lib/api/virtual-balance'
import { normalizeSymbol, parseMarketOrLegacy } from '@/lib/domain/market'
import { quantClient } from '@/lib/ai/quant-client'
import type { TradeExecutionGuardResult } from '@/lib/trade-execution-guard'

type TradePayload = {
  side?: string
  symbol?: string
  name?: string
  market?: string
  amount?: number
  quantity?: number
  price?: number
  source?: string
  signalId?: string | null
  notes?: string
  idempotencyKey?: string
  idempotency_key?: string
  confirmationAccepted?: boolean
}

type TradeOrder = {
  symbol: string
  name: string
  market: 'US' | 'CL'
  side: 'BUY'
  amount: number | null
  quantity: number | null
  price: number
  source: string
  signalId: string | null
  notes: string | null
  idempotencyKey: string | null
  confirmationAccepted: boolean
}

type PortfolioPositionForGuard = {
  id?: string
  symbol?: string
  market?: string
  quantity?: number
  entry_price?: number
  current_price?: number
  market_value?: number
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function roundQuantity(value: number) {
  return Math.round(value * 100_000_000) / 100_000_000
}

function tradeErrorResponse(message: string) {
  if (/TRADE_GUARD_BLOCKED/i.test(message)) {
    return NextResponse.json({ ok: false, error: { code: 'TRADE_GUARD_BLOCKED', message: 'Operacion virtual bloqueada por guardrails.' } }, { status: 423 })
  }

  if (/TRADE_CONFIRMATION_REQUIRED/i.test(message)) {
    return NextResponse.json({ ok: false, error: { code: 'TRADE_CONFIRMATION_REQUIRED', message: 'La operacion virtual requiere confirmacion.' } }, { status: 409 })
  }

  if (/INSUFFICIENT_BALANCE/i.test(message)) {
    return NextResponse.json({ ok: false, error: { code: 'INSUFFICIENT_BALANCE', message: 'Saldo virtual insuficiente.' } }, { status: 409 })
  }

  if (/SIGNAL_NOT_ACTIVE/i.test(message)) {
    return NextResponse.json({ ok: false, error: { code: 'SIGNAL_NOT_ACTIVE', message: 'La senal ya no esta activa.' } }, { status: 409 })
  }

  return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'No se pudo ejecutar la orden virtual.' } }, { status: 500 })
}

function guardErrorResponse(guard: TradeExecutionGuardResult) {
  const code = guard.execution_status === 'REQUIRES_CONFIRMATION'
    ? 'TRADE_CONFIRMATION_REQUIRED'
    : 'TRADE_GUARD_BLOCKED'
  const status = guard.execution_status === 'REQUIRES_CONFIRMATION' ? 409 : 423

  return NextResponse.json({
    ok: false,
    error: {
      code,
      message: guard.explanation,
      guard,
    },
  }, { status })
}

function toGuardPosition(position: Record<string, unknown>): PortfolioPositionForGuard {
  const quantity = Number(position.quantity ?? 0)
  const entryPrice = Number(position.entry_price ?? 0)
  return {
    id: typeof position.id === 'string' ? position.id : undefined,
    symbol: typeof position.symbol === 'string' ? position.symbol : undefined,
    market: typeof position.market === 'string' ? position.market : undefined,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    entry_price: Number.isFinite(entryPrice) ? entryPrice : 0,
    current_price: Number.isFinite(entryPrice) ? entryPrice : 0,
    market_value: Number.isFinite(quantity * entryPrice) ? quantity * entryPrice : 0,
  }
}

async function buildExecutionGuard(
  dbClient: AuthenticatedContext['dbClient'],
  user: NonNullable<AuthenticatedContext['user']>,
  order: TradeOrder
) {
  const virtualBalance = await getAuthMetadataVirtualBalance(user)
  const { data: rawPositions } = await dbClient
    .from('positions')
    .select('id,symbol,market,quantity,entry_price,status')
    .eq('user_id', user.id)
    .eq('status', 'open')

  const portfolioPositions = ((rawPositions || []) as Record<string, unknown>[]).map(toGuardPosition)
  const currentPosition = portfolioPositions.find((position) => String(position.symbol || '').toUpperCase() === order.symbol)
  const positionsValue = portfolioPositions.reduce((sum, position) => sum + Number(position.market_value || 0), 0)
  const accountEquity = virtualBalance + positionsValue

  const provider = await quantClient.resolveProviderFallback({
    symbol: order.symbol,
    market: order.market,
    timeframe: '1d',
    range: '2y',
    required_use: 'ml',
  })

  if (!provider.success || !provider.data) {
    return {
      execution_status: 'BLOCKED',
      action_to_execute: 'NONE',
      approved_amount: 0,
      approved_quantity: 0,
      max_allowed_amount: 0,
      price_used: order.price,
      guardrails_passed: [],
      blocking_reasons: ['provider_fallback unavailable before virtual execution'],
      warnings: provider.error ? [provider.error] : [],
      confirmation_required: false,
      explanation: 'Operacion virtual bloqueada: no se pudo auditar calidad de datos antes de ejecutar.',
      raw_diagnostics: { symbol: order.symbol, provider_status: provider.status },
    } satisfies TradeExecutionGuardResult
  }

  const marketDataQuality = provider.data.selected_quality || {}
  const selectedProvider = provider.data.selected_provider
  let signalQuality: Record<string, unknown> = {
    signal_status: 'WEAK',
    final_action: 'HOLD',
    final_confidence: 0,
    confidence_level: 'LOW',
  }

  if (order.signalId) {
    const { data: signalData } = await dbClient
      .from('signals')
      .select('id,type,strength,status')
      .eq('id', order.signalId)
      .eq('user_id', user.id)
      .maybeSingle()

    const type = String(signalData?.type || '').toUpperCase()
    const strength = Number(signalData?.strength || 0)
    if (signalData?.status === 'active' && type === 'BUY') {
      signalQuality = {
        signal_status: strength >= 70 ? 'OK' : 'WEAK',
        final_action: 'BUY',
        final_confidence: strength,
        confidence_level: strength >= 70 ? 'HIGH' : 'MEDIUM',
      }
    }
  }

  const robustBacktest: Record<string, unknown> = {
    backtest_status: 'WEAK',
    usable_for_decision: false,
  }

  const portfolioRiskResponse = await quantClient.evaluatePortfolioRisk({
    user_id: user.id,
    symbol: order.symbol,
    market: order.market,
    final_action: order.side,
    signal_quality: signalQuality,
    robust_backtest: robustBacktest,
    current_price: order.price,
    portfolio_positions: portfolioPositions,
    cash_balance: virtualBalance,
    account_equity: accountEquity,
    risk_profile: 'balanced',
  })

  const portfolioRisk = (portfolioRiskResponse.success && portfolioRiskResponse.data)
    ? portfolioRiskResponse.data as Record<string, unknown>
    : {
        portfolio_risk_status: 'BLOCKED',
        action_allowed: false,
        blocking_reasons: ['portfolio_risk_manager unavailable before virtual execution'],
      }

  const guardResponse = await quantClient.evaluateTradeExecutionGuard({
    user_id: user.id,
    symbol: order.symbol,
    market: order.market,
    side: order.side,
    requested_amount: order.amount,
    requested_quantity: order.quantity,
    current_price: order.price,
    signal_quality: signalQuality,
    robust_backtest: robustBacktest,
    portfolio_risk: portfolioRisk,
    market_data_quality: marketDataQuality,
    selected_provider: selectedProvider,
    account_equity: accountEquity,
    cash_balance: virtualBalance,
    current_position: currentPosition || null,
    idempotency_key: order.idempotencyKey,
    source: order.source,
  })

  if (!guardResponse.success || !guardResponse.data) {
    return {
      execution_status: 'BLOCKED',
      action_to_execute: 'NONE',
      approved_amount: 0,
      approved_quantity: 0,
      max_allowed_amount: 0,
      price_used: order.price,
      guardrails_passed: [],
      blocking_reasons: ['trade_execution_guard unavailable before virtual execution'],
      warnings: guardResponse.error ? [guardResponse.error] : [],
      confirmation_required: false,
      explanation: 'Operacion virtual bloqueada: no se pudo ejecutar el guard transaccional.',
      raw_diagnostics: { symbol: order.symbol, guard_status: guardResponse.status },
    } satisfies TradeExecutionGuardResult
  }

  return guardResponse.data as TradeExecutionGuardResult
}

async function executeFallbackTrade(
  dbClient: AuthenticatedContext['dbClient'],
  user: NonNullable<AuthenticatedContext['user']>,
  order: TradeOrder
) {
  const quantity = order.quantity ?? roundQuantity((order.amount ?? 0) / order.price)
  const total = order.amount ?? quantity * order.price

  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(total) || total <= 0) {
    return NextResponse.json({ ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Tamaño de orden inválido.' } }, { status: 400 })
  }

  const virtualBalance = await getAuthMetadataVirtualBalance(user)
  if (virtualBalance < total) {
    return tradeErrorResponse('INSUFFICIENT_BALANCE')
  }

  if (order.signalId) {
    const { data: signalData, error: signalError } = await dbClient
      .from('signals')
      .update({ status: 'cancelled' })
      .eq('id', order.signalId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle()

    if (signalError) {
      console.error('[api/portfolio/trade fallback signal]', signalError)
      return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'No se pudo actualizar la senal.' } }, { status: 500 })
    }

    if (!signalData) return tradeErrorResponse('SIGNAL_NOT_ACTIVE')
  }

  const { data: position, error: positionError } = await dbClient
    .from('positions')
    .insert({
      user_id: user.id,
      symbol: order.symbol,
      name: order.name,
      market: order.market,
      quantity,
      entry_price: order.price,
      entry_date: new Date().toISOString().slice(0, 10),
      currency: 'USD',
      notes: order.notes,
      status: 'open',
    })
    .select('*')
    .single()

  if (positionError) {
    console.error('[api/portfolio/trade fallback position]', positionError)
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'No se pudo crear la posicion virtual.' } }, { status: 500 })
  }

  const nextBalance = virtualBalance - total
  const balanceError = await saveAuthMetadataVirtualBalance(dbClient, user, nextBalance)
  if (balanceError) {
    console.error('[api/portfolio/trade fallback balance]', balanceError)
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'No se pudo actualizar el capital virtual.' } }, { status: 500 })
  }

  const { data: transaction, error: transactionError } = await dbClient
    .from('transactions')
    .insert({
      user_id: user.id,
      symbol: order.symbol,
      name: order.name,
      market: order.market,
      type: 'BUY',
      quantity,
      price: order.price,
      currency: 'USD',
      notes: order.notes,
    })
    .select('*')
    .maybeSingle()

  if (transactionError) {
    console.error('[api/portfolio/trade fallback transaction]', transactionError)
  }

  return NextResponse.json({
    ok: true,
    data: {
      position: {
        id: position.id,
        symbol: order.symbol,
        market: order.market,
        quantity,
        entryPrice: order.price,
        status: 'open',
      },
      transaction: transaction ? {
        id: transaction.id,
        type: 'BUY',
        quantity,
        price: order.price,
        total,
      } : null,
      profile: { virtualBalance: nextBalance },
      source: 'auth_metadata_fallback',
    },
  }, { status: 201 })
}

export async function POST(request: NextRequest) {
  try {
    const { dbClient, user, userError } = await getAuthenticatedContext(request)
    if (userError || !user) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, { status: 401 })
    }

    const payload = await request.json().catch(() => null) as TradePayload | null
    const symbol = normalizeSymbol(payload?.symbol)
    const market = parseMarketOrLegacy(payload?.market, symbol)
    const side = String(payload?.side || 'BUY').toUpperCase()
    const price = parsePositiveNumber(payload?.price)
    const amount = parsePositiveNumber(payload?.amount)
    const quantity = parsePositiveNumber(payload?.quantity)

    if (side !== 'BUY') {
      return NextResponse.json({ ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Only BUY orders are supported here.' } }, { status: 400 })
    }

    if (!symbol || !market || !price || (!amount && !quantity)) {
      return NextResponse.json({ ok: false, error: { code: 'INVALID_PAYLOAD', message: 'symbol, market, price and amount or quantity are required.' } }, { status: 400 })
    }

    const order: TradeOrder = {
      symbol,
      name: payload?.name || symbol,
      market,
      side: 'BUY',
      amount,
      quantity,
      price,
      source: payload?.source || 'manual',
      signalId: payload?.signalId || null,
      notes: payload?.notes || null,
      idempotencyKey: payload?.idempotency_key || payload?.idempotencyKey || null,
      confirmationAccepted: payload?.confirmationAccepted === true,
    }

    const guard = await buildExecutionGuard(dbClient, user, order)
    if (guard.execution_status === 'BLOCKED') {
      console.warn('[api/portfolio/trade guard blocked]', guard)
      return guardErrorResponse(guard)
    }
    if (guard.execution_status === 'REQUIRES_CONFIRMATION' && !order.confirmationAccepted) {
      console.warn('[api/portfolio/trade guard confirmation required]', guard)
      return guardErrorResponse(guard)
    }

    const { data, error } = await dbClient.rpc('execute_virtual_trade', {
      p_user_id: user.id,
      p_symbol: order.symbol,
      p_name: order.name,
      p_market: order.market,
      p_amount: order.amount,
      p_quantity: order.quantity,
      p_price: order.price,
      p_source: order.source,
      p_signal_id: order.signalId,
      p_notes: order.notes,
    })

    if (error) {
      if (/INSUFFICIENT_BALANCE|SIGNAL_NOT_ACTIVE/i.test(error.message || '')) {
        return tradeErrorResponse(error.message || '')
      }

      console.warn('[api/portfolio/trade rpc fallback]', error)
      return executeFallbackTrade(dbClient, user, order)
    }

    return NextResponse.json({ ok: true, data }, { status: 201 })
  } catch (error) {
    console.error('[api/portfolio/trade fatal]', error)
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'No se pudo ejecutar la orden virtual.' } }, { status: 500 })
  }
}
