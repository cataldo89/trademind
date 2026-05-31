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
import type { FinalQuantScore, QuantResultData } from '@/lib/ranking'
import { getUSMarketStatus } from '@/lib/market-schedule'

const SENTIMENT_SCAN_SYMBOL_LIMIT = 30
const TOP_SENTIMENT_FRESHNESS_MS = 60 * 60 * 1000

function toMarket(value: string | Market | undefined): Market {
  return value === 'CL' ? 'CL' : 'US'
}

export function ScreenerClient() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'opportunities' | 'warnings'>('all')
  const [category, setCategory] = useState('zesty-all')
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [isScanningSentiment, setIsScanningSentiment] = useState(false)
  const [marketStatus, setMarketStatus] = useState(() => getUSMarketStatus())
  const queryClient = useQueryClient()

  useEffect(() => {
    const interval = setInterval(() => {
      setMarketStatus(getUSMarketStatus())
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  const [verifyState, setVerifyState] = useState<{
    status: 'idle' | 'consultando' | 'conectado' | 'parcial' | 'error' | 'modo_basico'
    symbol: string
    timestamp: string
    endpoint: string
    latency: number | null
    httpStatus: number | null
    source: 'TypeScript frontend' | 'Python quant-engine' | 'Fallback básico'
    data: QuantResultData | null
    errorMessage?: string
  }>({
    status: 'idle',
    symbol: '',
    timestamp: '',
    endpoint: '',
    latency: null,
    httpStatus: null,
    source: 'TypeScript frontend',
    data: null,
    errorMessage: undefined
  })

  const runVerification = async (symbol: string, market = getZestySymbolMarket(symbol)) => {
    if (!symbol) return
    const start = performance.now()
    setVerifyState(prev => ({
      ...prev,
      status: 'consultando',
      symbol,
      endpoint: '/api/quant/analyze',
      latency: null,
      httpStatus: null,
      data: null,
      errorMessage: undefined
    }))

    try {
      const res = await fetch('/api/quant/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, market }),
      })
      const latency = Math.round(performance.now() - start)
      const httpStatus = res.status

      if (!res.ok) {
        let errMsg = 'Quant workflow failed';
        try {
          const errBody = await res.json();
          errMsg = errBody.error || errMsg;
        } catch {
          try {
            errMsg = await res.text() || errMsg;
          } catch {}
        }
        setVerifyState({
          status: 'modo_basico',
          symbol,
          timestamp: new Date().toLocaleTimeString(),
          endpoint: '/api/quant/analyze',
          latency,
          httpStatus,
          source: 'Fallback básico',
          data: null,
          errorMessage: errMsg
        })
        return
      }

      const body = await res.json()
      const workflowResult = body.data?.workflow_result as QuantResultData | undefined
      const diagnostic = body.diagnostic as { usable?: boolean; status?: string; reason?: string } | undefined
      setVerifyState({
        status: diagnostic?.usable === false ? 'parcial' : 'conectado',
        symbol,
        timestamp: new Date().toLocaleTimeString(),
        endpoint: '/api/quant/analyze',
        latency,
        httpStatus,
        source: 'Python quant-engine',
        data: workflowResult || null,
        errorMessage: diagnostic?.usable === false ? diagnostic.reason : undefined
      })
    } catch (err: unknown) {
      const latency = Math.round(performance.now() - start)
      setVerifyState({
        status: 'error',
        symbol,
        timestamp: new Date().toLocaleTimeString(),
        endpoint: '/api/quant/analyze',
        latency,
        httpStatus: null,
        source: 'Fallback básico',
        data: null,
        errorMessage: err instanceof Error ? err.message : String(err)
      })
    }
  }

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
      const processed = Number(body?.processed || 0)
      const skippedCached = Number(body?.skippedCached || 0)
      const suffix = body?.truncated ? ` (lote limitado a ${body.limit})` : ''
      const scanMessage = processed > 0
        ? `FinBERT actualizÃ³ ${processed} activo(s); ${skippedCached} ya tenÃ­an cache fresco${suffix}.`
        : `${skippedCached} activo(s) ya tenÃ­an sentimiento fresco.`
      toast.success(`${scanMessage} Recalculando ranking...`)
      await queryClient.invalidateQueries({ queryKey: ['screener-quant-scan', category] })
      await queryClient.refetchQueries({ queryKey: ['screener-quant-scan', category], type: 'active' })
      toast.success('Top Activos recalculado con el sentimiento vigente.')

      // Si el usuario ya tenía el motor abierto para un símbolo, re-evaluarlo para mostrar las noticias frescas
      const candidate = bestRecommendation?.result || verificationCandidate

      if (candidate?.symbol) {
        runVerification(candidate.symbol, toMarket(candidate.market))
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      toast.error('Error al escanear noticias: ' + message)
    } finally {
      setIsScanningSentiment(false)
    }
  }

  const categories = useMemo(() => getCategorizedZestySymbols(), [])
  const selectedCategory = categories.find((cat) => cat.id === category) ?? categories[0]

  // Enviar todos los activos de la categoría (con un límite de 500)
  const scanSymbols = useMemo(() => {
    return (selectedCategory?.symbols ?? [])
      .slice(0, 500)
      .map((s) => ({ ...s, market: getZestySymbolMarket(s.symbol) }))
  }, [selectedCategory])

  const { data: scanResponse, isLoading: scanLoading } = useQuery({
    queryKey: ['screener-quant-scan', category],
    queryFn: async () => {
      const symbols = Array.from(new Set(scanSymbols.map((s) => s.symbol).filter(Boolean)))
      if (symbols.length === 0) return null

      const symbolMap: Record<string, string> = {}
      const symbolMarkets: Record<string, Market> = {}
      scanSymbols.forEach(s => { symbolMap[s.symbol] = s.name })
      scanSymbols.forEach(s => { symbolMarkets[s.symbol] = s.market })

      const res = await fetch('/api/quant/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, category, market: 'US', symbolMap, symbolMarkets })
      })

      if (!res.ok) throw new Error('Failed to fetch scan results')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  })

  const scanResults: FinalQuantScore[] = scanResponse?.results || []
  const isRegularMarketOpen = marketStatus.isOpen && marketStatus.session === 'regular'

  // Top candidates para las tarjetas
  const topCards = scanResults.slice(0, 9).filter(r => !r.noData)

  const filtered = scanResults
    .filter(r => !r.noData) // Filtrar acciones sin datos (N/A)
    .filter(r => {
      if (filter === 'opportunities') return r.suggestions.some(s => s.type === 'opportunity') || r.quant?.action === 'BUY'
      if (filter === 'warnings') return r.suggestions.some(s => s.type === 'warning') || r.quant?.action === 'SELL'
      return true
    })
    .filter(r => {
      if (!search) return true
      return r.symbol.toLowerCase().includes(search.toLowerCase()) || r.name.toLowerCase().includes(search.toLowerCase())
    })
    .slice(0, 50) // Limitar la tabla a 50 resultados para evitar scroll infinito

  const verificationCandidate = useMemo(() => {
    return filtered[0] || scanResults.find((result) => !result.noData) || scanSymbols[0] || null
  }, [filtered, scanResults, scanSymbols])

  const hasUsableQuantData = (r: FinalQuantScore) => {
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

  const hasCleanBuySetup = (r: FinalQuantScore) => {
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

  const getDisplayAction = (r: FinalQuantScore) => {
    if (hasUsableQuantData(r) && (r.quant?.action === 'BUY' || r.quant?.action === 'SELL')) return r.quant.action
    if (hasCleanBuySetup(r)) return 'BUY (Tech)'
    if (r.finalScore <= 40 || r.macdSignal.includes('bajista')) return 'SELL (Tech)'
    return 'HOLD'
  }

  const getDecisionScore = (r: FinalQuantScore) => {
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
      .filter((r) => !r.noData)
      .filter((r) => {
        const action = getDisplayAction(r)
        return (action === 'BUY' || action === 'BUY (Tech)') && hasCleanBuySetup(r)
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
          Escaneo Quant de {scanSymbols.length} activos en {selectedCategory?.name ?? 'Zesty'}
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
            {topCards.map((r, i) => (
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
                      {getDisplayAction(r)}
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
                  {hasUsableQuantData(r) ? (
                    <span className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 text-[9px] font-bold rounded">
                      [Python OK]
                    </span>
                  ) : hasIncompleteQuantData(r) ? (
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
                       <span className="text-white font-mono">{r.quant.confidence}%</span>
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

                <div className="flex items-center gap-1 text-xs text-gray-500 mt-2 border-t border-gray-800/50 pt-2">
                  <Eye className="w-3 h-3" />
                  <span>Ver análisis</span>
                  <ChevronRight className="w-3 h-3 ml-auto" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {scanLoading && (
        <div className="p-8 text-center rounded-xl border border-gray-800 bg-gray-900/30">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500">Escaneando mercados con Engine Quant...</p>
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
              onClick={triggerManualSentimentScan}
              disabled={isScanningSentiment}
              className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-all"
            >
              {isScanningSentiment ? 'Actualizando sentimiento...' : 'Escanear Noticias (FinBERT)'}
            </button>
            <button
              onClick={() => verificationCandidate?.symbol && runVerification(verificationCandidate.symbol, toMarket(verificationCandidate.market))}
              disabled={verifyState.status === 'consultando'}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg transition-all"
            >
              {verifyState.status === 'consultando'
                ? 'Probando...'
                : verificationCandidate?.symbol
                  ? `Probar motor con ${verificationCandidate.symbol}`
                  : 'Probar motor'}
            </button>
          </div>
        </div>

        {/* Status Message */}
        {verifyState.symbol && (
          <div className={cn(
            "text-xs px-3 py-2 rounded-lg border font-medium flex items-center justify-between flex-wrap gap-2",
            verifyState.status === 'conectado'
              ? "bg-emerald-500/5 text-emerald-400 border-emerald-500/20"
              : verifyState.status === 'consultando'
              ? "bg-amber-500/5 text-amber-400 border-amber-500/20 animate-pulse"
              : verifyState.status === 'parcial'
              ? "bg-amber-500/5 text-amber-300 border-amber-500/20"
              : verifyState.status === 'modo_basico'
              ? "bg-gray-800/40 text-gray-400 border-gray-700"
              : "bg-red-500/5 text-red-400 border-red-500/20"
          )}>
            <div className="flex flex-col gap-0.5">
              <span>
                {verifyState.status === 'conectado' ? `Motor Quant conectado con datos utiles para: ${verifyState.symbol}`
                  : verifyState.status === 'consultando' ? `Consultando Python para: ${verifyState.symbol}...`
                  : verifyState.status === 'parcial' ? `Motor respondio para ${verifyState.symbol}, pero el analisis es parcial`
                  : verifyState.status === 'modo_basico' ? `Python no disponible para ${verifyState.symbol}, usando modo básico`
                  : `Error en consulta para: ${verifyState.symbol}`}
              </span>
              {verifyState.errorMessage && (
                <span className="text-[10px] text-red-400 font-mono mt-0.5 bg-red-950/20 px-1.5 py-0.5 rounded border border-red-900/30">
                  Real Error: {verifyState.errorMessage}
                </span>
              )}
            </div>
            <span className="text-[10px] opacity-75 font-mono">{verifyState.timestamp}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-900/30 p-3 rounded-lg border border-gray-800/60 space-y-2.5">
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-semibold">Estado de conexión</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn(
                  "w-2 h-2 rounded-full",
                  verifyState.status === 'conectado' ? "bg-emerald-400" :
                  verifyState.status === 'consultando' ? "bg-amber-400 animate-ping" :
                  verifyState.status === 'parcial' ? "bg-amber-400" :
                  verifyState.status === 'error' ? "bg-red-400" :
                  verifyState.status === 'modo_basico' ? "bg-amber-500" : "bg-gray-600"
                )} />
                <span className={cn(
                  "text-xs font-bold font-mono",
                  verifyState.status === 'conectado' ? "text-emerald-400" :
                  verifyState.status === 'consultando' ? "text-amber-400" :
                  verifyState.status === 'parcial' ? "text-amber-400" :
                  verifyState.status === 'error' ? "text-red-400" :
                  verifyState.status === 'modo_basico' ? "text-amber-500" : "text-gray-400"
                )}>
                  {verifyState.status === 'conectado' ? 'Motor Quant OK' :
                   verifyState.status === 'consultando' ? 'Consultando' :
                   verifyState.status === 'parcial' ? 'Motor parcial' :
                   verifyState.status === 'error' ? 'Error' :
                   verifyState.status === 'modo_basico' ? 'Modo básico' : 'Sin iniciar'}
                </span>
              </div>
              {verifyState.httpStatus !== null && (
                <p className="text-[10px] text-gray-400 font-mono mt-1">
                  Response Code: <span className="font-semibold text-white">HTTP {verifyState.httpStatus}</span>
                </p>
              )}
            </div>
          </div>

          <div className="bg-gray-900/30 p-3 rounded-lg border border-gray-800/60 space-y-1">
            <p className="text-[10px] text-gray-500 uppercase font-semibold mb-2">Última consulta realizada</p>
            <div className="flex justify-between text-xs font-mono text-gray-400">
              <span>Símbolo:</span><span className="text-white">{verifyState.symbol || '—'}</span>
            </div>
            <div className="flex justify-between text-xs font-mono text-gray-400">
              <span>Fuente:</span>
              <span className="text-white font-semibold">
                {verifyState.status === 'conectado' ? 'Python quant-engine' : verifyState.source || '—'}
              </span>
            </div>
            <div className="flex justify-between text-xs font-mono text-gray-400">
              <span>Latencia:</span>
              <span className={cn("text-white", verifyState.latency && verifyState.latency > 3000 ? "text-amber-400" : "text-emerald-400")}>
                {verifyState.latency ? `${verifyState.latency} ms` : '—'}
              </span>
            </div>
          </div>

          <div className="bg-gray-900/30 p-3 rounded-lg border border-gray-800/60 space-y-1">
            <p className="text-[10px] text-gray-500 uppercase font-semibold mb-2">Resultado Python</p>
            {(verifyState.status === 'conectado' || verifyState.status === 'parcial') && verifyState.data ? (
              <div className="space-y-1 text-[11px] font-mono">
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <div className="text-gray-400">Acción:</div>
                  <div className={cn("font-bold text-right", verifyState.data.action === 'BUY' ? 'text-emerald-400' : verifyState.data.action === 'SELL' ? 'text-red-400' : 'text-amber-400')}>{verifyState.data.action}</div>
                  <div className="text-gray-400">Confianza:</div>
                  <div className="text-white text-right">{verifyState.data.confidence}%</div>
                </div>
                <div className={cn(
                  "text-[9px] text-center font-bold mt-1 border rounded py-0.5",
                  verifyState.status === 'conectado'
                    ? "text-emerald-400 bg-emerald-950/20 border-emerald-900/30"
                    : "text-amber-300 bg-amber-950/20 border-amber-900/30"
                )}>
                  {verifyState.status === 'conectado' ? 'Resultado util desde Python' : 'Respuesta parcial desde Python'}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-12 text-xs text-gray-500 font-mono italic">Sin datos</div>
            )}
          </div>
        </div>

        {/* Panel de Noticias Leídas por FinBERT */}
        {(verifyState.status === 'conectado' || verifyState.status === 'parcial') && verifyState.data?.news_articles && (
          <div className="bg-gray-900/30 p-3 rounded-lg border border-gray-800/60 mt-4 space-y-2">
            <p className="text-[10px] text-gray-500 uppercase font-semibold">
              Titulares leídos por FinBERT <span className={cn('ml-1 px-1.5 py-0.5 rounded text-[9px]', verifyState.data.news_sentiment === 'POSITIVE' ? 'bg-emerald-500/20 text-emerald-400' : verifyState.data.news_sentiment === 'NEGATIVE' ? 'bg-red-500/20 text-red-400' : 'bg-gray-800 text-gray-400')}>{verifyState.data.news_sentiment}</span>
            </p>
            {verifyState.data.news_articles.length > 0 ? (
              <ul className="text-[11px] text-gray-300 space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                {verifyState.data.news_articles.map((news, idx) => (
                  <li key={idx} className="border-b border-gray-800/50 pb-1.5 last:border-0 leading-relaxed font-mono">
                    <span className="text-emerald-500 mr-2">›</span>{news}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[11px] text-gray-500 font-mono italic py-2">
                No se encontraron noticias recientes o Yahoo Finance bloqueó la consulta (Rate Limit).
              </div>
            )}
          </div>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => { setCategory(cat.id); setSelectedSymbol(null) }}
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
                    selectedSymbol === r.symbol ? 'bg-emerald-500/5' : ''
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
                    {r.quant ? (
                      <span className={cn('text-xs font-bold px-2 py-1 rounded', r.quant.action === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : r.quant.action === 'SELL' ? 'bg-red-500/20 text-red-400' : 'bg-gray-800 text-gray-400')}>
                        {hasIncompleteQuantData(r) ? 'PARCIAL' : r.quant.action}
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
