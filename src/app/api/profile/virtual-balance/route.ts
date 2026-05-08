import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

type Payload = {
  virtualBalance?: number
}

async function getUser(request: NextRequest) {
  const userClient = await createClient()
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (token) {
    const { data, error } = await userClient.auth.getUser(token)
    if (!error && data.user) return data.user
  }

  const { data, error } = await userClient.auth.getUser()
  if (error) return null
  return data.user
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await request.json().catch(() => null) as Payload | null
    const virtualBalance = Number(payload?.virtualBalance)

    if (!Number.isFinite(virtualBalance) || virtualBalance < 0) {
      return NextResponse.json({ error: 'Invalid virtual balance' }, { status: 400 })
    }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email || '',
        virtual_balance: virtualBalance,
      }, { onConflict: 'id' })
      .select('virtual_balance')
      .single()

    if (error) {
      console.error('[api/profile/virtual-balance PATCH]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/profile/virtual-balance PATCH fatal]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unexpected profile error' }, { status: 500 })
  }
}
