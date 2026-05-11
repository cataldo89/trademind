import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedContext } from '@/lib/api/auth'

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
    if (!id) {
      return NextResponse.json({ ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Signal id is required.' } }, { status: 400 })
    }

    const { data, error } = await dbClient
      .from('signals')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .select('id,status')
      .maybeSingle()

    if (error) {
      console.error('[api/signals/cancel]', error)
      return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'No se pudo cancelar la senal.' } }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: { code: 'SIGNAL_NOT_ACTIVE', message: 'La senal ya no esta activa.' } }, { status: 404 })
    }

    return NextResponse.json({ ok: true, data: { signal: data } })
  } catch (error) {
    console.error('[api/signals/cancel fatal]', error)
    return NextResponse.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'No se pudo cancelar la senal.' } }, { status: 500 })
  }
}