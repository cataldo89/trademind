// Runtime cambiado a Node.js por compatibilidad con @supabase/ssr

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

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

async function getSignalsDbClient(userClient: Awaited<ReturnType<typeof createClient>>) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return userClient
  }

  try {
    return await createAdminClient()
  } catch (error) {
    console.error('[api/signals admin client]', error)
    return userClient
  }
}

export async function GET(request: NextRequest) {
  try {
    const userClient = await createClient()
    let user = null
    let userError = null

    const authHeader = request?.headers?.get('Authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (token) {
      const { data, error } = await userClient.auth.getUser(token)
      user = data?.user
      userError = error
    }

    if (!user) {
      const { data, error } = await userClient.auth.getUser()
      user = data?.user
      userError = error
    }

    if (userError || !user) {
      return NextResponse.json({ data: [] })
    }

    const supabase = await getSignalsDbClient(userClient)
    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[api/signals GET]', error)
      return NextResponse.json({ error: error.message || 'Failed to fetch signals' }, { status: 500 })
    }

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    console.error('[api/signals GET fatal]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unexpected signals error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json().catch(() => null) as SignalPayload | null
    const userClient = await createClient()
    let user = null
    let userError = null

    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (token) {
      const { data, error } = await userClient.auth.getUser(token)
      user = data?.user
      userError = error
    }

    if (!user) {
      const { data, error } = await userClient.auth.getUser()
      user = data?.user
      userError = error
    }

    if (userError || !user) {
      console.error('[api/signals POST] auth error:', userError, 'user:', user);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!payload?.symbol || !payload.market || !payload.type || !payload.timeframe) {
      return NextResponse.json({ error: 'Missing required signal fields' }, { status: 400 })
    }

    if (!ACTIONABLE_TIMEFRAMES.has(payload.timeframe)) {
      return NextResponse.json({ error: 'Only 1D, 5D and 1M signals can be saved' }, { status: 400 })
    }

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + (payload.timeframe === '1D' ? 1 : payload.timeframe === '5D' ? 5 : 30))

    const supabase = await getSignalsDbClient(userClient)
    const { data, error } = await supabase
      .from('signals')
      .insert({
        user_id: user.id,
        symbol: payload.symbol.toUpperCase(),
        market: payload.market,
        type: payload.type,
        strength: payload.strength ?? 50,
        reason: payload.reason || null,
        price: payload.price ?? null,
        timeframe: payload.timeframe,
        status: 'active',
        expires_at: expiresAt.toISOString(),
      })
      .select('*')
      .single()

    if (error) {
      console.error('[api/signals POST]', error)
      return NextResponse.json({ error: error.message || 'Failed to save signal' }, { status: 500 })
    }

    return NextResponse.json({ data }, { status: 201 })
  } catch (error) {
    console.error('[api/signals POST fatal]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unexpected signal save error' }, { status: 500 })
  }
}
