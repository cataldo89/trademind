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

type SentimentExecution = {
  status: 'idle' | 'running' | 'applied' | 'cache' | 'not_applied' | 'partial' | 'error'
  message: string
  processed?: number
  skippedCached?: number
  finishedAt?: string
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
    return 'Modo fallback tecnico: el Ranking ML rapido no respondio para esta ejecucion. El ranking visible usa datos tecnicos locales.'
  }
  return message
}

function formatSentimentWarning(value: unknown) {
  const message = typeof value === 'string' ? value : ''
  if (!message || message === 'Quant engine request failed') {
    return 'Error de conexion con el motor: no se aplico sentimiento nuevo y se ignoro cualquier cache obsoleto.'
  }
  return message
}

function toMarket(value: string | Market | undefined): Market {
  return value === 'CL' ? 'CL' : 'US'
}

export function translateReason(reason: string | undefined | null): string {
  if (!reason) return ''
  const trimmed = reason.trim()
  const dictionary: Record<string, string> = {
    'strong_momentum': 'Fuerte impulso alcista',
    'above_sma_20': 'Precio sobre SMA 20 (tendencia alcista)',
    'low_drawdown': 'Baja caída reciente (Drawdown bajo)',
    'crypto_policy_blocks_lightgbm': 'Política de riesgo bloquea LightGBM',
    'Extremely short history: disable gradient boosting to avoid overfit.': 'Historial muy corto: bloquea ML avanzado para evitar sobreajuste',
    'Short history: prefer Ridge, Elastic Net, logistic or defensive technical models.': 'Historial corto: prefiere modelos técnicos defensivos',
    'Moderate history: use regularized validation, not unconstrained boosting.': 'Historial moderado: requiere validación regularizada',
    'oversold': 'Sobrevendido (RSI bajo)',
    'insufficient_data': 'Datos insuficientes',
    'local_heuristic': 'Heurística cuantitativa local',
    'positive_5d_momentum': 'Impulso positivo a 5 días',
    'positive_20d_momentum': 'Impulso positivo a 20 días',
    'Alpaca CRXL reports many zero-volume midpoint bars; liquidity heuristic limits confidence.': 'Alpaca reporta muchas barras sin volumen; liquidez limita confianza',
    'Zero-volume midpoint bars detected; confidence reduced.': 'Barras sin volumen detectadas; confianza reducida',
    'Non-crypto asset; standard workflow applies.': 'Activo tradicional (no cripto)',
    'No policy found for this crypto symbol; using technical defensive fallback.': 'Sin política específica; usando fallback técnico defensivo',
    'Stablecoin: model peg deviation, liquidity, spread and depeg risk, not directional trend.': 'Establecoin: riesgo de paridad y liquidez, sin tendencia direccional',
    'SKY requires MKR history transfer adjusted by 1:24000 before robust boosting.': 'SKY requiere transferencia de historial MKR antes de boosting',
    'Market data quality blocks ML.': 'La calidad de datos bloquea ML avanzado',
  }
  return dictionary[trimmed] || reason
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
  const [sentimentExecution, setSentimentExecution] = useState<SentimentExecution>({
    status: 'idle',
    message: 'Sin actualizacion manual en esta sesion.',
  })
  const [isQuantScanEnabled, setIsQuantScanEnabled] = useState(false)
  const [forceQuantRefreshNonce, setForceQuantRefreshNonce] = useState(0)
  const [forceQuantRefreshCategory, setForceQuantRefreshCategory] = useState<string | null>(null)
  const [marketStatus, setMarketStatus] = useState(() => getUSMarketStatus())
  const [showPipelineInspector, setShowPipelineInspector] = useState(true)
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
    setSentimentExecution({
      status: 'running',
      message: `Revisando cache y noticias para hasta ${SENTIMENT_SCAN_SYMBOL_LIMIT} activos...`,
    })
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
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        throw new Error('La sesion expiro o la API devolvio una pagina HTML. Vuelve a iniciar sesion y reintenta.')
      }
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Falló el escaneo de sentimiento')
      if (body?.degraded && Number(body?.processed || 0) === 0) {
        const warning = formatSentimentWarning(body.warning || body.rawWarning)
        setSentimentExecution({
          status: 'error',
          message: warning,
          processed: 0,
          skippedCached: Number(body?.skippedCached || 0),
          finishedAt: new Date().toLocaleTimeString(),
        })
        toast.error(warning)
        return
      }
      const processed = Number(body?.processed || 0)
      const skippedCached = Number(body?.skippedCached || 0)
      const suffix = body?.truncated ? ` (lote limitado a ${body.limit})` : ''
      const scanMessage = processed > 0
        ? `FinBERT actualizÃ³ ${processed} activo(s); ${skippedCached} ya tenÃ­an cache fresco${suffix}.`
        : `${skippedCached} activo(s) ya tenÃ­an sentimiento fresco.`
      if (body?.degraded) {
        toast.warning(formatSentimentWarning(body.warning || body.rawWarning) || 'FinBERT actualizo parcialmente el lote.')
      }
      toast.success(`${scanMessage} Recalculando ranking...`)
      await queryClient.invalidateQueries({ queryKey: ['screener-quant-scan', category] })
      await queryClient.refetchQueries({ queryKey: ['screener-quant-scan', category], type: 'active' })
      setSentimentExecution({
        status: processed > 0 ? (body?.degraded ? 'partial' : 'applied') : 'cache',
        message: processed > 0
          ? `${scanMessage} Ranking recalculado con sentimiento vigente.`
          : 'No se pidieron noticias nuevas: todos los activos del lote ya tenian cache fresco.',
        processed,
        skippedCached,
        finishedAt: new Date().toLocaleTimeString(),
      })
      toast.success('Top Activos recalculado con el sentimiento vigente.')

      // Si el usuario ya tenía el motor abierto para un símbolo, re-evaluarlo para mostrar las noticias frescas
    } catch (e: unknown) {
      const message = formatSentimentWarning(e instanceof Error ? e.message : String(e))
      setSentimentExecution({
        status: 'error',
        message: 'Noticias no actualizadas: ' + message,
        finishedAt: new Date().toLocaleTimeString(),
      })
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
    toast.info('Entrenando Ranking ML rapido con LightGBM...')
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
          toast.warning(`Ranking tecnico fallback para ${fallbackRankings.length} activos. El Ranking ML rapido sigue bloqueado hasta que Cloudflare/FastAPI respondan.`)
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
        toast.error('Ranking ML rapido no esta listo: el resultado quedo bloqueado porque el quant-engine esta en fallback.')
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
      toast.success(`Ranking ML rapido completado para ${body.count} activos.`)
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
  const normalizedSearch = search.trim().toLowerCase()
  const detailedScanSymbols = normalizedSearch
    ? scanSymbols.filter((item) =>
      item.symbol.toLowerCase().includes(normalizedSearch) ||
      item.name.toLowerCase().includes(normalizedSearch)
    )
    : scanSymbols
  const shouldRunDetailedScan = detailedScanSymbols.length > 0
    && forceQuantRefreshNonce > 0
    && forceQuantRefreshCategory === category

  const { data: scanResponse, isFetching: scanLoading, isError: scanIsError, error: scanError } = useQuery({
    queryKey: ['screener-quant-scan', category, normalizedSearch, forceQuantRefreshCategory, forceQuantRefreshNonce],
    queryFn: async () => {
      const symbols = Array.from(new Set(detailedScanSymbols.map((s) => s.symbol).filter(Boolean)))
      if (symbols.length === 0) return null

      const symbolMap: Record<string, string> = {}
      const symbolMarkets: Record<string, Market> = {}
      detailedScanSymbols.forEach(s => { symbolMap[s.symbol] = s.name })
      detailedScanSymbols.forEach(s => { symbolMarkets[s.symbol] = s.market })

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
    enabled: shouldRunDetailedScan,
  })

  const scanResults: FinalQuantScore[] = scanResponse?.results || []
  const scanAudit = scanResponse?.scan_audit
  const isRegularMarketOpen = marketStatus.isOpen && marketStatus.session === 'regular'
  const isCryptoCategory = selectedCategory?.id === 'zesty-alpaca-crypto'
    || (scanSymbols.length > 0 && scanSymbols.every((s) => s.symbol.endsWith('-USD')))
  const isMarketActionable = isCryptoCategory || isRegularMarketOpen
  const showCatalogFallback = !scanLoading && scanResults.length === 0 && scanSymbols.length > 0
  const hasFastRanking = mlRankings.length > 0

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

  const catalogFallbackRows = showCatalogFallback
    ? scanSymbols
      .filter((item) => {
        if (!search) return true
        return item.symbol.toLowerCase().includes(search.toLowerCase()) || item.name.toLowerCase().includes(search.toLowerCase())
      })
      .slice(0, 50)
    : []

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

  const getCryptoModelBadge = (r: FinalQuantScore) => {
    const decision = r.cryptoMlDecision || r.quant?.crypto_ml_decision
    if (!decision?.isCrypto) return null
    if (decision.lightgbmAllowed) {
      return { label: 'LightGBM apto', className: 'bg-emerald-500/20 text-emerald-300' }
    }
    if (decision.isStablecoin) {
      return { label: 'Paridad', className: 'bg-cyan-500/15 text-cyan-300' }
    }
    const label = decision.modelFamily === 'technical_defensive'
      ? 'Técnico defensivo'
      : decision.modelFamily === 'transfer_learning'
      ? 'Transfer learning'
      : decision.modelFamily
    return { label, className: 'bg-amber-500/20 text-amber-300' }
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
      r.cryptoMlDecision?.isCrypto ? `Modelo ${r.cryptoMlDecision.model}` : null,
      r.cryptoMlDecision?.isCrypto ? `Historial ${r.cryptoMlDecision.historyCandles} velas` : null,
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

  const getActionPillClass = (action: string) => {
    const normalized = action.toUpperCase()
    if (normalized.startsWith('BUY')) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
    if (normalized.startsWith('SELL')) return 'bg-red-500/20 text-red-300 border-red-500/30'
    if (normalized.startsWith('HOLD')) return 'bg-orange-500/20 text-orange-300 border-orange-500/30'
    return 'bg-gray-800 text-gray-300 border-gray-700'
  }

  const getActionTextClass = (action: string) => {
    const normalized = action.toUpperCase()
    if (normalized.startsWith('BUY')) return 'text-emerald-300'
    if (normalized.startsWith('SELL')) return 'text-red-300'
    if (normalized.startsWith('HOLD')) return 'text-orange-300'
    return 'text-gray-300'
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

  const previewSymbols = detailedScanSymbols.slice(0, 12).map((s) => s.symbol)
  const detailedScanStatus = scanLoading
    ? 'running'
    : scanIsError
      ? 'timeout/error'
      : scanResponse
        ? 'done'
        : 'idle'
  const rankingPayloadPreview = {
    endpoint: '/api/quant/asset-rank',
    symbols: scanSymbols.slice(0, 12).map((s) => s.symbol),
    total_symbols: scanSymbols.length,
    market: 'US',
    range: '1y',
    use_model: true,
    train_local: true,
    horizon_days: 5,
  }
  const detailedPayloadPreview = {
    endpoint: '/api/quant/scan',
    symbols: previewSymbols,
    total_symbols: detailedScanSymbols.length,
    universe_symbols: scanSymbols.length,
    search: search.trim() || null,
    category,
    market: 'US',
    forceQuantRefresh: forceQuantRefreshNonce > 0,
  }
  const sentimentPayloadPreview = {
    endpoint: '/api/quant/sentiment',
    symbols: previewSymbols.slice(0, SENTIMENT_SCAN_SYMBOL_LIMIT),
    limit: SENTIMENT_SCAN_SYMBOL_LIMIT,
    freshnessMs: TOP_SENTIMENT_FRESHNESS_MS,
  }

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
          {lightgbmUiReady ? 'Escaneo Quant + LightGBM' : 'Escaneo Quant'} de {scanSymbols.length} activos en {selectedCategory?.name ?? 'Zesty'}
          {scanResponse && ` · Python top ${scanResponse.quant_processed}`}
          {scanResponse && ` · usable ${scanResponse.quant_usable ?? 0} / parcial ${scanResponse.quant_partial ?? 0} / fallo ${scanResponse.quant_failed ?? 0}`}
        </p>
      </div>

      {isCryptoCategory && (
        <div className="border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          Cripto 24/7 activo. Las senales se pueden revisar sin depender del horario regular del mercado US.
        </div>
      )}

      {!isCryptoCategory && !isRegularMarketOpen && (
        <div className="border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Mercado US cerrado
          {marketStatus.session === 'pre' ? ' en pre-market' : marketStatus.session === 'after' ? ' en after-hours' : ''}
          . Las señales del screener quedan como candidatos para revisar; espera confirmacion con volumen real al abrir la sesion regular.
        </div>
      )}

      {/* Automatic recommendation */}
      {!scanLoading && scanResults.length > 0 && !hasFastRanking && (
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
                      {isMarketActionable
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
                    {isMarketActionable ? 'Analizar' : 'Revisar'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-gray-950/30 border border-gray-800/70 rounded-lg p-3">
                  <p className="text-[10px] text-gray-500 uppercase font-semibold">Senal</p>
                  <p className={cn('text-sm font-bold mt-1', getActionTextClass(getDisplayAction(bestRecommendation.result)))}>
                    {getDisplayAction(bestRecommendation.result)}
                  </p>
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
      {topCards.length > 0 && !hasFastRanking && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            Auditoria detallada por activo
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
                      'text-[10px] font-bold px-1.5 py-0.5 rounded leading-none w-fit border',
                      getActionPillClass(decision.action)
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
                  {getCryptoModelBadge(r) && (
                    <span className={cn('px-1.5 py-0.5 text-[9px] font-bold rounded', getCryptoModelBadge(r)?.className)}>
                      [{getCryptoModelBadge(r)?.label}]
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
                     {r.cryptoMlDecision?.isCrypto && (
                       <div className="flex justify-between gap-2">
                         <span>Modelo:</span>
                         <span className="text-white truncate max-w-[130px]" title={r.cryptoMlDecision.model}>
                           {r.cryptoMlDecision.model}
                         </span>
                       </div>
                     )}
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
                    {translateReason(decision.primaryReason)}
                  </p>
                  {getProviderSummary(r) && (
                    <p className="mt-1 truncate font-mono text-[9px] text-cyan-300/80" title={getProviderSummary(r) || undefined}>
                      MERCADO {getProviderSummary(r)}
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
            {lightgbmUiReady ? 'Ranking ML rapido' : 'Ranking tecnico rapido (fallback)'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {mlRankings.slice(0, 9).map((r, i) => {
              const matchingResult = scanResults.find((sr) => sr.symbol === r.symbol)
              const href = matchingResult
                ? buildAnalysisHref(matchingResult)
                : `/analysis?symbol=${encodeURIComponent(r.symbol)}&market=${encodeURIComponent(getZestySymbolMarket(r.symbol))}`
              return (
                <a
                  key={i}
                  href={href}
                  className={cn(
                    'p-4 rounded-xl border transition-all hover:scale-[1.02] block cursor-pointer select-none',
                    lightgbmUiReady 
                      ? 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15' 
                      : 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/15'
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white">{r.symbol}</span>
                    <span className="text-[10px] text-gray-500">Rank: #{r.rank}</span>
                  </div>
                  <div className="text-[10px] text-gray-400 space-y-1">
                    <p>Score ML: <span className="text-white font-mono">{Number(r.score).toFixed(4)}</span></p>
                    <p>Action: <span className={cn('font-bold', getActionTextClass(String(r.signal || 'HOLD')))}>{r.signal}</span></p>
                    {r.main_reasons?.map((reason: string, idx: number) => (
                      <p key={idx} className="truncate text-gray-500" title={translateReason(reason)}>- {translateReason(reason)}</p>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-gray-500 mt-2 border-t border-gray-800/50 pt-2">
                    <Eye className="w-3 h-3" />
                    <span>Ver análisis</span>
                    <ChevronRight className="w-3 h-3 ml-auto" />
                  </div>
                </a>
              )
            })}
          </div>
        </div>
      )}

      {scanLoading && !hasFastRanking && (
        <div className="p-8 text-center rounded-xl border border-gray-800 bg-gray-900/30">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500">Escaneo detallado por activo: validando datos, TA y workflow Python...</p>
          <p className="text-xs text-gray-600 mt-1">El ranking LightGBM es batch y puede terminar antes.</p>
        </div>
      )}

      {scanIsError && !scanLoading && !hasFastRanking && (
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
              Motor Cuant: ranking, auditoria y noticias
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setForceQuantRefreshCategory(category)
                setForceQuantRefreshNonce(Date.now())
              }}
              disabled={scanLoading}
              className="px-3 py-1.5 text-xs font-semibold bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-lg transition-all"
            >
              {normalizedSearch ? `Escanear ${detailedScanSymbols.length}` : 'Escaneo detallado'}
            </button>
            <button
              onClick={triggerManualSentimentScan}
              disabled={isScanningSentiment}
              className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-all"
            >
              {isScanningSentiment ? 'Actualizando sentimiento...' : 'Actualizar sentimiento'}
            </button>
            <button
              onClick={triggerMLRanking}
              disabled={isRanking}
              className="px-3 py-1.5 text-xs font-semibold bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white rounded-lg transition-all flex items-center gap-1"
            >
              <Zap className="w-3 h-3" />
              {isRanking ? 'Rankeando...' : 'Ranking ML rapido'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
          <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/10 p-3">
            <p className="font-semibold text-cyan-200">Ranking ML rapido</p>
            <p className="mt-1 text-gray-300">Ordena todo el universo en batch. Sirve para descubrir candidatos y es el flujo rapido.</p>
          </div>
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3">
            <p className="font-semibold text-emerald-200">Auditoria detallada</p>
            <p className="mt-1 text-gray-300">Valida activo por activo: proveedor, calidad de velas, RSI, MACD, workflow Python y bloqueos.</p>
          </div>
        </div>

        <div className={cn(
          'rounded-lg border p-3 text-[11px]',
          sentimentExecution.status === 'applied' || sentimentExecution.status === 'cache'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
            : sentimentExecution.status === 'partial' || sentimentExecution.status === 'not_applied'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
              : sentimentExecution.status === 'error'
                ? 'border-red-500/30 bg-red-500/10 text-red-100'
                : sentimentExecution.status === 'running'
                  ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-100'
                  : 'border-gray-800/70 bg-gray-950/40 text-gray-300'
        )}>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-semibold">
              Sentimiento FinBERT: <span className="font-mono uppercase">{sentimentExecution.status}</span>
            </p>
            {sentimentExecution.finishedAt && (
              <p className="font-mono text-[10px] opacity-80">Ultimo intento {sentimentExecution.finishedAt}</p>
            )}
          </div>
          <p className="mt-1 text-[11px] opacity-90">{sentimentExecution.message}</p>
          {(typeof sentimentExecution.processed === 'number' || typeof sentimentExecution.skippedCached === 'number') && (
            <p className="mt-1 font-mono text-[10px] opacity-80">
              procesados {sentimentExecution.processed ?? '-'} | cache fresco {sentimentExecution.skippedCached ?? '-'}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-gray-800/70 bg-gray-950/30">
          <button
            type="button"
            onClick={() => setShowPipelineInspector((value) => !value)}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-gray-200 hover:bg-gray-900/60"
          >
            <span>Inspector de ejecucion: endpoints, botones y activos</span>
            <span className="font-mono text-[10px] text-gray-500">{showPipelineInspector ? 'VISIBLE' : 'OCULTO'}</span>
          </button>

          {showPipelineInspector && (
            <div className="space-y-3 border-t border-gray-800/70 p-3 text-[11px]">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3">
                  <p className="font-semibold text-cyan-200">1. Ranking ML rapido</p>
                  <p className="mt-1 font-mono text-gray-300">POST /api/quant/asset-rank</p>
                  <p className="mt-1 text-gray-400">Boton: Ranking ML rapido. Resultado visible: tarjetas superiores.</p>
                  <p className="mt-1 text-gray-400">Estado: <span className="font-mono text-white">{mlExecution?.status ?? 'idle'}</span></p>
                  <p className="text-gray-400">Enviados: <span className="font-mono text-white">{scanSymbols.length}</span> / entrenados: <span className="font-mono text-white">{mlExecution?.trainingSymbols ?? '-'}</span></p>
                </div>
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
                  <p className="font-semibold text-emerald-200">2. Auditoria detallada</p>
                  <p className="mt-1 font-mono text-gray-300">POST /api/quant/scan</p>
                  <p className="mt-1 text-gray-400">Boton: Escaneo detallado. Resultado visible: diagnostico y tabla.</p>
                  <p className="mt-1 text-gray-400">Estado: <span className="font-mono text-white">{detailedScanStatus}</span></p>
                  <p className="text-gray-400">Entran al escaneo: <span className="font-mono text-white">{detailedScanSymbols.length}</span> / universo <span className="font-mono text-white">{scanSymbols.length}</span></p>
                  <p className="text-gray-400">Procesados: <span className="font-mono text-white">{scanResponse?.quant_processed ?? '-'}</span></p>
                </div>
                <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-3">
                  <p className="font-semibold text-indigo-200">3. Sentimiento FinBERT</p>
                  <p className="mt-1 font-mono text-gray-300">POST /api/quant/sentiment</p>
                  <p className="mt-1 text-gray-400">Boton: Actualizar sentimiento. No rankea solo; actualiza una feature.</p>
                  <p className="mt-1 text-gray-400">Estado: <span className="font-mono text-white">{sentimentExecution.status}</span></p>
                  <p className="mt-1 text-gray-400">Fuente default: Alpaca News. Yahoo solo si se activa por env.</p>
                  <p className="text-gray-400">Lote: <span className="font-mono text-white">{SENTIMENT_SCAN_SYMBOL_LIMIT}</span> activos.</p>
                </div>
              </div>

              <div className="rounded-lg border border-gray-800/70 bg-gray-950/50 p-3">
                <p className="font-semibold text-gray-200">Activos seleccionados</p>
                <p className="mt-1 font-mono text-cyan-200 truncate" title={scanSymbols.map((s) => s.symbol).join(', ')}>
                  {previewSymbols.join(', ')}{scanSymbols.length > previewSymbols.length ? ` ... +${scanSymbols.length - previewSymbols.length}` : ''}
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <pre className="overflow-auto rounded-lg border border-gray-800/70 bg-black/30 p-3 font-mono text-[10px] text-gray-300">{JSON.stringify(rankingPayloadPreview, null, 2)}</pre>
                <pre className="overflow-auto rounded-lg border border-gray-800/70 bg-black/30 p-3 font-mono text-[10px] text-gray-300">{JSON.stringify(detailedPayloadPreview, null, 2)}</pre>
                <pre className="overflow-auto rounded-lg border border-gray-800/70 bg-black/30 p-3 font-mono text-[10px] text-gray-300">{JSON.stringify(sentimentPayloadPreview, null, 2)}</pre>
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-amber-100">
                LightGBM todavia no hace toda la tuberia solo: Next prepara el universo/OHLCV y Python entrena-rankea. La deuda tecnica visible es mover la descarga y feature engineering completa al quant-engine y dejar el front solo como orquestador.
              </div>
            </div>
          )}
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
              {showCatalogFallback && (
                <tr>
                  <td colSpan={9} className="px-4 py-3 text-xs text-amber-300 bg-amber-500/5">
                    Mostrando catalogo de activos. Todavia no hay metricas: pulsa {normalizedSearch ? 'Escanear resultados filtrados' : 'Escaneo detallado'} para enviarlos a /api/quant/scan.
                  </td>
                </tr>
              )}
              {catalogFallbackRows.map((item) => {
                const analysisHref = `/analysis?symbol=${encodeURIComponent(item.symbol)}&market=${encodeURIComponent(toMarket(item.market))}`
                return (
                  <tr
                    key={`catalog-${item.symbol}`}
                    onClick={() => router.push(analysisHref)}
                    className="hover:bg-gray-800/20 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-gray-400">{item.symbol.slice(0, 2)}</span>
                        </div>
                        <div>
                          <Link
                            href={analysisHref}
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono font-semibold text-white hover:text-emerald-300 transition-colors"
                          >
                            {item.symbol}
                          </Link>
                          <p className="text-xs text-gray-500 max-w-36 truncate">{item.name}</p>
                          <p className="text-[10px] text-cyan-300/80 max-w-36 truncate">
                            MERCADO: sin escaneo
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-500">-</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-500">-</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-500">-</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-bold px-2 py-1 rounded bg-gray-800 text-gray-400">
                        SIN ESCANEO
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-500">-</td>
                    <td className="px-4 py-3 text-right text-gray-500">-</td>
                    <td className="px-4 py-3 text-center">
                      <Link
                        href={analysisHref}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full border bg-gray-800 text-gray-300 border-gray-700 transition-colors hover:brightness-125"
                      >
                        Revisar
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={analysisHref} onClick={(e) => e.stopPropagation()} className="text-gray-500 hover:text-emerald-400 transition-colors">
                        <ArrowRightLeft className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                )
              })}
              {!scanLoading && filtered.map((r) => {
                const analysisHref = buildAnalysisHref(r)
                return (
                <tr
                  key={r.symbol}
                  onClick={() => router.push(analysisHref)}
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
                        <Link
                          href={analysisHref}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono font-semibold text-white hover:text-emerald-300 transition-colors"
                        >
                          {r.symbol}
                        </Link>
                        <p className="text-xs text-gray-500 max-w-36 truncate">{r.name}</p>
                        {r.marketDataQuality?.provider ? (
                          <p className="text-[10px] text-cyan-300/80 max-w-36 truncate">
                            {/* DATA: {r.marketDataQuality.provider} legacy contract; visible label is market-data specific. */}
                            MERCADO: {r.marketDataQuality.provider}
                            {r.providerFallback?.fallback_used ? ' fallback' : ''}
                          </p>
                        ) : null}
                        {r.cryptoMlDecision?.isCrypto ? (
                          <p className="text-[10px] text-amber-300/80 max-w-36 truncate" title={r.cryptoMlDecision.model}>
                            ML: {r.cryptoMlDecision.engineLabel}
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
                      <span className={cn('text-xs font-bold px-2 py-1 rounded border', getActionPillClass(hasIncompleteQuantData(r) ? 'HOLD' : String(r.quant.action || 'HOLD')))}>
                        {hasIncompleteQuantData(r) ? 'PARCIAL' : r.quant.action}
                      </span>
                    ) : r.marketDataQuality && !r.marketDataQuality.usable_for_ml ? (
                      <span className={cn(
                        'text-xs font-bold px-2 py-1 rounded',
                        r.marketDataQuality.usable_for_chart
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-red-500/15 text-red-300'
                      )}>
                        MERCADO
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
                    {r.noData ? <span className="text-gray-500">—</span> : (
                      <Link
                        href={analysisHref}
                        onClick={(e) => {
                          e.stopPropagation()
                        }}
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full border transition-colors hover:brightness-125',
                          getActionPillClass(getDisplayAction(r))
                        )}
                      >
                        {getDisplayAction(r)}
                        {r.suggestions.length > 0 ? ` · ${r.suggestions.length}` : ''}
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={analysisHref} onClick={(e) => e.stopPropagation()} className="text-gray-500 hover:text-emerald-400 transition-colors">
                      <ArrowRightLeft className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
