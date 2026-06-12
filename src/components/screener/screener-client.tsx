'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getCategorizedZestySymbols, getZestySymbolMarket } from '@/lib/market-data'
import { Market } from '@/types'
import { cn } from '@/lib/utils'
import {
  ArrowRightLeft,
  Loader2, Search, ChevronRight, Activity, Eye, Zap, ShieldCheck, AlertTriangle, Target
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { FinalQuantScore } from '@/lib/ranking'
import { getUSMarketStatus } from '@/lib/market-schedule'

const SENTIMENT_SCAN_SYMBOL_LIMIT = 5
const TOP_SENTIMENT_FRESHNESS_MS = 60 * 60 * 1000
type DisplayDecision = {
  action: 'BUY' | 'SELL' | 'HOLD' | 'BUY (Tech)' | 'SELL (Tech)' | string
  source: string
  status: string
  primaryReason: string
  details: string[]
}

function isPythonLightGbmReady(body: any) {
  return body?.model_status === 'loaded'
    && body?.python_execution?.quant_engine_ready === true
    && body?.python_execution?.lightgbm_ready === true
    && body?.python_execution?.rank_source === 'python_lightgbm_local_model'
}

function formatQuantEngineWarning(value: unknown) {
  const message = typeof value === 'string' ? value : ''
  if (!message || message === 'Quant engine request failed') {
    return 'Modo fallback tecnico: Ranking LightGBM no respondio para esta ejecucion. El ranking visible usa datos tecnicos locales.'
  }
  return message
}

function toMarket(value: string | Market | undefined): Market {
  return value === 'CL' ? 'CL' : 'US'
}

export function ScreenerClient() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'opportunities' | 'warnings'>('all')
  const [category, setCategory] = useState('zesty-all')
  const [isScanningSentiment, setIsScanningSentiment] = useState(false)
  const [isRanking, setIsRanking] = useState(false)
  const [mlRankings, setMlRankings] = useState<any[]>([])
  const [mlExecution, setMlExecution] = useState<any>(null)
  const [isQuantScanEnabled, setIsQuantScanEnabled] = useState(false)
  const [forceQuantRefreshNonce, setForceQuantRefreshNonce] = useState(0)
  const [marketStatus, setMarketStatus] = useState(() => getUSMarketStatus())
  const queryClient = useQueryClient()

  useEffect(() => {
    const interval = setInterval(() => {
      setMarketStatus(getUSMarketStatus())
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  const handleSelectSymbol = (symbol: string, market: string, result?: FinalQuantScore) => {
    if (result) {
      router.push(buildAnalysisHref(result))
      return
    }

    router.push(`/analysis?symbol=${encodeURIComponent(symbol)}&market=${encodeURIComponent(market)}`)
  }

  const triggerManualSentimentScan = async () => {
    setIsScanningSentiment(true)
    toast.info(`Revisando cache y noticias para hasta ${SENTIMENT_SCAN_SYMBOL_LIMIT} activos...`)
    try {
      const rankedSymbols = scanResults
        .filter((result) => !result.noData)
        .map((result) => result.symbol)
      const fallbackSymbols = scanSymbols.map((s) => s.symbol)
      const symbols = Array.from(new Set((rankedSymbols.length ? rankedSymbols : fallbackSymbols).filter(Boolean)))
        .slice(0, SENTIMENT_SCAN_SYMBOL_LIMIT)
      const res = await fetch('/api/quant/sentiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, freshnessMs: TOP_SENTIMENT_FRESHNESS_MS }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Falló el escaneo de sentimiento')
      if (body?.degraded && Number(body?.processed || 0) === 0) {
        toast.warning(body.warning || 'FinBERT no se actualizo porque el quant-engine no esta disponible.')
        return
      }
      const processed = Number(body?.processed || 0)
      const skippedCached = Number(body?.skippedCached || 0)
      const suffix = body?.truncated ? ` (lote limitado a ${body.limit})` : ''
      const scanMessage = processed > 0
        ? `FinBERT actualizÃ³ ${processed} activo(s); ${skippedCached} ya tenÃ­an cache fresco${suffix}.`
        : `${skippedCached} activo(s) ya tenÃ­an sentimiento fresco.`
      if (body?.degraded) {
        toast.warning(body.warning || 'FinBERT actualizo parcialmente el lote.')
      }
      toast.success(`${scanMessage} Recalculando ranking...`)
      await queryClient.invalidateQueries({ queryKey: ['screener-quant-scan', category] })
      await queryClient.refetchQueries({ queryKey: ['screener-quant-scan', category], type: 'active' })
      toast.success('Top Activos recalculado con el sentimiento vigente.')

      // Si el usuario ya tenía el motor abierto para un símbolo, re-evaluarlo para mostrar las noticias frescas
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      toast.warning('Noticias no actualizadas: ' + message)
    } finally {
      setIsScanningSentiment(false)
    }
  }

  const triggerMLRanking = async () => {
    setIsRanking(true)
    const startedAt = new Date().toLocaleTimeString()
    setMlExecution({
      status: 'running',
      stage: 'Entrenando modelo local en Python',
      startedAt,
      symbols: scanSymbols.length,
    })
    toast.info('Entrenando modelo local y rankeando activos con LightGBM...')
    try {
      const symbols = scanSymbols.map((s) => s.symbol)
      const res = await fetch('/api/quant/asset-rank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols,
          market: 'US',
          range: '1y',
          save_to_supabase: true,
          use_model: true,
          train_local: true,
          horizon_days: 5,
          model_version: `ui_${new Date().toISOString().slice(0, 10)}`,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const fallbackRankings = Array.isArray(body?.rankings) ? body.rankings : []
        if (fallbackRankings.length > 0) {
          setIsQuantScanEnabled(false)
          setMlRankings(fallbackRankings)
          setMlExecution({
            status: 'fallback',
            stage: body.python_execution?.rank_source || body.model_status || 'quant_engine_unavailable',
            startedAt,
            finishedAt: new Date().toLocaleTimeString(),
            symbols: symbols.length,
            trainingSymbols: body.python_execution?.training_symbols,
            prefilter: body.python_execution?.prefilter,
            modelStatus: body.model_status,
            modelPath: body.python_execution?.model_path,
            metadataPath: body.python_execution?.metadata_path,
            trainOk: Boolean(body.train_result?.ok),
            warning: formatQuantEngineWarning(body.warning || body.error),
          })
          toast.warning(`Ranking tecnico fallback para ${fallbackRankings.length} activos. LightGBM sigue bloqueado hasta que Cloudflare/FastAPI respondan.`)
          return
        }
        throw new Error(body?.error || 'Falló el ranking')
      }
      const lightgbmReady = isPythonLightGbmReady(body)
      if (!lightgbmReady) {
        setIsQuantScanEnabled(false)
        setMlRankings([])
        setMlExecution({
          status: 'fallback',
          stage: body.python_execution?.rank_source || body.model_status || 'quant_engine_unavailable',
          startedAt,
          finishedAt: new Date().toLocaleTimeString(),
          symbols: symbols.length,
          trainingSymbols: body.python_execution?.training_symbols,
          prefilter: body.python_execution?.prefilter,
          modelStatus: body.model_status,
          modelPath: body.python_execution?.model_path,
          metadataPath: body.python_execution?.metadata_path,
          trainOk: Boolean(body.train_result?.ok),
          warning: formatQuantEngineWarning(body.warning || body.train_result?.error),
        })
        toast.error('LightGBM no esta listo: el ranking quedo bloqueado porque el quant-engine esta en fallback.')
        return
      }

      setMlRankings(body.rankings || [])
      setMlExecution({
        status: 'trained',
        stage: body.python_execution?.rank_source || body.model_status || 'completed',
        startedAt,
        finishedAt: new Date().toLocaleTimeString(),
        symbols: symbols.length,
        trainingSymbols: body.python_execution?.training_symbols,
        prefilter: body.python_execution?.prefilter,
        modelStatus: body.model_status,
        modelPath: body.python_execution?.model_path,
        metadataPath: body.python_execution?.metadata_path,
        trainOk: Boolean(body.train_result?.ok),
        warning: body.warning || body.train_result?.error,
      })
      setIsQuantScanEnabled(true)
      toast.success(`Ranking LightGBM completado para ${body.count} activos.`)
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      setIsQuantScanEnabled(false)
      setMlRankings([])
      setMlExecution((current: any) => ({
        ...current,
        status: 'error',
        stage: 'Error ejecutando Python ML',
        finishedAt: new Date().toLocaleTimeString(),
        warning: message,
      }))
      toast.error('Error al rankear activos: ' + message)
    } finally {
      setIsRanking(false)
    }
  }

  const categories = useMemo(() => getCategorizedZestySymbols(), [])
  const selectedCategory = categories.find((cat) => cat.id === category) ?? categories[0]
  const lightgbmUiReady = isQuantScanEnabled
    && mlExecution?.status === 'trained'
    && mlExecution?.modelStatus === 'loaded'

  // Enviar todos los activos de la categoría (con un límite de 500)
  const scanSymbols = (selectedCategory?.symbols ?? [])
    .slice(0, 500)
    .map((s) => ({ ...s, market: getZestySymbolMarket(s.symbol) }))

  const { data: scanResponse, isFetching: scanLoading, isError: scanIsError, error: scanError } = useQuery({
    queryKey: ['screener-quant-scan', category, forceQuantRefreshNonce],
    queryFn: async () => {
      const symbols = Array.from(new Set(scanSymbols.map((s) => s.symbol).filter(Boolean)))
      if (symbols.length === 0) return null

      const symbolMap: Record<string, string> = {}
      const symbolMarkets: Record<string, Market> = {}
      scanSymbols.forEach(s => { symbolMap[s.symbol] = s.name })
      scanSymbols.forEach(s => { symbolMarkets[s.symbol] = s.market })

      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), 60000)

      const res = await fetch('/api/quant/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          symbols,
          category,
          market: 'US',
          symbolMap,
          symbolMarkets,
          forceQuantRefresh: forceQuantRefreshNonce > 0,
        })
      }).finally(() => window.clearTimeout(timeoutId))

      if (!res.ok) throw new Error('Failed to fetch scan results')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: false,
    enabled: lightgbmUiReady && forceQuantRefreshNonce > 0,
  })

  const scanResults: FinalQuantScore[] = scanResponse?.results || []
  const scanAudit = scanResponse?.scan_audit
  const isRegularMarketOpen = marketStatus.isOpen && marketStatus.session === 'regular'

  const isMarketDataBlocked = (r: FinalQuantScore) => {
    return r.noData || r.marketDataQuality?.status === 'FAILED' || r.marketDataQuality?.usable_for_ml === false
  }

  // Top candidates para las tarjetas
  const topCards = scanResults.filter(r => !isMarketDataBlocked(r)).slice(0, 9)

  const filtered = scanResults
    .filter(r => !r.noData) // Filtrar acciones sin datos (N/A)
    .filter(r => {
      if (filter === 'opportunities') return !isMarketDataBlocked(r) && (r.suggestions.some(s => s.type === 'opportunity') || r.quant?.action === 'BUY')
      if (filter === 'warnings') return r.suggestions.some(s => s.type === 'warning') || r.quant?.action === 'SELL'
      return true
    })
    .filter(r => {
      if (!search) return true
      return r.symbol.toLowerCase().includes(search.toLowerCase()) || r.name.toLowerCase().includes(search.toLowerCase())
    })
    .slice(0, 50) // Limitar la tabla a 50 resultados para evitar scroll infinito

  const hasUsableQuantData = (r: FinalQuantScore) => {
    if (isMarketDataBlocked(r)) return false
    if (r.isFallback || !r.quant) return false
    if (r.quant.engine_status && r.quant.engine_status !== 'ok') return false
    if (r.quant.data_quality && r.quant.data_quality !== 'complete') return false
    return Number(r.quant.confidence ?? 0) > 0
  }

  const hasIncompleteQuantData = (r: FinalQuantScore) => {
    if (r.isFallback) return true
    return r.quant?.engine_status === 'partial' ||
      r.quant?.engine_status === 'failed' ||
      r.quant?.data_quality === 'partial' ||
      r.quant?.data_quality === 'insufficient'
  }

  const getPythonBadge = (r: FinalQuantScore) => {
    if (!r.quant) return { label: 'Filtro Rapido', className: 'bg-gray-800 text-gray-400' }
    if (r.quant.engine_status === 'ok' || r.quant.data_quality === 'complete') {
      return { label: 'Python OK', className: 'bg-indigo-500/20 text-indigo-300' }
    }
    if (r.quant.engine_status === 'partial' || r.quant.data_quality === 'partial') {
      return { label: 'Python parcial', className: 'bg-amber-500/20 text-amber-300' }
    }
    if (r.quant.engine_status === 'failed' || r.quant.data_quality === 'insufficient') {
      return { label: 'Python fallo', className: 'bg-red-500/15 text-red-300' }
    }
    return { label: 'Python recibido', className: 'bg-indigo-500/20 text-indigo-300' }
  }

  const formatConfidence = (value: unknown) => {
    const number = Number(value)
    return Number.isFinite(number) ? `${number}%` : 'N/A'
  }

  const getProviderSummary = (r: FinalQuantScore) => {
    const statuses = r.providerFallback?.provider_statuses
    if (!Array.isArray(statuses) || statuses.length === 0) return null
    return statuses
      .slice(0, 4)
      .map((item) => {
        const record = item as Record<string, unknown>
        return `${record.provider || 'provider'}:${record.status || 'n/a'}`
      })
      .join(' | ')
  }

  const hasCleanBuySetup = (r: FinalQuantScore) => {
    if (isMarketDataBlocked(r)) return false
    if (r.signalQuality) {
      return r.signalQuality.signal_status === 'OK' &&
        r.signalQuality.final_action === 'BUY' &&
        r.signalQuality.final_confidence >= 70 &&
        r.robustBacktest?.usable_for_decision !== false &&
        r.robustBacktest?.backtest_status !== 'BLOCKED' &&
        r.robustBacktest?.backtest_status !== 'FAILED' &&
        r.portfolioRisk?.portfolio_risk_status !== 'BLOCKED' &&
        r.portfolioRisk?.action_allowed !== false
    }
    const sentiment = r.quant?.weekend_sentiment?.sentiment
    const regime = String(r.quant?.market_regime || '').toLowerCase()
    const hasMomentum = r.macdSignal === 'Cruce alcista' || r.macdSignal === 'Positivo'
    const rsiOk = r.rsi !== null && r.rsi >= 45 && r.rsi < 70
    const priceOk = r.changePercent !== null && r.changePercent >= 0 && r.changePercent <= 6

    return hasUsableQuantData(r) &&
      r.finalScore >= 70 &&
      hasMomentum &&
      rsiOk &&
      priceOk &&
      sentiment !== 'NEGATIVE' &&
      !regime.includes('bear') &&
      regime !== 'unknown' &&
      !r.isLeveragedOrInverse
  }

  const getDisplayDecision = (r: FinalQuantScore): DisplayDecision => {
    const details = [
      `Score tecnico ${r.finalScore.toFixed(0)}`,
      r.quant ? `Quant ${r.quant.action || 'N/A'} ${Number(r.quant.confidence ?? 0)}%` : 'Sin respuesta quant usable',
      r.rsi !== null ? `RSI ${r.rsi.toFixed(1)}` : 'RSI sin datos',
      r.macdSignal !== 'Sin datos' ? `MACD ${r.macdSignal}` : 'MACD sin datos',
      r.quant?.market_regime ? `Regimen ${r.quant.market_regime}` : null,
      r.quant?.weekend_sentiment?.sentiment ? `FinBERT ${r.quant.weekend_sentiment.sentiment}` : null,
      getProviderSummary(r) ? `Providers ${getProviderSummary(r)}` : null,
    ].filter(Boolean) as string[]

    if (isMarketDataBlocked(r)) {
      return {
        action: 'HOLD',
        source: 'market-data-quality',
        status: r.marketDataQuality?.status || 'BLOCKED',
        primaryReason: r.marketDataQuality?.recommendation || 'Datos insuficientes o bloqueados; BUY/SELL no confiable.',
        details,
      }
    }

    if (r.signalQuality) {
      const reasons = [
        r.robustBacktest?.backtest_status === 'BLOCKED' || r.robustBacktest?.backtest_status === 'FAILED'
          ? `Backtest ${r.robustBacktest.backtest_status}: ${r.robustBacktest.blocking_reasons?.[0] || r.robustBacktest.explanation || 'no usable para decision'}`
          : null,
        r.robustBacktest?.usable_for_decision === false
          ? 'Backtest no usable para decision'
          : null,
        r.portfolioRisk?.portfolio_risk_status === 'BLOCKED' || r.portfolioRisk?.action_allowed === false
          ? `Riesgo portfolio bloquea: ${(r.portfolioRisk.blocking_reasons || []).join('; ') || 'accion no permitida'}`
          : null,
        ...r.signalQuality.blocking_reasons,
        ...r.signalQuality.contradicting_factors,
        ...r.signalQuality.warnings,
      ].filter(Boolean) as string[]
      return {
        action: r.signalQuality.final_action,
        source: 'signal-quality',
        status: r.signalQuality.signal_status,
        primaryReason: reasons[0] || r.signalQuality.explanation,
        details: [
          r.signalQuality.explanation,
          ...reasons,
          ...details,
        ].filter(Boolean),
      }
    }

    if (hasUsableQuantData(r) && (r.quant?.action === 'BUY' || r.quant?.action === 'SELL')) {
      return {
        action: r.quant.action,
        source: 'python-quant-engine',
        status: r.quant.engine_status || 'ok',
        primaryReason: r.quant.xai_explanation || r.quant.engine_reason || 'Python quant-engine entrego una accion usable.',
        details,
      }
    }

    if (hasCleanBuySetup(r)) {
      return {
        action: 'BUY (Tech)',
        source: 'technical-fallback',
        status: 'TECH_OK',
        primaryReason: 'Setup tecnico limpio sin veto de riesgo: momentum, RSI, precio y sentimiento aceptables.',
        details,
      }
    }

    if (r.finalScore <= 40 || r.macdSignal.includes('bajista')) {
      return {
        action: 'SELL (Tech)',
        source: 'technical-fallback',
        status: 'TECH_BEARISH',
        primaryReason: r.macdSignal.includes('bajista') ? `MACD ${r.macdSignal}` : `Score tecnico bajo (${r.finalScore.toFixed(0)})`,
        details,
      }
    }

    return {
      action: 'HOLD',
      source: hasIncompleteQuantData(r) ? 'python-partial' : 'rules',
      status: hasIncompleteQuantData(r) ? (r.quant?.engine_status || 'partial') : 'NO_CLEAR_SETUP',
      primaryReason: hasIncompleteQuantData(r)
        ? (r.quant?.engine_reason || r.quant?.xai_explanation || 'El motor devolvio datos parciales; no hay accion confiable.')
        : 'No alcanza umbral para BUY/SELL despues de score, confianza, regimen y riesgo.',
      details,
    }
  }

  const getDisplayAction = (r: FinalQuantScore) => {
    if (isMarketDataBlocked(r)) return 'HOLD'
    return getDisplayDecision(r).action
  }

  const getDecisionScore = (r: FinalQuantScore) => {
    if (isMarketDataBlocked(r)) return 0
    if (r.signalQuality) {
      if (r.robustBacktest?.backtest_status === 'BLOCKED' || r.robustBacktest?.backtest_status === 'FAILED') return 0
      if (r.robustBacktest?.usable_for_decision === false) return Math.min(r.signalQuality.final_confidence, 49)
      if (r.robustBacktest?.backtest_status === 'WEAK') return Math.min(r.signalQuality.final_confidence, 60)
      if (r.portfolioRisk?.portfolio_risk_status === 'BLOCKED' || r.portfolioRisk?.action_allowed === false) return 0
      if (r.portfolioRisk?.portfolio_risk_status === 'WARNING') return Math.min(r.signalQuality.final_confidence, 60)
      return r.signalQuality.signal_status === 'OK' ? r.signalQuality.final_confidence : Math.min(r.signalQuality.final_confidence, 49)
    }
    let score = r.finalScore
    const action = getDisplayAction(r)
    const sentiment = r.quant?.weekend_sentiment?.sentiment
    const regime = String(r.quant?.market_regime || '').toLowerCase()

    if (action === 'BUY') score += 8
    if (action === 'BUY (Tech)') score += 4
    if (action === 'SELL' || action === 'SELL (Tech)' || action === 'HOLD') score -= 40
    if (regime.includes('bear')) score -= 20
    if (regime === 'unknown') score -= 25
    if (sentiment === 'POSITIVE') score += 8
    if (sentiment === 'NEGATIVE') score -= 18
    if (r.macdSignal === 'Cruce alcista') score += 10
    else if (r.macdSignal === 'Positivo') score += 4
    else if (r.macdSignal.includes('bajista') || r.macdSignal === 'Negativo') score -= 8
    if (r.rsi !== null && r.rsi >= 70) score -= 18
    else if (r.rsi !== null && r.rsi >= 55 && r.rsi < 70) score += 6
    else if (r.rsi !== null && r.rsi < 35) score -= 4
    if (r.changePercent !== null && r.changePercent > 6) score -= 12
    if (r.changePercent !== null && r.changePercent < 0) score -= 10
    if (r.isLeveragedOrInverse) score -= 15
    if (r.noData) score -= 60

    return score
  }

  const buildAnalysisHref = (r: FinalQuantScore) => {
    const params = new URLSearchParams()
    const sentiment = r.quant?.weekend_sentiment

    params.set('symbol', r.symbol)
    params.set('market', toMarket(r.market))
    params.set('from', 'screener')
    params.set('screenerAction', getDisplayAction(r))
    params.set('screenerScore', r.finalScore.toFixed(0))
    params.set('decisionScore', getDecisionScore(r).toFixed(0))
    const decision = getDisplayDecision(r)
    params.set('decisionSource', decision.source)
    params.set('decisionStatus', decision.status)
    params.set('decisionReason', decision.primaryReason.slice(0, 220))

    if (r.changePercent !== null) params.set('change', r.changePercent.toFixed(2))
    if (r.rsi !== null) params.set('rsi', r.rsi.toFixed(1))
    if (r.macdSignal && r.macdSignal !== 'Sin datos') params.set('macd', r.macdSignal)
    if (sentiment?.sentiment) params.set('sentiment', sentiment.sentiment)
    if (typeof sentiment?.score === 'number') params.set('sentimentScore', String(sentiment.score))
    if (r.quant?.market_regime) params.set('regime', String(r.quant.market_regime))
    if (r.quant?.action) params.set('quantAction', String(r.quant.action))
    if (typeof r.quant?.confidence === 'number') params.set('confidence', String(r.quant.confidence))

    return `/analysis?${params.toString()}`
  }

  const bestRecommendation = useMemo(() => {
    const candidates = scanResults
      .filter((r) => !isMarketDataBlocked(r))
      .filter((r) => {
        return hasCleanBuySetup(r)
      })
      .map((r) => ({ result: r, decisionScore: getDecisionScore(r) }))
      .filter((candidate) => candidate.decisionScore >= 75)
      .sort((a, b) => b.decisionScore - a.decisionScore)

    return candidates[0] || null
  }, [scanResults])

  const recommendationReasons = bestRecommendation ? [
    `Score ${bestRecommendation.result.finalScore.toFixed(0)} / decision ${bestRecommendation.decisionScore.toFixed(0)}`,
    bestRecommendation.result.macdSignal !== 'Sin datos' ? bestRecommendation.result.macdSignal : null,
    bestRecommendation.result.rsi !== null ? `RSI ${bestRecommendation.result.rsi.toFixed(1)}` : null,
    bestRecommendation.result.quant?.weekend_sentiment?.sentiment === 'POSITIVE' ? 'FinBERT positivo' : null,
    bestRecommendation.result.quant?.weekend_sentiment?.sentiment === 'NEGATIVE' ? 'FinBERT negativo penalizado' : null,
  ].filter(Boolean) : []

  const recommendationWarnings = bestRecommendation ? [
    bestRecommendation.result.rsi !== null && bestRecommendation.result.rsi >= 70 ? 'RSI sobrecomprado' : null,
    bestRecommendation.result.changePercent !== null && bestRecommendation.result.changePercent > 6 ? 'Subida diaria muy extendida' : null,
    bestRecommendation.result.isLeveragedOrInverse ? 'Activo apalancado/inverso' : null,
    bestRecommendation.result.quant?.weekend_sentiment?.sentiment === 'NEGATIVE' ? 'Sentimiento negativo' : null,
  ].filter(Boolean) : []

  const isBullishCard = (r: FinalQuantScore) => {
    const action = getDisplayAction(r)
    return action === 'BUY' || action === 'BUY (Tech)'
  }

  const isBearishCard = (r: FinalQuantScore) => {
    const action = getDisplayAction(r)
    return action === 'SELL' || action === 'SELL (Tech)'
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">TradeMind Intelligence</h1>
        <p className="text-sm text-gray-400 mt-1">
          {lightgbmUiReady ? 'Escaneo Quant' : 'Esperando entrenamiento LightGBM'} de {scanSymbols.length} activos en {selectedCategory?.name ?? 'Zesty'}
          {scanResponse && ` · Python top ${scanResponse.quant_processed}`}
          {scanResponse && ` · usable ${scanResponse.quant_usable ?? 0} / parcial ${scanResponse.quant_partial ?? 0} / fallo ${scanResponse.quant_failed ?? 0}`}
        </p>
      </div>

      {!isRegularMarketOpen && (
        <div className="border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Mercado US cerrado
          {marketStatus.session === 'pre' ? ' en pre-market' : marketStatus.session === 'after' ? ' en after-hours' : ''}
          . Las señales del screener quedan como candidatos para revisar; espera confirmacion con volumen real al abrir la sesion regular.
        </div>
      )}

      {/* Automatic recommendation */}
      {!scanLoading && scanResults.length > 0 && (
        <div className={cn(
          'border p-5 space-y-4',
          bestRecommendation
            ? 'bg-emerald-500/10 border-emerald-500/30'
            : 'bg-amber-500/10 border-amber-500/30'
        )}>
          {bestRecommendation ? (
            <>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center flex-shrink-0">
                    <Target className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[10px] text-emerald-300 uppercase font-bold tracking-wider">Recomendacion automatica</p>
                    <h2 className="text-xl font-bold text-white mt-1">
                      {bestRecommendation.result.symbol}
                      <span className="ml-2 text-sm font-medium text-gray-400">{bestRecommendation.result.name}</span>
                    </h2>
                    <p className="text-sm text-gray-300 mt-1">
                      {isRegularMarketOpen
                        ? 'Mejor oportunidad actual del screener por decision cuantitativa ajustada por riesgo.'
                        : 'Mejor candidato para revisar al abrir mercado regular; no se marca como entrada confirmada mientras el mercado este cerrado.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-[10px] text-gray-500 uppercase font-semibold">Decision</p>
                    <p className="text-2xl font-mono font-bold text-emerald-300">
                      {bestRecommendation.decisionScore.toFixed(0)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleSelectSymbol(bestRecommendation.result.symbol, bestRecommendation.result.market, bestRecommendation.result)}
                    className="px-4 py-2 text-sm font-semibold bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
                  >
                    {isRegularMarketOpen ? 'Analizar' : 'Revisar'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-gray-950/30 border border-gray-800/70 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase font-semibold">Senal</p>
                  <p className="text-sm font-bold text-emerald-300 mt-1">{getDisplayAction(bestRecommendation.result)}</p>
                </div>
                <div className="bg-gray-950/30 border border-gray-800/70 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase font-semibold">Precio</p>
                  <p className="text-sm font-mono font-bold text-white mt-1">
                    {bestRecommendation.result.price === null ? 'N/A' : `$${bestRecommendation.result.price.toFixed(2)}`}
                  </p>
                </div>
                <div className="bg-gray-950/30 border border-gray-800/70 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase font-semibold">Cambio</p>
                  <p className={cn('text-sm font-mono font-bold mt-1', (bestRecommendation.result.changePercent ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300')}>
                    {bestRecommendation.result.changePercent === null ? 'N/A' : `${bestRecommendation.result.changePercent >= 0 ? '+' : ''}${bestRecommendation.result.changePercent.toFixed(2)}%`}
                  </p>
                </div>
                <div className="bg-gray-950/30 border border-gray-800/70 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase font-semibold">RSI</p>
                  <p className="text-sm font-mono font-bold text-white mt-1">
                    {bestRecommendation.result.rsi === null ? 'N/A' : bestRecommendation.result.rsi.toFixed(1)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {recommendationReasons.map((reason) => (
                  <span key={reason} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-emerald-500/10 text-emerald-200 border border-emerald-500/20">
                    <ShieldCheck className="w-3 h-3" />
                    {reason}
                  </span>
                ))}
                {recommendationWarnings.map((warning) => (
                  <span key={warning} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-amber-500/10 text-amber-200 border border-amber-500/20">
                    <AlertTriangle className="w-3 h-3" />
                    {warning}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-300 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[10px] text-amber-300 uppercase font-bold tracking-wider">Recomendacion automatica</p>
                <h2 className="text-lg font-bold text-white mt-1">No hay compra clara ahora</h2>
                <p className="text-sm text-gray-300 mt-1">
                  El screener no encontro una oportunidad BUY con datos suficientes y riesgo aceptable en esta categoria.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Top Cards Panel */}
      {topCards.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            Top Activos (Quant Engine)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {topCards.map((r, i) => {
              const decision = getDisplayDecision(r)
              return (
              <Link
                key={`${r.symbol}-${i}`}
                href={buildAnalysisHref(r)}
                className={cn(
                  'p-4 rounded-xl border transition-all hover:scale-[1.02]',
                  isBullishCard(r)
                    ? 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15'
                    : isBearishCard(r)
                    ? 'bg-red-500/10 border-red-500/30 hover:bg-red-500/15'
                    : 'bg-gray-800/40 border-gray-700 hover:bg-gray-800'
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex flex-col gap-1">
                    <span className={cn(
                      'text-[10px] font-bold px-1.5 py-0.5 rounded leading-none w-fit',
                      isBullishCard(r) ? 'bg-emerald-500/20 text-emerald-400'
                        : isBearishCard(r) ? 'bg-red-500/20 text-red-400'
                        : 'bg-gray-700 text-gray-300'
                    )}>
                      {decision.action}
                    </span>
                    <span className="text-xs font-semibold text-white truncate max-w-[150px]" title={r.name}>{r.name}</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-mono text-gray-300 bg-gray-900 px-2 py-0.5 rounded shadow-inner">
                      {r.symbol}
                    </span>
                    <span className="text-[10px] text-gray-500">Score: {r.finalScore.toFixed(0)}</span>
                  </div>
                </div>

                {/* Transparency Badges */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {r.quant ? (
                    <span className={cn('px-1.5 py-0.5 text-[9px] font-bold rounded', getPythonBadge(r).className)}>
                      [{getPythonBadge(r).label}]
                    </span>
                  ) : hasUsableQuantData(r) ? (
                    <span className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 text-[9px] font-bold rounded">
                      [Python OK]
                    </span>
                  ) : r.quant && hasIncompleteQuantData(r) ? (
                    <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 text-[9px] font-bold rounded">
                      [Python parcial]
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 bg-gray-800 text-gray-400 text-[9px] font-bold rounded">
                      [Filtro Rápido]
                    </span>
                  )}
                  {r.quant?.weekend_sentiment?.sentiment === 'POSITIVE' && (
                    <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 text-[9px] font-bold rounded">
                      [FinBERT Positivo]
                    </span>
                  )}
                  {r.quant?.weekend_sentiment?.sentiment === 'NEGATIVE' && (
                    <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[9px] font-bold rounded">
                      [FinBERT Negativo]
                    </span>
                  )}
                </div>

                {r.quant && (
                   <div className="text-[10px] text-gray-400 mb-2 mt-1 space-y-1">
                     <div className="flex justify-between">
                       <span>Confianza:</span>
                       <span className="text-white font-mono">{formatConfidence(r.quant.confidence)}</span>
                     </div>
                     <div className="flex justify-between">
                       <span>Régimen:</span>
                       <span className="text-white truncate max-w-[100px]">
                         {String(r.quant.market_regime || '').toLowerCase() === 'unknown' ? 'Sin datos HMM' : r.quant.market_regime}
                       </span>
                     </div>
                   </div>
                )}
                {!r.quant && r.suggestions.length > 0 && (
                   <div className="text-[10px] text-gray-400 mb-2 mt-1 space-y-1">
                     <p className="truncate">{r.suggestions[0]?.label}</p>
                   </div>
                )}

                <div className="mb-2 rounded-lg border border-gray-800/70 bg-gray-950/30 p-2 text-[10px] text-gray-400">
                  <div className="flex items-center justify-between gap-2">
                    <span className="uppercase font-semibold text-gray-500">Motivo {decision.action}</span>
                    <span className="font-mono text-gray-300">{decision.source} · {decision.status}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-gray-300" title={decision.details.join(' | ')}>
                    {decision.primaryReason}
                  </p>
                  {getProviderSummary(r) && (
                    <p className="mt-1 truncate font-mono text-[9px] text-cyan-300/80" title={getProviderSummary(r) || undefined}>
                      DATA {getProviderSummary(r)}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 text-xs text-gray-500 mt-2 border-t border-gray-800/50 pt-2">
                  <Eye className="w-3 h-3" />
                  <span>Ver análisis</span>
                  <ChevronRight className="w-3 h-3 ml-auto" />
                </div>
              </Link>
            )})}
          </div>
        </div>
      )}

      {mlRankings.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
            <Zap className={cn('w-3.5 h-3.5', lightgbmUiReady ? 'text-emerald-400' : 'text-amber-300')} />
            {lightgbmUiReady ? 'Top Ranking (ML LightGBM)' : 'Top Ranking tecnico (fallback)'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {mlRankings.slice(0, 9).map((r, i) => (
              <div
                key={i}
                className={cn(
                  'p-4 rounded-xl border',
                  lightgbmUiReady ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-white">{r.symbol}</span>
                  <span className="text-[10px] text-gray-500">Rank: #{r.rank}</span>
                </div>
                <div className="text-[10px] text-gray-400 space-y-1">
                  <p>Score ML: <span className="text-white font-mono">{Number(r.score).toFixed(4)}</span></p>
                  <p>Action: <span className="text-emerald-400 font-bold">{r.signal}</span></p>
                  {r.main_reasons?.map((reason: string, idx: number) => (
                    <p key={idx} className="truncate text-gray-500" title={reason}>- {reason}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {scanLoading && (
        <div className="p-8 text-center rounded-xl border border-gray-800 bg-gray-900/30">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500">Escaneando mercado con el quant-engine conectado...</p>
        </div>
      )}

      {scanIsError && !scanLoading && (
        <div className="p-6 text-center rounded-xl border border-red-500/25 bg-red-500/10">
          <AlertTriangle className="w-7 h-7 text-red-300 mx-auto mb-2" />
          <p className="text-sm font-semibold text-white">El escaneo cuantitativo no respondió a tiempo</p>
          <p className="text-xs text-gray-400 mt-1">
            {scanError instanceof Error && scanError.name === 'AbortError'
              ? 'Se cortó automáticamente después de 60 segundos.'
              : scanError instanceof Error ? scanError.message : 'Intenta recalcular de nuevo.'}
          </p>
        </div>
      )}

      {/* Estado del Motor Cuant (Panel de Diagnóstico) */}
      <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              Estado del Motor Cuant
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setForceQuantRefreshNonce(Date.now())}
              disabled={scanLoading || !lightgbmUiReady}
              className="px-3 py-1.5 text-xs font-semibold bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-lg transition-all"
            >
              Recalcular sin cache quant
            </button>
            <button
              onClick={triggerManualSentimentScan}
              disabled={isScanningSentiment}
              className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-all"
            >
              {isScanningSentiment ? 'Actualizando sentimiento...' : 'Escanear Noticias (FinBERT)'}
            </button>
            <button
              onClick={triggerMLRanking}
              disabled={isRanking}
              className="px-3 py-1.5 text-xs font-semibold bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white rounded-lg transition-all flex items-center gap-1"
            >
              <Zap className="w-3 h-3" />
              {isRanking ? 'Rankeando...' : 'Ranking LightGBM'}
            </button>
          </div>
        </div>

        {mlExecution && (
          <div className={cn(
            'rounded-lg border p-3 text-[11px]',
            mlExecution.status === 'running'
              ? 'border-cyan-500/40 bg-cyan-500/10'
              : mlExecution.status === 'trained'
                ? 'border-emerald-500/40 bg-emerald-500/10'
                : mlExecution.status === 'error'
                  ? 'border-red-500/40 bg-red-500/10'
                  : 'border-amber-500/40 bg-amber-500/10'
          )}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {mlExecution.status === 'running'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-300" />
                  : <Zap className="w-3.5 h-3.5 text-cyan-300" />}
                <p className="font-semibold text-white">
                  {mlExecution.status === 'trained' ? 'LightGBM real conectado' : 'Fallback tecnico activo'}
                </p>
              </div>
              <span className="font-mono uppercase text-gray-300">{mlExecution.status}</span>
            </div>
            <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 font-mono text-gray-300">
              <p>Etapa: <span className="text-white">{mlExecution.stage}</span></p>
              <p>Activos enviados: <span className="text-white">{mlExecution.symbols ?? '-'}</span></p>
              <p>Activos entrenados: <span className="text-white">{mlExecution.trainingSymbols ?? '-'}</span></p>
              <p>Prefiltro ML: <span className="text-white">{mlExecution.prefilter ? `${mlExecution.prefilter.selected_symbols}/${mlExecution.prefilter.universe_symbols}` : '-'}</span></p>
              <p>Inicio: <span className="text-white">{mlExecution.startedAt ?? '-'}</span></p>
              <p>Fin: <span className="text-white">{mlExecution.finishedAt ?? '-'}</span></p>
              <p>Modelo: <span className="text-white">{mlExecution.modelStatus ?? '-'}</span></p>
            </div>
            {mlExecution.modelPath && (
              <p className="mt-2 truncate font-mono text-[10px] text-emerald-300" title={mlExecution.modelPath}>
                Modelo local: {mlExecution.modelPath}
              </p>
            )}
            {mlExecution.warning && (
              <p className="mt-2 text-[10px] text-amber-300">
                Aviso: {formatQuantEngineWarning(mlExecution.warning)}
              </p>
            )}
          </div>
        )}

        {scanAudit && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
            <div className="bg-gray-900/30 p-3 rounded-lg border border-gray-800/60">
              <p className="text-[10px] text-gray-500 uppercase font-semibold">Lectura universo</p>
              <p className="font-mono text-white mt-1">
                {scanAudit.quote_found}/{scanAudit.universe_requested} precios
              </p>
              <p className="text-gray-400 font-mono">
                TA {scanAudit.candles_usable_for_ta} · ML {scanAudit.candles_usable_for_ml}
              </p>
            </div>
            <div className="bg-gray-900/30 p-3 rounded-lg border border-gray-800/60">
              <p className="text-[10px] text-gray-500 uppercase font-semibold">Motor Python</p>
              <p className="font-mono text-white mt-1">
                {scanAudit.python_candidates_count}/{scanAudit.python_candidate_limit} enviados
              </p>
              <p className="text-gray-400 font-mono">
                cache {scanAudit.quant_cache_hits} · vivo {scanAudit.quant_live_requests}
              </p>
            </div>
            <div className="bg-gray-900/30 p-3 rounded-lg border border-gray-800/60">
              <p className="text-[10px] text-gray-500 uppercase font-semibold">Python bruto</p>
              <p className="font-mono text-white mt-1">
                BUY {scanAudit.raw_python_buy} · SELL {scanAudit.raw_python_sell}
              </p>
              <p className="text-gray-400 font-mono">HOLD {scanAudit.raw_python_hold}</p>
            </div>
            <div className="bg-gray-900/30 p-3 rounded-lg border border-gray-800/60">
              <p className="text-[10px] text-gray-500 uppercase font-semibold">Señal final</p>
              <p className="font-mono text-white mt-1">
                BUY {scanAudit.final_buy} · SELL {scanAudit.final_sell}
              </p>
              <p className="text-gray-400 font-mono">
                HOLD {scanAudit.final_hold} · excluidos {scanAudit.deprioritized_leveraged_or_inverse}
              </p>
            </div>
          </div>
        )}

      </div>

      {/* Category tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            className={cn('px-3 py-1.5 text-sm font-medium rounded-lg transition-all', category === cat.id ? 'bg-emerald-500 text-white' : 'text-gray-400 hover:text-white bg-gray-800/50')}
          >
            {cat.name} <span className={cn('ml-1 text-xs', category === cat.id ? 'opacity-70' : 'opacity-50')}>{cat.symbols.length}</span>
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar símbolo..." className="w-full pl-9 pr-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 outline-none focus:border-emerald-500" />
        </div>
        <div className="flex items-center gap-1">
          {([ { key: 'all', label: 'Todos' }, { key: 'opportunities', label: 'Señales' }, { key: 'warnings', label: 'Alertas' } ] as const).map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} className={cn('px-3 py-1.5 text-sm font-medium rounded-lg transition-all', filter === f.key ? (f.key === 'opportunities' ? 'bg-emerald-500 text-white' : f.key === 'warnings' ? 'bg-red-500 text-white' : 'bg-gray-700 text-white') : 'text-gray-400 hover:text-white bg-gray-800/50')}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="glass rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Activo</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Score</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Precio</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cambio %</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Quant</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">RSI</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">MACD</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Señales</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {!scanLoading && filtered.map((r) => (
                <tr
                  key={r.symbol}
                  onClick={() => handleSelectSymbol(r.symbol, r.market, r)}
                  className={cn(
                    'hover:bg-gray-800/20 transition-colors cursor-pointer',
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-gray-400">{r.symbol.slice(0, 2)}</span>
                      </div>
                      <div>
                        <p className="font-mono font-semibold text-white">{r.symbol}</p>
                        <p className="text-xs text-gray-500 max-w-36 truncate">{r.name}</p>
                        {r.marketDataQuality?.provider ? (
                          <p className="text-[10px] text-cyan-300/80 max-w-36 truncate">
                            DATA: {r.marketDataQuality.provider}
                            {r.providerFallback?.fallback_used ? ' fallback' : ''}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">
                    <span className={cn(r.finalScore > 60 ? 'text-emerald-400' : r.finalScore < 40 ? 'text-red-400' : 'text-gray-300')}>
                      {r.finalScore.toFixed(0)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">
                    {r.noData || r.price === null ? <span className="text-gray-500">—</span> : <span className="text-white">${r.price.toFixed(2)}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.noData || r.changePercent === null ? <span className="text-gray-500">—</span> : (
                      <span className={cn('flex items-center justify-end gap-0.5 font-mono font-semibold text-sm', r.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {r.changePercent >= 0 ? '+' : ''}{r.changePercent.toFixed(2)}%
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.signalQuality ? (
                      <span className={cn(
                        'text-xs font-bold px-2 py-1 rounded',
                        r.signalQuality.signal_status === 'OK'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : r.signalQuality.signal_status === 'CONFLICTED'
                            ? 'bg-amber-500/20 text-amber-300'
                            : r.signalQuality.signal_status === 'BLOCKED'
                              ? 'bg-red-500/15 text-red-300'
                              : 'bg-gray-800 text-gray-400'
                      )}>
                        {r.signalQuality.signal_status}
                      </span>
                    ) : r.quant ? (
                      <span className={cn('text-xs font-bold px-2 py-1 rounded', r.quant.action === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : r.quant.action === 'SELL' ? 'bg-red-500/20 text-red-400' : 'bg-gray-800 text-gray-400')}>
                        {hasIncompleteQuantData(r) ? 'PARCIAL' : r.quant.action}
                      </span>
                    ) : r.marketDataQuality && !r.marketDataQuality.usable_for_ml ? (
                      <span className={cn(
                        'text-xs font-bold px-2 py-1 rounded',
                        r.marketDataQuality.usable_for_chart
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-red-500/15 text-red-300'
                      )}>
                        DATA
                      </span>
                    ) : (
                      <span className="text-[10px] text-gray-600">N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {r.noData || r.rsi === null ? <span className="text-gray-500">—</span> : <span className={cn('text-sm font-semibold', r.rsi > 70 ? 'text-red-400' : r.rsi < 30 ? 'text-emerald-400' : 'text-gray-400')}>{r.rsi.toFixed(1)}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.noData || r.macdSignal === 'Sin datos' ? <span className="text-gray-500">—</span> : <span className={cn('text-xs font-semibold', r.macdSignal.includes('alcista') || r.macdSignal === 'Positivo' ? 'text-emerald-400' : 'text-red-400')}>{r.macdSignal}</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.noData ? <span className="text-gray-500">—</span> : r.suggestions.length > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-gray-800 text-gray-300">
                        {r.suggestions.length} señal(es)
                      </span>
                    ) : <span className="text-xs text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={buildAnalysisHref(r)} onClick={(e) => e.stopPropagation()} className="text-gray-500 hover:text-emerald-400 transition-colors">
                      <ArrowRightLeft className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
