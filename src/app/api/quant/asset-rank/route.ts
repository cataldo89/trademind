import { NextRequest, NextResponse } from 'next/server'
import { yahooFinance } from '@/lib/yahoo-finance'
import { QuantClient } from '@/lib/ai/quant-client'
import { fetchAlphaVantageIntraday, fetchFinnhubCandles, getYahooSymbol, getZestySymbolMarket } from '@/lib/market-data'
import { getDurableMarketData } from '@/lib/api/market-data-cache'
import { createClient } from '@supabase/supabase-js'
import type { Candle } from '@/types'

const YAHOO_CANDLES_TIMEOUT_MS = Number.parseInt(process.env.YAHOO_CANDLES_TIMEOUT_MS || '10000', 10)
const ML_PREFILTER_LIMIT = Number.parseInt(process.env.ML_PREFILTER_LIMIT || '180', 10)
type AssetRankProvider = 'alpha-vantage' | 'finnhub' | 'yahoo'

type AssetRanking = {
  symbol: string
  rank: number
  score: number
  signal: 'BUY' | 'HOLD' | 'AVOID'
  confidence: number
  risk: number
  main_reasons: string[]
  model_version: string
  generated_at: string
}

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

function assetRankProviderOrder(): AssetRankProvider[] {
  const configured = (process.env.MARKET_DATA_SCAN_PROVIDER_ORDER || 'alpha-vantage,finnhub,yahoo')
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter((provider): provider is AssetRankProvider => ['alpha-vantage', 'finnhub', 'yahoo'].includes(provider))

  return Array.from(new Set(configured.length > 0 ? configured : ['alpha-vantage', 'finnhub', 'yahoo']))
}

function normalizeProviderSymbol(symbol: string) {
  return symbol.toUpperCase().replace('-', '.')
}

function cleanCandles(candles: Candle[], from: number) {
  const seenTimes = new Set<number>()

  return candles
    .filter((candle) => {
      if (!Number.isFinite(candle.time) || candle.time < from) return false
      if (!Number.isFinite(candle.close) || candle.close <= 0) return false
      if (seenTimes.has(candle.time)) return false
      seenTimes.add(candle.time)
      return true
    })
    .sort((a, b) => a.time - b.time)
}

async function fetchConfiguredDailyCandles(symbol: string, market: 'US' | 'CL') {
  if (market !== 'US' || /-USD$/i.test(symbol)) return null

  const providerSymbol = normalizeProviderSymbol(symbol)
  const to = Math.floor(Date.now() / 1000)
  const from = to - 365 * 24 * 60 * 60

  for (const provider of assetRankProviderOrder()) {
    if (provider === 'yahoo') continue

    try {
      const candles = provider === 'alpha-vantage' && process.env.ALPHA_VANTAGE_API_KEY
        ? await fetchAlphaVantageIntraday(providerSymbol, '1d', process.env.ALPHA_VANTAGE_API_KEY)
        : provider === 'finnhub' && process.env.FINNHUB_API_KEY
          ? await fetchFinnhubCandles(providerSymbol, '1d', process.env.FINNHUB_API_KEY, from, to)
          : []

      const clean = cleanCandles(candles, from)
      if (clean.length > 0) return clean
    } catch (error) {
      console.warn(`[Asset Rank] ${provider} candles failed for ${symbol}:`, error)
    }
  }

  return null
}

async function fetchCandles(symbol: string, market: 'US' | 'CL' = 'US'): Promise<Candle[]> {
  try {
    return await getDurableMarketData<Candle[]>({
      symbol,
      market,
      range: '1y',
      ttlMs: 4 * 60 * 60 * 1000, // 4 hours TTL
      provider: 'configured-market-data',
      loader: async () => {
        const configuredCandles = await fetchConfiguredDailyCandles(symbol, market)
        if (configuredCandles) return configuredCandles

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
    console.error(`[Asset Rank] No se pudieron obtener velas para ${symbol}:`, e)
    return []
  }
}

function pctChange(current: number, previous: number) {
  return Number.isFinite(current) && Number.isFinite(previous) && previous > 0
    ? (current - previous) / previous
    : 0
}

function rankAssetsLocally(symbols: string[], historicalDataBySymbol: Record<string, Record<string, unknown>[]>): AssetRanking[] {
  const generatedAt = new Date().toISOString()
  const scored = symbols.map((symbol) => {
    const candles = historicalDataBySymbol[symbol] || []
    const closes = candles.map((candle) => Number(candle.close)).filter((value) => Number.isFinite(value) && value > 0)
    if (closes.length < 21) {
      return {
        symbol,
        rank: 9999,
        score: 0,
        signal: 'HOLD' as const,
        confidence: 0.1,
        risk: 0.5,
        main_reasons: ['insufficient_data'],
        model_version: 'local_fallback',
        generated_at: generatedAt,
      }
    }

    const last = closes.at(-1) || 0
    const return5d = pctChange(last, closes.at(-6) || last)
    const return20d = pctChange(last, closes.at(-21) || last)
    const dailyReturns = closes.slice(-21).map((close, index, arr) => index === 0 ? 0 : pctChange(close, arr[index - 1]))
    const meanReturn = dailyReturns.reduce((sum, value) => sum + value, 0) / Math.max(1, dailyReturns.length)
    const variance = dailyReturns.reduce((sum, value) => sum + Math.pow(value - meanReturn, 2), 0) / Math.max(1, dailyReturns.length)
    const volatility = Math.sqrt(variance) * Math.sqrt(252)
    const high20 = Math.max(...closes.slice(-20))
    const drawdown = high20 > 0 ? (last - high20) / high20 : 0
    const score = (return5d * 100) + (return20d * 100) - (volatility * 10) + (drawdown * 20)
    const reasons = [
      return5d > 0 ? 'positive_5d_momentum' : null,
      return20d > 0 ? 'positive_20d_momentum' : null,
      drawdown > -0.05 ? 'low_drawdown' : null,
    ].filter(Boolean) as string[]

    return {
      symbol,
      rank: 0,
      score: Number(score.toFixed(4)),
      signal: 'HOLD' as const,
      confidence: 0.35,
      risk: Number(Math.max(0, volatility).toFixed(4)),
      main_reasons: reasons.length > 0 ? reasons : ['local_heuristic'],
      model_version: 'local_fallback',
      generated_at: generatedAt,
    }
  })

  return scored
    .sort((a, b) => b.score - a.score)
    .map((item, index, array) => ({
      ...item,
      rank: item.rank === 9999 ? 9999 : index + 1,
      signal: item.rank === 9999 ? 'HOLD' : index <= Math.max(0, Math.floor(array.length * 0.1) - 1) ? 'BUY' : index >= Math.floor(array.length * 0.7) ? 'AVOID' : 'HOLD',
    }))
}

function scorePrefilterCandidate(symbol: string, candles: Record<string, unknown>[]) {
  const closes = candles.map((candle) => Number(candle.close)).filter((value) => Number.isFinite(value) && value > 0)
  const volumes = candles.map((candle) => Number(candle.volume)).filter((value) => Number.isFinite(value) && value >= 0)

  if (closes.length < 60) {
    return { symbol, eligible: false, score: -Infinity, reasons: ['insufficient_history'] }
  }

  const last = closes.at(-1) || 0
  const return5d = pctChange(last, closes.at(-6) || last)
  const return20d = pctChange(last, closes.at(-21) || last)
  const return60d = pctChange(last, closes.at(-61) || last)
  const dailyReturns = closes.slice(-21).map((close, index, arr) => index === 0 ? 0 : pctChange(close, arr[index - 1]))
  const meanReturn = dailyReturns.reduce((sum, value) => sum + value, 0) / Math.max(1, dailyReturns.length)
  const variance = dailyReturns.reduce((sum, value) => sum + Math.pow(value - meanReturn, 2), 0) / Math.max(1, dailyReturns.length)
  const volatility = Math.sqrt(variance) * Math.sqrt(252)
  const high20 = Math.max(...closes.slice(-20))
  const drawdown = high20 > 0 ? (last - high20) / high20 : 0
  const avgVolume20 = volumes.slice(-20).reduce((sum, value) => sum + value, 0) / Math.max(1, Math.min(20, volumes.length))
  const liquidityScore = Math.log10(Math.max(1, avgVolume20)) * 2
  const qualityScore = Math.min(20, closes.length / 12)
  const score = qualityScore + liquidityScore + (return5d * 35) + (return20d * 25) + (return60d * 10) - (volatility * 6) + (drawdown * 15)

  const reasons = [
    avgVolume20 > 100000 ? 'liquid' : null,
    return5d > 0 ? 'positive_5d' : null,
    return20d > 0 ? 'positive_20d' : null,
    drawdown > -0.08 ? 'controlled_drawdown' : null,
  ].filter(Boolean) as string[]

  return {
    symbol,
    eligible: true,
    score: Number(score.toFixed(4)),
    reasons: reasons.length > 0 ? reasons : ['data_quality'],
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const symbolsInput: string[] = Array.isArray(body.symbols) ? body.symbols : []
    const market: string = body.market || 'US'
    const range: string = body.range || '1y'
    const saveToSupabase = body.save_to_supabase === true
    const useModel = body.use_model !== false
    const trainLocal = body.train_local === true
    const horizonDays = Number.isFinite(Number(body.horizon_days)) ? Number(body.horizon_days) : 5
    const modelVersion = typeof body.model_version === 'string' ? body.model_version : `local_${new Date().toISOString().slice(0, 10)}`

    if (!symbolsInput.length) {
      return NextResponse.json({ error: 'No symbols provided' }, { status: 400 })
    }

    const uniqueSymbols = Array.from(new Set(symbolsInput)).slice(0, 500)
    
    // Normalize symbols for Yahoo (e.g. BRK.B -> BRK-B)
    const yahooToOriginal = new Map<string, string>()
    const yahooSymbols = uniqueSymbols.map(sym => {
      const ySym = getYahooSymbol(sym, market as 'US' | 'CL')
      yahooToOriginal.set(ySym.toUpperCase(), sym)
      return ySym
    })

    const historical_data_by_symbol: Record<string, Record<string, unknown>[]> = {}
    
    // Concurrency limit for fetching
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

    const client = new QuantClient()
    let trainResult: Record<string, unknown> | null = null
    let modelReady = useModel
    const prefilterCandidates = Object.entries(historical_data_by_symbol)
      .map(([symbol, candles]) => scorePrefilterCandidate(symbol, candles))
    const eligiblePrefilterCandidates = prefilterCandidates
      .filter((candidate) => candidate.eligible)
      .sort((a, b) => b.score - a.score)
    const selectedTrainingSymbols = eligiblePrefilterCandidates
      .slice(0, Math.max(1, ML_PREFILTER_LIMIT))
      .map((candidate) => candidate.symbol)
    const trainingData = Object.fromEntries(
      selectedTrainingSymbols.map((symbol) => [symbol, historical_data_by_symbol[symbol]])
    )
    const prefilterAudit = {
      method: 'quality_liquidity_momentum_risk',
      universe_symbols: uniqueSymbols.length,
      eligible_symbols: eligiblePrefilterCandidates.length,
      selected_symbols: selectedTrainingSymbols.length,
      limit: ML_PREFILTER_LIMIT,
      top_symbols: eligiblePrefilterCandidates.slice(0, 10).map((candidate) => ({
        symbol: candidate.symbol,
        score: candidate.score,
        reasons: candidate.reasons,
      })),
    }

    if (trainLocal) {
      const trainRes = await client.trainAssetRanker({
        historical_data_by_symbol: trainingData,
        horizon_days: horizonDays,
        model_version: modelVersion,
      })

      trainResult = trainRes.success && trainRes.data
        ? trainRes.data as Record<string, unknown>
        : {
            ok: false,
            error: trainRes.error || 'Quant engine training request failed',
            status: trainRes.status,
          }

      modelReady = Boolean(trainResult?.ok)
    }

    const res = await client.rankAssets({
        symbols: uniqueSymbols,
        market,
        range,
        historical_data_by_symbol,
        use_model: modelReady
    })

    if (!res.success || !res.data || res.data.ok === false) {
        const rankings = rankAssetsLocally(uniqueSymbols, historical_data_by_symbol)
        const fallbackReason = res.error || res.data?.error || 'Quant engine rank_assets returned no usable data.'
        const fallbackMessage = `Quant engine unavailable: ${fallbackReason}`
        return NextResponse.json({
            ok: false,
            error: fallbackMessage,
            model: 'lightgbm_asset_ranker',
            model_status: 'local_fallback_quant_unavailable',
            generated_at: new Date().toISOString(),
            count: rankings.length,
            rankings,
            warning: fallbackMessage,
            train_result: trainResult,
            python_execution: {
                requested: true,
                quant_engine_ready: false,
                lightgbm_ready: false,
                trained_local_model: Boolean(trainResult?.ok),
                training_symbols: Object.keys(trainingData).length,
                prefilter: prefilterAudit,
                model_path: trainResult?.model_path || null,
                metadata_path: trainResult?.metadata_path || null,
                rank_source: 'typescript_local_fallback',
                rank_error: fallbackReason,
                rank_status: res.status || null,
                quant_diagnostics: client.getDiagnostics(),
            },
        }, { status: 503 })
    }

    const rankings = res.data.rankings || []
    const lightgbmReady = res.data?.model_status === 'loaded'

    if (!lightgbmReady) {
        const fallbackRankings = Array.isArray(res.data.rankings) ? res.data.rankings : []
        return NextResponse.json({
            ...res.data,
            ok: false,
            error: `LightGBM model is not ready. Current model_status: ${res.data?.model_status || 'unknown'}`,
            count: fallbackRankings.length,
            rankings: fallbackRankings,
            train_result: trainResult,
            python_execution: {
                requested: true,
                quant_engine_ready: true,
                lightgbm_ready: false,
                trained_local_model: Boolean(trainResult?.ok),
                training_symbols: Object.keys(trainingData).length,
                prefilter: prefilterAudit,
                model_path: trainResult?.model_path || null,
                metadata_path: trainResult?.metadata_path || null,
                rank_source: 'python_heuristic',
            },
        }, { status: 424 })
    }

    if (saveToSupabase && rankings.length > 0) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (url && serviceRoleKey) {
            const supabase = createClient(url, serviceRoleKey, {
                auth: { autoRefreshToken: false, persistSession: false },
            })
            
            // Generate a run_id
            const run_id = crypto.randomUUID()
            
            const insertPayload = rankings.map((r: any) => ({
                user_id: null,
                run_id,
                symbol: r.symbol,
                market,
                rank: r.rank,
                score: r.score,
                signal: r.signal,
                confidence: r.confidence,
                risk: r.risk,
                main_reasons: r.main_reasons || [],
                model_name: res.data?.model || 'lightgbm_asset_ranker',
                model_version: r.model_version,
                model_status: res.data?.model_status
            }))
            
            const { error: dbError } = await supabase.from('asset_rankings').insert(insertPayload)
            if (dbError) {
                console.error('[Asset Rank] Supabase insert error:', dbError.message)
            }
        }
    }

    return NextResponse.json({
        ...res.data,
        train_result: trainResult,
        python_execution: {
            requested: true,
            quant_engine_ready: true,
            lightgbm_ready: lightgbmReady,
            trained_local_model: Boolean(trainResult?.ok),
            training_symbols: Object.keys(trainingData).length,
            prefilter: prefilterAudit,
            model_path: trainResult?.model_path || null,
            metadata_path: trainResult?.metadata_path || null,
            rank_source: lightgbmReady ? 'python_lightgbm_local_model' : 'python_heuristic',
        },
    })

  } catch (error: unknown) {
    console.error('[Asset Rank] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
