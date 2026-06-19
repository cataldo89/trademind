import { NextResponse, type NextRequest } from 'next/server'
import { getAuthenticatedContext } from '@/lib/api/auth'
import { callAlpacaTradingApi } from '@/lib/alpaca/client'
import { getAlpacaEnv } from '@/lib/alpaca/config'

export async function GET(request: NextRequest) {
  try {
    const { user } = await getAuthenticatedContext(request)
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const positions = await callAlpacaTradingApi(user.id, '/v2/positions', getAlpacaEnv())
    return NextResponse.json({ ok: true, data: positions })
  } catch (error) {
    console.error('[alpaca/positions GET]', error)
    return NextResponse.json({ ok: false, error: 'Failed to load Alpaca positions' }, { status: 500 })
  }
}
