// Runtime cambiado a Node.js por compatibilidad con @supabase/ssr

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createClientForAuthToken } from '@/lib/supabase/server'
import { normalizeStrength, normalizeSymbol, parseMarketOrLegacy, parseSignalType } from '@/lib/domain/market'

type SignalPayload = {
  symbol?: string
  market?: string
  type?: string
  strength?: number
  reason?: string
  price?: number
  timeframe?: string
}

const ACTIONABLE_TIMEFRAMES = new Set(['1D', '5D', '1M'])

type UserScopedContext = {
  dbClient: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createClientForAuthToken>
  user: { id: string } | null
  userError: unknown
}

async function getUserScopedContext(request: NextRequest): Promise<UserScopedContext> {
  const userClient = await createClient()
  let dbClient: UserScopedContext['dbClient'] = userClient
  let user: UserScopedContext['user'] = null
  let userError: unknown = null

  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '').trim()

  if (token) {
    const { data, error } = await userClient.auth.getUser(token)
    user = data?.user ? { id: data.user.id } : null
    userError = error

    if (user) {
      dbClient = createClientForAuthToken(token)
    }
  }

  if (!user) {
    const { data, error } = await userClient.auth.getUser()
    user = data?.user ? { id: data.user.id } : null
    userError = error
    dbClient = userClient
  }

  return { dbClient, user, userError }
}

export async function GET(request: NextRequest) {
  try {
    const { dbClient, user, userError } = await getUserScopedContext(request)

    if (userError || !user) {
      return NextResponse.json({ data: [] })
    }

    const { data, error } = await dbClient
      .from('signals')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[api/signals GET]', error)
      return NextResponse.json({ error: 'Failed to fetch signals' }, { status: 500 })
    }

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    console.error('[api/signals GET fatal]', error)
    return NextResponse.json({ error: 'Unexpected signals error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => null) as SignalPayload | null
    const { dbClient, user, userError } = await getUserScopedContext(request)

    if (userError || !user) {
      console.error('[api/signals POST] auth error:', userError, 'user:', user)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const symbol = normalizeSymbol(payload?.symbol)
    const market = parseMarketOrLegacy(payload?.market, symbol)
    const type = parseSignalType(payload?.type)
    const timeframe = payload?.timeframe

    if (!symbol || !market || !type || !timeframe) {
      return NextResponse.json({ error: 'Missing or invalid required signal fields' }, { status: 400 })
    }

    if (!ACTIONABLE_TIMEFRAMES.has(timeframe)) {
      return NextResponse.json({ error: 'Only 1D, 5D and 1M signals can be saved' }, { status: 400 })
    }

    const price = Number(payload?.price)
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + (timeframe === '1D' ? 1 : timeframe === '5D' ? 5 : 30))

    const { data, error } = await dbClient
      .from('signals')
      .insert({
        user_id: user.id,
        symbol,
        market,
        type,
        strength: normalizeStrength(payload?.strength),
        reason: payload?.reason || null,
        price: Number.isFinite(price) && price > 0 ? price : null,
        timeframe,
        status: 'active',
        expires_at: expiresAt.toISOString(),
      })
      .select('*')
      .single()

    if (error) {
      console.error('[api/signals POST]', error)
      return NextResponse.json({ error: 'Failed to save signal' }, { status: 500 })
    }

    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    console.error('[api/signals POST fatal]', error)
    return NextResponse.json({ error: 'Unexpected signal save error' }, { status: 500 })
  }
}