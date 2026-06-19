import { NextRequest, NextResponse } from 'next/server'
import { yahooFinance } from '@/lib/yahoo-finance'
import { QuantClient } from '@/lib/ai/quant-client'
import { fetchAlphaVantageIntraday, fetchFinnhubCandles, getYahooSymbol, getZestySymbolMarket } from '@/lib/market-data'
import { getDurableMarketData } from '@/lib/api/market-data-cache'
import { fetchAlpacaCryptoCandles, isUsdCryptoSymbol } from '@/lib/alpaca/market-data'
import { isCryptoSymbol } from '@/lib/final-decision-gate'
import { selectCryptoMlDecision } from '@/lib/crypto-ml-policy'
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
  history_candles?: number
  generated_at: string
}

function applyCryptoPolicyToRankings(rankings: AssetRanking[], historicalData?: Record<string, Record<string, unknown>[]>) {
  if (rankings.length === 0) return []

  const scores = rankings.map(r => Number(r.score) || 0)
  const minScore = Math.min(...scores)
  const maxScore = Math.max(...scores)
  const range = maxScore - minScore

  return rankings
    .map((ranking) => {
      const rawCandles = historicalData?.[ranking.symbol] || []
      const candles = rawCandles.map((c: any) => ({
        time: Number(c.time || 0),
        open: Number(c.open || 0),
        high: Number(c.high || 0),
        low: Number(c.low || 0),
        close: Number(c.close || 0),
        volume: Number(c.volume || 0)
      }))
      const decision = selectCryptoMlDecision(ranking.symbol, candles)
      if (!decision.isCrypto) return ranking

      if (decision.isStablecoin) {
        return {
          ...ranking,
          score: -1,
          signal: 'AVOID' as const,
          confidence: 0.1,
          main_reasons: Array.from(new Set([...(ranking.main_reasons || []), ...decision.reasons])),
          model_version: `${ranking.model_version}_crypto_policy`,
        }
      }

      const rawScore = Number(ranking.score) || 0
      const scaledScore = range === 0 ? 50 : ((rawScore - minScore) / range) * 100
      const penalizedScore = Math.max(0, Math.min(decision.confidenceCap, scaledScore - decision.scorePenalty))
      
      const stableOrBlockedReasons = [
        ...(!decision.lightgbmAllowed ? ['crypto_policy_blocks_lightgbm', decision.engineLabel] : []),
        ...decision.reasons,
      ]

      return {
        ...ranking,
        score: Number(penalizedScore.toFixed(4)),
        signal: decision.lightgbmAllowed ? ranking.signal : 'HOLD' as const,
        confidence: Math.min(Number(ranking.confidence) || 0, decision.confidenceCap / 100),
        main_reasons: Array.from(new Set([...(ranking.main_reasons || []), ...stableOrBlockedReasons])),
        model_version: `${ranking.model_version}_crypto_policy`,
      }
    })
    .sort((a, b) => b.score - a.score)
    .map((ranking, index) => ({ ...ranking, rank: index + 1 }))
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
  if (market !== 'US' || isCryptoSymbol(symbol)) return null

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

function scoreRecentIpoShortHistory(symbol: string, candles: Record<string, unknown>[]) {
  const closes = candles.map((candle) => Number(candle.close)).filter((value) => Number.isFinite(value) && value > 0)
  const volumes = candles.map((candle) => Number(candle.volume)).filter((value) => Number.isFinite(value) && value >= 0)
  const last = closes.at(-1) || 0
  const previous = closes.at(-2) || last
  const return1d = pctChange(last, previous)
  const todayVolume = volumes.at(-1) || 0
  const liquidityScore = todayVolume > 0 ? Math.min(12, Math.log10(todayVolume)) : 0
  const score = Math.max(1, Math.min(85, 50 + (return1d * 125) + liquidityScore + Math.min(8, closes.length)))

  return {
    symbol,
    eligible: closes.length >= 2,
    score: Number(score.toFixed(4)),
    history_candles: closes.length,
    reasons: [
      'recent_ipo_short_history',
      'long_term_indicators_disabled',
      return1d > 0 ? 'positive_immediate_change' : null,
      todayVolume > 100000 ? 'valid_day_volume' : null,
    ].filter(Boolean) as string[],
  }
}

function rankAssetsLocally(symbols: string[], historicalDataBySymbol: Record<string, Record<string, unknown>[]>): AssetRanking[] {
  const generatedAt = new Date().toISOString()
  const scored = symbols.map((symbol) => {
    const candles = historicalDataBySymbol[symbol] || []
    const closes = candles.map((candle) => Number(candle.close)).filter((value) => Number.isFinite(value) && value > 0)
    if (closes.length < 21) {
      const recentIpo = scoreRecentIpoShortHistory(symbol, candles)
      if (recentIpo.eligible) {
        return {
          symbol,
          rank: 0,
          score: recentIpo.score,
          signal: recentIpo.score >= 62 ? 'BUY' as const : recentIpo.score <= 38 ? 'AVOID' as const : 'HOLD' as const,
          confidence: Number(Math.max(0.45, Math.min(0.69, recentIpo.score / 100)).toFixed(2)),
          risk: 0.6,
          main_reasons: recentIpo.reasons,
          model_version: 'local_recent_ipo_fallback',
          history_candles: recentIpo.history_candles,
          generated_at: generatedAt,
        }
      }
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

  const eligible = scored.filter(item => item.rank !== 9999)
  const blocked = scored.filter(item => item.rank === 9999)

  // Sort eligible temporarily by score descending to assign normal asset signals
  eligible.sort((a, b) => b.score - a.score)
  eligible.forEach((item, index, array) => {
    // Only map signal if it's not a recent IPO fallback (which already has its signal computed)
    if (item.model_version !== 'local_recent_ipo_fallback') {
      const pct = index / Math.max(1, array.length - 1)
      item.signal = pct <= 0.10 ? ('BUY' as const) : pct >= 0.70 ? ('AVOID' as const) : ('HOLD' as const)
    }
  })

  // Define signal priority: BUY = 2, HOLD = 1, AVOID = 0
  const getSignalPriority = (item: typeof eligible[0]) => {
    const sig = (item.signal || 'HOLD').toUpperCase()
    if (sig === 'BUY') return 2
    if (sig === 'HOLD') return 1
    return 0
  }

  // Now sort all eligible assets by signal priority first, then by score descending
  eligible.sort((a, b) => {
    const prioA = getSignalPriority(a)
    const prioB = getSignalPriority(b)
    if (prioB !== prioA) return prioB - prioA
    return b.score - a.score
  })

  // Assign final ranks
  eligible.forEach((item, index) => {
    item.rank = index + 1
  })

  return [...eligible, ...blocked]
}

function scorePrefilterCandidate(symbol: string, candles: Record<string, unknown>[]) {
  const cryptoDecision = selectCryptoMlDecision(symbol, candles as unknown as Candle[])
  const closes = candles.map((candle) => Number(candle.close)).filter((value) => Number.isFinite(value) && value > 0)
  const volumes = candles.map((candle) => Number(candle.volume)).filter((value) => Number.isFinite(value) && value >= 0)

  if (cryptoDecision.isCrypto && !cryptoDecision.lightgbmAllowed) {
    return {
      symbol,
      eligible: false,
      score: -Infinity,
      reasons: [
        'crypto_policy_blocks_lightgbm',
        cryptoDecision.engineLabel,
        ...cryptoDecision.reasons,
      ],
    }
  }

  if (closes.length < 60) {
    const recentIpo = scoreRecentIpoShortHistory(symbol, candles)
    if (recentIpo.eligible) return recentIpo
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
        const fallbackRankings = rankAssetsLocally(uniqueSymbols, historical_data_by_symbol)
        const mappings = applyCryptoPolicyToRankings(fallbackRankings, historical_data_by_symbol)
        const mappedRankings = mappings.map(r => ({
            symbol: r.symbol,
            candidate_rank: r.rank,
            candidate_score: r.score,
            candidate_signal: r.signal === 'BUY' ? 'CANDIDATE' : r.signal === 'AVOID' ? 'AVOID' : 'WATCHLIST' as const,
            main_reasons: r.main_reasons || [],
            model_version: r.model_version,
            generated_at: r.generated_at
        }))
        const fallbackReason = res.error || res.data?.error || 'Quant engine rank_assets returned no usable data.'
        const fallbackMessage = `Quant engine unavailable: ${fallbackReason}`
        return NextResponse.json({
            ok: false,
            error: fallbackMessage,
            model: 'lightgbm_asset_ranker',
            model_status: 'local_fallback_quant_unavailable',
            generated_at: new Date().toISOString(),
            count: mappedRankings.length,
            rankings: mappedRankings,
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

    const rankings = applyCryptoPolicyToRankings((res.data.rankings || []) as AssetRanking[], historical_data_by_symbol)
    const lightgbmReady = res.data?.model_status === 'loaded'

    if (!lightgbmReady) {
        const fallbackRankings = Array.isArray(res.data.rankings) ? applyCryptoPolicyToRankings(res.data.rankings as AssetRanking[], historical_data_by_symbol) : []
        const mappedFallback = fallbackRankings.map(r => ({
            symbol: r.symbol,
            candidate_rank: r.rank,
            candidate_score: r.score,
            candidate_signal: r.signal === 'BUY' ? 'CANDIDATE' : r.signal === 'AVOID' ? 'AVOID' : 'WATCHLIST' as const,
            main_reasons: r.main_reasons || [],
            model_version: r.model_version,
            generated_at: r.generated_at
        }))
        return NextResponse.json({
            ...res.data,
            ok: false,
            error: `LightGBM model is not ready. Current model_status: ${res.data?.model_status || 'unknown'}`,
            count: mappedFallback.length,
            rankings: mappedFallback,
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

    res.data.rankings = rankings
    res.data.count = rankings.length

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

    const mappedRankings = rankings.map(r => ({
        symbol: r.symbol,
        candidate_rank: r.rank,
        candidate_score: r.score,
        candidate_signal: r.signal === 'BUY' ? 'CANDIDATE' : r.signal === 'AVOID' ? 'AVOID' : 'WATCHLIST' as const,
        main_reasons: r.main_reasons || [],
        model_version: r.model_version,
        generated_at: r.generated_at
    }))

    return NextResponse.json({
        ...res.data,
        count: mappedRankings.length,
        rankings: mappedRankings,
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
