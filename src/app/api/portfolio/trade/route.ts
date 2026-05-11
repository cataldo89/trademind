import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedContext, type AuthenticatedContext } from '@/lib/api/auth'
import { getAuthMetadataVirtualBalance, saveAuthMetadataVirtualBalance } from '@/lib/api/virtual-balance'
import { normalizeSymbol, parseMarketOrLegacy } from '@/lib/domain/market'

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
}

type TradeOrder = {
  symbol: string
  name: string
  market: 'US' | 'CL'
  amount: number | null
  quantity: number | null
  price: number
  source: string
  signalId: string | null
  notes: string | null
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function roundQuantity(value: number) {
  return Math.round(value * 100_000_000) / 100_000_000
}

function tradeErrorResponse(message: string) {
  if (/INSUFFICIENT_BALANCE/i.test(message)) {
    return NextResponse.json({ ok: false, error: { code: 'INSUFFICIENT_BALANCE', message: 'Saldo virtual insuficiente.' } }, { status: 409 })
  }

  if (/SIGNAL_NOT_ACTIVE/i.test(message)) {
    return NextResponse.json({ ok: false, error: { code: 'SIGNAL_NOT_ACTIVE', message: 'La senal ya no esta activa.' } }, { status: 409 })
  }

  return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'No se pudo ejecutar la orden virtual.' } }, { status: 500 })
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
      amount,
      quantity,
      price,
      source: payload?.source || 'manual',
      signalId: payload?.signalId || null,
      notes: payload?.notes || null,
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