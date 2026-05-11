import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedContext } from '@/lib/api/auth'
import { normalizeSymbol, parseMarketOrLegacy } from '@/lib/domain/market'

type ExecutePayload = {
  signalId: string
  symbol: string
  market: string
  price: number
}

export async function POST(request: NextRequest) {
  try {
    const { dbClient, user, userError } = await getAuthenticatedContext(request)
    if (userError || !user) {
      return NextResponse.json({ ok: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 })
    }

    const payload = await request.json().catch(() => null) as ExecutePayload | null
    if (!payload?.signalId || !payload?.symbol) {
      return NextResponse.json({ ok: false, error: { code: 'INVALID_PAYLOAD' } }, { status: 400 })
    }

    const { data: signal, error: signalError } = await dbClient
      .from('signals')
      .select('*')
      .eq('id', payload.signalId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .eq('type', 'BUY')
      .maybeSingle()

    if (signalError || !signal) {
      return NextResponse.json({ ok: false, error: { code: 'SIGNAL_NOT_FOUND' } }, { status: 404 })
    }

    const symbol = normalizeSymbol(payload.symbol)
    const market = parseMarketOrLegacy(payload.market, payload.symbol)
    const price = Number(signal.price)

    if (!symbol || !market || !Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ ok: false, error: { code: 'INVALID_PRICE' } }, { status: 400 })
    }

    const { data: existingPos } = await dbClient
      .from('positions')
      .select('id')
      .eq('user_id', user.id)
      .eq('symbol', symbol.toUpperCase())
      .eq('status', 'open')
      .maybeSingle()

    if (existingPos) {
      return NextResponse.json({ ok: false, error: { code: 'ALREADY_POSITION' } }, { status: 409 })
    }

    const defaultAmount = Math.min(100, 10000 * 0.1)
    
    const baseUrl = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'http://localhost:3000'
    const tradeRes = await fetch(`${baseUrl}/api/portfolio/trade`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': request.headers.get('Authorization') || '',
      },
      body: JSON.stringify({
        side: 'BUY',
        symbol,
        name: symbol,
        market,
        amount: defaultAmount,
        price,
        source: 'pending-signal',
        signalId: signal.id,
        notes: `Ejecucion automatica desde senal pendiente (${signal.timeframe}) - precio ${price.toFixed(2)}`,
      }),
    })

    if (!tradeRes.ok) {
      const body = await tradeRes.json().catch(() => null)
      return NextResponse.json({ ok: false, error: body?.error || 'Trade execution failed' }, { status: 400 })
    }

    const tradeBody = await tradeRes.json().catch(() => null)

    await dbClient
      .from('signals')
      .update({ status: 'cancelled' })
      .eq('id', signal.id)
      .eq('user_id', user.id)

    return NextResponse.json({
      ok: true,
      data: {
        position: tradeBody?.data?.position || null,
        symbol,
        price,
        executedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('[cron/pending-signals/execute fatal]', error)
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Error interno' } },
      { status: 500 }
    )
  }
}