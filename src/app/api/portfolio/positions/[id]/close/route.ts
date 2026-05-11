import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedContext, type AuthenticatedContext } from '@/lib/api/auth'
import { getAuthMetadataVirtualBalance, saveAuthMetadataVirtualBalance } from '@/lib/api/virtual-balance'

type ClosePayload = {
  price?: number
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

  const { error: updateError } = await dbClient
    .from('positions')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      exit_price: price,
      realized_pnl: realizedPnl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', positionId)
    .eq('user_id', user.id)
    .eq('status', 'open')

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
      position: { id: positionId, symbol: openPosition.symbol, status: 'closed', closedAt: new Date().toISOString() },
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