import { NextResponse, type NextRequest } from 'next/server'
import { getAuthenticatedContext } from '@/lib/api/auth'
import { callAlpacaTradingApi } from '@/lib/alpaca/client'
import { getAlpacaEnv } from '@/lib/alpaca/config'

export async function GET(request: NextRequest) {
  try {
    const { user } = await getAuthenticatedContext(request)
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

    const orders = await callAlpacaTradingApi(
      user.id,
      '/v2/orders?status=all&limit=50&direction=desc',
      getAlpacaEnv()
    )

    return NextResponse.json({ ok: true, data: orders })
  } catch (error) {
    console.error('[alpaca/orders GET]', error)
    return NextResponse.json({ ok: false, error: 'Failed to load Alpaca orders' }, { status: 500 })
  }
}
