import { NextResponse } from 'next/server'
import { QuantClient } from '@/lib/ai/quant-client'

export async function GET() {
  const client = new QuantClient()
  const diagnostics = client.getDiagnostics()
  const health = await client.health()

  return NextResponse.json({
    ok: health.success,
    status: health.status,
    error: health.error || null,
    quant_engine_ready: health.success,
    diagnostics,
    health: health.data,
    checked_at: new Date().toISOString(),
  }, { status: health.success ? 200 : 503 })
}
