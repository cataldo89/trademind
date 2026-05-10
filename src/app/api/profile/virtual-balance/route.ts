import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createNextClient } from '@/lib/supabase/server'

type Payload = {
  virtualBalance?: number
}

async function getUser(request: NextRequest) {
  const userClient = await createNextClient()
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

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: updateData, error: updateError } = await adminSupabase
      .from('profiles')
      .update({ virtual_balance: virtualBalance })
      .eq('id', user.id)
      .select()
      .single()

    if (updateError) {
      console.error('[api/profile/virtual-balance PATCH]', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ data: updateData })
  } catch (error) {
    console.error('[api/profile/virtual-balance PATCH fatal]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unexpected profile error' }, { status: 500 })
  }
}
