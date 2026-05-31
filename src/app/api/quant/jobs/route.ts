import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthenticatedContext } from '@/lib/api/auth'
import { getYahooSymbol, getZestySymbolMarket } from '@/lib/market-data'
import { parseMarketOrLegacy } from '@/lib/domain/market'

const createJobSchema = z.object({
  kind: z.enum(['workflow_analyze', 'sentiment_scan', 'backtest']).default('workflow_analyze'),
  symbol: z.string().trim().min(1).max(24),
  market: z.unknown().optional(),
  timeframe: z.string().trim().max(16).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().trim().max(120).optional(),
})

function normalizeJobStatus(value: unknown) {
  return typeof value === 'string' && ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired'].includes(value)
    ? value
    : undefined
}

export async function POST(request: NextRequest) {
  try {
    const { dbClient, user } = await getAuthenticatedContext(request)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = createJobSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid job payload', issues: parsed.error.flatten() }, { status: 400 })
    }

    const symbol = parsed.data.symbol.toUpperCase()
    const market = parseMarketOrLegacy(parsed.data.market, symbol) || getZestySymbolMarket(symbol)
    const quantSymbol = getYahooSymbol(symbol, market)
    const idempotencyKey = parsed.data.idempotencyKey || [
      parsed.data.kind,
      symbol,
      market,
      parsed.data.timeframe || 'default',
      new Date().toISOString().slice(0, 10),
    ].join(':')

    const { data, error } = await dbClient
      .from('quant_jobs')
      .insert({
        user_id: user.id,
        kind: parsed.data.kind,
        symbol,
        market,
        timeframe: parsed.data.timeframe || null,
        input: {
          ...(parsed.data.input || {}),
          quantSymbol,
        },
        idempotency_key: idempotencyKey,
      })
      .select('id, kind, symbol, market, timeframe, status, input, result, error_code, error_message, created_at, updated_at, started_at, completed_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        const { data: existingJob } = await dbClient
          .from('quant_jobs')
          .select('id, kind, symbol, market, timeframe, status, input, result, error_code, error_message, created_at, updated_at, started_at, completed_at')
          .eq('user_id', user.id)
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle()

        if (existingJob) {
          return NextResponse.json({ success: true, job: existingJob, deduped: true }, { status: 202 })
        }
      }

      console.error('[Quant Jobs] Failed to enqueue job:', error)
      return NextResponse.json({ error: 'Failed to enqueue quant job' }, { status: 500 })
    }

    return NextResponse.json({ success: true, job: data, deduped: false }, { status: 202 })
  } catch (error) {
    console.error('[Quant Jobs] POST exception:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { dbClient, user } = await getAuthenticatedContext(request)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const status = normalizeJobStatus(searchParams.get('status'))
    const limit = Math.min(Number(searchParams.get('limit') || 20), 50)

    let query = dbClient
      .from('quant_jobs')
      .select('id, kind, symbol, market, timeframe, status, input, result, error_code, error_message, created_at, updated_at, started_at, completed_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (id) query = query.eq('id', id)
    if (status) query = query.eq('status', status)

    const { data: jobs, error } = await query

    if (error) {
      console.error('[Quant Jobs] Failed to read jobs:', error)
      return NextResponse.json({ error: 'Failed to load quant jobs' }, { status: 500 })
    }

    const jobIds = (jobs || []).map((job) => job.id)
    const { data: events, error: eventsError } = jobIds.length
      ? await dbClient
          .from('quant_job_events')
          .select('id, job_id, status, message, metadata, created_at')
          .in('job_id', jobIds)
          .order('created_at', { ascending: false })
      : { data: [], error: null }

    if (eventsError) {
      console.error('[Quant Jobs] Failed to read job events:', eventsError)
      return NextResponse.json({ error: 'Failed to load quant job events' }, { status: 500 })
    }

    return NextResponse.json({ success: true, jobs: jobs || [], events: events || [] })
  } catch (error) {
    console.error('[Quant Jobs] GET exception:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
