import { NextResponse, type NextRequest } from 'next/server'
import { getAuthenticatedContext } from '@/lib/api/auth'
import { getAlpacaConnectionStatus } from '@/lib/alpaca/client'
import { getAlpacaEnv } from '@/lib/alpaca/config'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const { user } = await getAuthenticatedContext(request)
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const status = await getAlpacaConnectionStatus(user.id, getAlpacaEnv())
    return NextResponse.json({ ok: true, data: status })
  } catch (error) {
    console.error('[alpaca/connection GET]', error)
    return NextResponse.json({ ok: false, error: 'Failed to load Alpaca connection' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await getAuthenticatedContext(request)
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const admin = await createAdminClient()
    const { error } = await admin
      .from('alpaca_connections')
      .update({
        status: 'disconnected',
        access_token_encrypted: null,
        disconnected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('environment', getAlpacaEnv())

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[alpaca/connection DELETE]', error)
    return NextResponse.json({ ok: false, error: 'Failed to disconnect Alpaca' }, { status: 500 })
  }
}
