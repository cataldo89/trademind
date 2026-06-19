import { NextRequest, NextResponse } from 'next/server'
import { yahooFinance } from '@/lib/yahoo-finance'
import { QuantClient } from '@/lib/ai/quant-client'
import { getYahooSymbol, getZestySymbolMarket } from '@/lib/market-data'
import { getDurableMarketData } from '@/lib/api/market-data-cache'
import { fetchAlpacaCryptoCandles } from '@/lib/alpaca/market-data'
import { isCryptoSymbol } from '@/lib/final-decision-gate'
import { createClient } from '@supabase/supabase-js'
import type { Candle } from '@/types'

const YAHOO_CANDLES_TIMEOUT_MS = Number.parseInt(process.env.YAHOO_CANDLES_TIMEOUT_MS || '10000', 10)

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  })
}

async function fetchCandles(symbol: string, market: 'US' | 'CL' = 'US'): Promise<Candle[]> {
  try {
    const cryptoOnly = isCryptoSymbol(symbol)
    return await getDurableMarketData<Candle[]>({
      symbol,
      market,
      range: cryptoOnly ? 'alpaca-full-history' : '1y',
      ttlMs: 4 * 60 * 60 * 1000, // 4 hours TTL
      provider: 'configured-market-data',
      loader: async () => {
        if (cryptoOnly) {
          const period1 = new Date()
          period1.setFullYear(2015, 0, 1)
          return fetchAlpacaCryptoCandles(symbol, '1d', period1)
        }

        const period1 = new Date()
        period1.setDate(period1.getDate() - 365) // 1Y
        const res = await withTimeout(
          yahooFinance.chart(symbol, { interval: '1d', period1 }),
          YAHOO_CANDLES_TIMEOUT_MS,
          `Yahoo chart ${symbol}`
        ) as any
        const rawQuotes = res.quotes || res.indicators?.quote?.[0] || []
        return rawQuotes.map((q: any, i: number) => {
          let time = 0
          if (q.date) time = Math.floor(new Date(q.date).getTime() / 1000)
          else if (res.timestamp?.[i]) time = res.timestamp[i]
          return {
            time,
            open: Number(q.open),
            high: Number(q.high),
            low: Number(q.low),
            close: Number(q.close),
            volume: Number(q.volume)
          }
        }).filter((c: any) => c.close > 0)
      }
    })
  } catch (e) {
    console.error(`[Validate Ranking] No se pudieron obtener velas para ${symbol}:`, e)
    return []
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const symbolsInput: string[] = Array.isArray(body.symbols) ? body.symbols : []
    const market: string = body.market || 'US'
    const horizonDays = Number.isFinite(Number(body.horizon_days)) ? Number(body.horizon_days) : 5
    const modelVersion = typeof body.model_version === 'string' ? body.model_version : `val_${new Date().toISOString().slice(0, 10)}`

    if (!symbolsInput.length) {
      return NextResponse.json({ error: 'No symbols provided' }, { status: 400 })
    }

    const uniqueSymbols = Array.from(new Set(symbolsInput)).slice(0, 200)
    
    // Normalize symbols for Yahoo (e.g. BRK.B -> BRK-B)
    const yahooToOriginal = new Map<string, string>()
    const yahooSymbols = uniqueSymbols.map(sym => {
      const ySym = getYahooSymbol(sym, market as 'US' | 'CL')
      yahooToOriginal.set(ySym.toUpperCase(), sym)
      return ySym
    })

    const historical_data_by_symbol: Record<string, Record<string, unknown>[]> = {}
    
    // Fetch candles in parallel chunks
    const CONCURRENCY = 10
    let active = 0
    let index = 0
    await new Promise<void>((resolve) => {
      const next = async () => {
        if (index >= yahooSymbols.length) {
          if (active === 0) resolve()
          return
        }
        const sym = yahooSymbols[index++]
        const original = yahooToOriginal.get(sym.toUpperCase()) || sym
        active++
        
        const candles = await fetchCandles(sym, market as 'US'|'CL')
        historical_data_by_symbol[original] = candles.map((candle) => ({ ...candle }))
        
        active--
        next()
      }
      for (let i = 0; i < CONCURRENCY && i < yahooSymbols.length; i++) next()
    })

    // Call Python Quant Engine walk-forward validation endpoint
    const client = new QuantClient()
    const res = await client.callEndpoint<{
      ok: boolean
      model?: string
      model_status?: string
      model_path?: string
      metadata_path?: string
      run_id?: string
      passed_validation?: boolean
      metrics?: {
        ndcg_at_10: number
        precision_at_10: number
        top10_return_1d: number
        top10_return_5d: number
        top10_return_10d: number
        top10_hit_rate_5d: number
        top10_max_drawdown: number
        benchmark_return: number
        symbols_count: number
        dates: number
        rows: number
      }
      error?: string
    }>('/ml/validate_asset_ranker', {
      historical_data_by_symbol,
      horizon_days: horizonDays,
      model_version: modelVersion
    }, 60000)

    if (!res.success || !res.data || res.data.ok === false) {
      return NextResponse.json({
        ok: false,
        error: res.error || res.data?.error || 'Validation request failed on the quant engine.'
      }, { status: 502 })
    }

    const valData = res.data
    const metrics = valData.metrics

    // Save to Supabase table: ranking_validation_runs
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    let savedToDb = false

    if (url && serviceRoleKey && metrics) {
      const supabase = createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      
      const dbPayload = {
        run_id: valData.run_id || crypto.randomUUID(),
        universe: market,
        symbols_count: metrics.symbols_count,
        model_name: valData.model || 'lightgbm_asset_ranker',
        model_version: modelVersion,
        top_symbols: [], // Can default empty as the table requires
        horizon_days: horizonDays,
        return_1d: metrics.top10_return_1d,
        return_5d: metrics.top10_return_5d,
        return_10d: metrics.top10_return_10d,
        hit_rate_5d: metrics.top10_hit_rate_5d,
        precision_at_10: metrics.precision_at_10,
        max_drawdown: metrics.top10_max_drawdown,
        benchmark_symbol: market === 'US' ? 'SPY' : 'IPSA',
        benchmark_return: metrics.benchmark_return,
        passed_validation: valData.passed_validation ?? false,
        notes: `Validation run status: ${valData.model_status}. Walk-forward evaluated on ${metrics.dates} dates.`
      }

      const { error: dbError } = await supabase.from('ranking_validation_runs').insert(dbPayload)
      if (dbError) {
        console.error('[Validate Ranking] Supabase insert error:', dbError.message)
      } else {
        savedToDb = true
      }
    }

    return NextResponse.json({
      ok: true,
      model_status: valData.model_status,
      passed_validation: valData.passed_validation,
      run_id: valData.run_id,
      metrics: valData.metrics,
      saved_to_db: savedToDb
    })

  } catch (error: unknown) {
    console.error('[Validate Ranking] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
