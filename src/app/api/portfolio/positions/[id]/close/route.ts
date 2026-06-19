import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedContext, type AuthenticatedContext } from '@/lib/api/auth'
import { getAuthMetadataVirtualBalance, saveAuthMetadataVirtualBalance } from '@/lib/api/virtual-balance'
import { quantClient } from '@/lib/ai/quant-client'
import type { TradeExecutionGuardResult } from '@/lib/trade-execution-guard'

type ClosePayload = {
  price?: number
  idempotencyKey?: string
  idempotency_key?: string
  notes?: string
}

type OpenPosition = {
  id: string
  symbol: string
  name: string
  market: 'US' | 'CL'
  quantity: number
  entry_price: number
  currency: string
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function closeErrorResponse(message: string) {
  if (/POSITION_NOT_FOUND/i.test(message)) {
    return NextResponse.json({ ok: false, error: { code: 'POSITION_NOT_FOUND', message: 'La posicion no existe o ya fue cerrada.' } }, { status: 404 })
  }

  return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'No se pudo cerrar la posicion.' } }, { status: 500 })
}

function guardErrorResponse(guard: TradeExecutionGuardResult) {
  return NextResponse.json({
    ok: false,
    error: {
      code: 'TRADE_GUARD_BLOCKED',
      message: guard.explanation,
      guard,
    },
  }, { status: 423 })
}

function allowedCloseGuard(
  position: OpenPosition,
  price: number,
  warnings: string[] = [],
  rawDiagnostics: Record<string, unknown> = {}
): TradeExecutionGuardResult {
  const quantity = Number(position.quantity)
  const proceeds = quantity * price

  return {
    execution_status: 'ALLOWED',
    action_to_execute: 'SELL',
    approved_amount: Number.isFinite(proceeds) ? proceeds : 0,
    approved_quantity: Number.isFinite(quantity) ? quantity : 0,
    max_allowed_amount: Number.isFinite(proceeds) ? proceeds : 0,
    price_used: price,
    guardrails_passed: ['SIDE_VALID', 'PRICE_VALID', 'SELL_POSITION_EXISTS', 'MANUAL_CLOSE_ALLOWED'],
    blocking_reasons: [],
    warnings,
    confirmation_required: false,
    explanation: `Cierre virtual permitido para ${position.symbol}; la posicion abierta existe y no requiere saldo disponible.`,
    raw_diagnostics: {
      symbol: position.symbol,
      market: position.market,
      side: 'SELL',
      source: 'manual',
      ...rawDiagnostics,
    },
  }
}

function isOnlyMarketDataBlocking(guard: TradeExecutionGuardResult) {
  return guard.blocking_reasons.length > 0
    && guard.blocking_reasons.every((reason) => reason.startsWith('market_data_quality.'))
}

function isSchemaCacheMissingColumn(error: { code?: string; message?: string } | null) {
  return error?.code === 'PGRST204' || /Could not find the .* column/i.test(error?.message || '')
}

async function getOpenPositionForClose(
  dbClient: AuthenticatedContext['dbClient'],
  userId: string,
  positionId: string
) {
  const { data: position, error } = await dbClient
    .from('positions')
    .select('*')
    .eq('id', positionId)
    .eq('user_id', userId)
    .eq('status', 'open')
    .maybeSingle()

  return { position: position as OpenPosition | null, error }
}

async function buildCloseGuard(
  dbClient: AuthenticatedContext['dbClient'],
  user: NonNullable<AuthenticatedContext['user']>,
  position: OpenPosition,
  price: number,
  idempotencyKey: string | null
) {
  const virtualBalance = await getAuthMetadataVirtualBalance(user)
  const currentPosition = {
    id: position.id,
    symbol: position.symbol,
    market: position.market,
    quantity: Number(position.quantity),
    entry_price: Number(position.entry_price),
    current_price: price,
    market_value: Number(position.quantity) * price,
  }
  const accountEquity = virtualBalance + currentPosition.market_value

  const provider = await quantClient.resolveProviderFallback({
    symbol: position.symbol,
    market: position.market,
    timeframe: '1d',
    range: '2y',
    required_use: 'ml',
  })

  if (!provider.success || !provider.data) {
    return allowedCloseGuard(
      position,
      price,
      ['No se pudo auditar calidad de datos antes del cierre; se permite cerrar la posicion abierta con el precio enviado.', ...(provider.error ? [provider.error] : [])],
      { provider_status: provider.status, provider_unavailable: true }
    )
  }

  const portfolioRisk = {
    portfolio_risk_status: 'OK',
    action_allowed: true,
    max_position_size: currentPosition.market_value,
    suggested_position_size: currentPosition.market_value,
  }

  const guardResponse = await quantClient.evaluateTradeExecutionGuard({
    user_id: user.id,
    symbol: position.symbol,
    market: position.market,
    side: 'SELL',
    requested_amount: currentPosition.market_value,
    requested_quantity: currentPosition.quantity,
    current_price: price,
    signal_quality: { signal_status: 'WEAK', final_action: 'HOLD', final_confidence: 0 },
    robust_backtest: { backtest_status: 'WEAK', usable_for_decision: false },
    portfolio_risk: portfolioRisk,
    market_data_quality: provider.data.selected_quality || {},
    selected_provider: provider.data.selected_provider,
    account_equity: accountEquity,
    cash_balance: virtualBalance,
    current_position: currentPosition,
    idempotency_key: idempotencyKey,
    source: 'manual',
  })

  if (!guardResponse.success || !guardResponse.data) {
    return allowedCloseGuard(
      position,
      price,
      ['No se pudo ejecutar el guard transaccional; se permite cerrar la posicion abierta con el precio enviado.', ...(guardResponse.error ? [guardResponse.error] : [])],
      { guard_status: guardResponse.status, guard_unavailable: true }
    )
  }

  const guard = guardResponse.data as TradeExecutionGuardResult
  if (guard.execution_status === 'BLOCKED' && isOnlyMarketDataBlocking(guard)) {
    return allowedCloseGuard(
      position,
      price,
      ['La auditoria de datos marco advertencias, pero no bloquea un cierre manual de una posicion abierta.', ...guard.blocking_reasons, ...guard.warnings],
      { overridden_guard: guard }
    )
  }

  return guard
}

async function closeFallbackPosition(
  dbClient: AuthenticatedContext['dbClient'],
  user: NonNullable<AuthenticatedContext['user']>,
  positionId: string,
  price: number,
  notes: string | null
) {
  const { data: position, error: positionError } = await dbClient
    .from('positions')
    .select('*')
    .eq('id', positionId)
    .eq('user_id', user.id)
    .eq('status', 'open')
    .maybeSingle()

  if (positionError) {
    console.error('[api/portfolio/positions/close fallback select]', positionError)
    return closeErrorResponse('INTERNAL_ERROR')
  }

  if (!position) return closeErrorResponse('POSITION_NOT_FOUND')

  const openPosition = position as OpenPosition
  const quantity = Number(openPosition.quantity)
  const entryPrice = Number(openPosition.entry_price)
  const proceeds = quantity * price
  const realizedPnl = proceeds - quantity * entryPrice

  const closedAt = new Date().toISOString()
  let updatePayload: Record<string, unknown> = {
    status: 'closed',
    closed_at: closedAt,
    exit_price: price,
    realized_pnl: realizedPnl,
    updated_at: closedAt,
  }

  let { error: updateError } = await dbClient
    .from('positions')
    .update(updatePayload)
    .eq('id', positionId)
    .eq('user_id', user.id)
    .eq('status', 'open')

  if (isSchemaCacheMissingColumn(updateError)) {
    console.warn('[api/portfolio/positions/close fallback update retry compact]', updateError)
    updatePayload = {
      status: 'closed',
      closed_at: closedAt,
      updated_at: closedAt,
    }

    const retry = await dbClient
      .from('positions')
      .update(updatePayload)
      .eq('id', positionId)
      .eq('user_id', user.id)
      .eq('status', 'open')

    updateError = retry.error
  }

  if (isSchemaCacheMissingColumn(updateError)) {
    console.warn('[api/portfolio/positions/close fallback update retry minimal]', updateError)
    updatePayload = {
      status: 'closed',
      closed_at: closedAt,
    }

    const retry = await dbClient
      .from('positions')
      .update(updatePayload)
      .eq('id', positionId)
      .eq('user_id', user.id)
      .eq('status', 'open')

    updateError = retry.error
  }

  if (updateError) {
    console.error('[api/portfolio/positions/close fallback update]', updateError)
    return closeErrorResponse('INTERNAL_ERROR')
  }

  const virtualBalance = await getAuthMetadataVirtualBalance(user)
  const nextBalance = virtualBalance + proceeds
  const balanceError = await saveAuthMetadataVirtualBalance(dbClient, user, nextBalance)
  if (balanceError) {
    console.error('[api/portfolio/positions/close fallback balance]', balanceError)
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'No se pudo actualizar el capital virtual.' } }, { status: 500 })
  }

  const { data: transaction, error: transactionError } = await dbClient
    .from('transactions')
    .insert({
      user_id: user.id,
      symbol: openPosition.symbol,
      name: openPosition.name || openPosition.symbol,
      market: openPosition.market,
      type: 'SELL',
      quantity,
      price,
      currency: openPosition.currency || 'USD',
      notes,
    })
    .select('*')
    .maybeSingle()

  if (transactionError) {
    console.error('[api/portfolio/positions/close fallback transaction]', transactionError)
  }

  return NextResponse.json({
    ok: true,
    data: {
      position: { id: positionId, symbol: openPosition.symbol, status: 'closed', closedAt },
      transaction: transaction ? { id: transaction.id, type: 'SELL', quantity, price, total: proceeds } : null,
      profile: { virtualBalance: nextBalance },
      realizedPnl,
      source: 'auth_metadata_fallback',
    },
  })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { dbClient, user, userError } = await getAuthenticatedContext(request)
    if (userError || !user) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, { status: 401 })
    }

    const { id } = await context.params
    const payload = await request.json().catch(() => null) as ClosePayload | null
    const price = parsePositiveNumber(payload?.price)

    if (!id || !price) {
      return NextResponse.json({ ok: false, error: { code: 'INVALID_PAYLOAD', message: 'position id and price are required.' } }, { status: 400 })
    }

    const { position, error: positionLookupError } = await getOpenPositionForClose(dbClient, user.id, id)
    if (positionLookupError) {
      console.error('[api/portfolio/positions/close guard select]', positionLookupError)
      return closeErrorResponse('INTERNAL_ERROR')
    }
    if (!position) return closeErrorResponse('POSITION_NOT_FOUND')

    const idempotencyKey = payload?.idempotency_key || payload?.idempotencyKey || crypto.randomUUID()
    const guard = await buildCloseGuard(
      dbClient,
      user,
      position,
      price,
      idempotencyKey
    )
    if (guard.execution_status !== 'ALLOWED') {
      console.warn('[api/portfolio/positions/close guard blocked]', guard)
      return guardErrorResponse(guard)
    }

    const { data, error } = await dbClient.rpc('close_virtual_position', {
      p_user_id: user.id,
      p_position_id: id,
      p_price: price,
      p_notes: payload?.notes || null,
    })

    if (error) {
      if (/POSITION_NOT_FOUND/i.test(error.message || '')) return closeErrorResponse(error.message || '')
      console.warn('[api/portfolio/positions/close rpc fallback]', error)
      return closeFallbackPosition(dbClient, user, id, price, payload?.notes || null)
    }

    return NextResponse.json({ ok: true, data })
  } catch (error) {
    console.error('[api/portfolio/positions/close fatal]', error)
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'No se pudo cerrar la posicion.' } }, { status: 500 })
  }
}
