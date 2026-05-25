'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCategorizedZestySymbols } from '@/lib/market-data'
import { Market } from '@/types'
import { cn } from '@/lib/utils'
import {
  ArrowUp, ArrowDown, ArrowRightLeft,
  AlertCircle, Loader2, Search, ChevronRight, Activity, Eye, Zap
} from 'lucide-react'
import Link from 'next/link'
import { FinalQuantScore } from '@/lib/ranking'

export function ScreenerClient() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'opportunities' | 'warnings'>('all')
  const [category, setCategory] = useState('zesty-all')
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)

  const [verifyState, setVerifyState] = useState<{
    status: 'idle' | 'consultando' | 'conectado' | 'error' | 'modo_basico'
    symbol: string
    timestamp: string
    endpoint: string
    latency: number | null
    httpStatus: number | null
    source: 'TypeScript frontend' | 'Python quant-engine' | 'Fallback básico'
    data: any | null
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

  const runVerification = async (symbol: string) => {
    if (!symbol) return
    const start = Date.now()
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
        body: JSON.stringify({ symbol }),
      })
      const latency = Date.now() - start
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
      setVerifyState({
        status: 'conectado',
        symbol,
        timestamp: new Date().toLocaleTimeString(),
        endpoint: '/api/quant/analyze',
        latency,
        httpStatus,
        source: 'Python quant-engine',
        data: body.data?.workflow_result || null,
        errorMessage: undefined
      })
    } catch (err: any) {
      const latency = Date.now() - start
      setVerifyState({
        status: 'error',
        symbol,
        timestamp: new Date().toLocaleTimeString(),
        endpoint: '/api/quant/analyze',
        latency,
        httpStatus: null,
        source: 'Fallback básico',
        data: null,
        errorMessage: err.message || String(err)
      })
    }
  }

  const handleSelectSymbol = (symbol: string) => {
    if (selectedSymbol === symbol) {
      setSelectedSymbol(null)
    } else {
      setSelectedSymbol(symbol)
      runVerification(symbol)
    }
  }

  const categories = useMemo(() => getCategorizedZestySymbols(), [])
  const selectedCategory = categories.find((cat) => cat.id === category) ?? categories[0]
  
  // Enviar todos los activos de la categoría (con un límite de 500)
  const scanSymbols = useMemo(() => {
    return (selectedCategory?.symbols ?? [])
      .slice(0, 500)
      .map((s) => ({ ...s, market: 'US' as Market }))
  }, [selectedCategory])

  const categoryTotal = selectedCategory?.symbols.length ?? 0

  const { data: scanResponse, isLoading: scanLoading } = useQuery({
    queryKey: ['screener-quant-scan', category],
    queryFn: async () => {
      const symbols = Array.from(new Set(scanSymbols.map((s) => s.symbol).filter(Boolean)))
      if (symbols.length === 0) return null

      const symbolMap: Record<string, string> = {}
      scanSymbols.forEach(s => { symbolMap[s.symbol] = s.name })

      const market = scanSymbols[0]?.market || 'US'
      const res = await fetch('/api/quant/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, category, market, symbolMap })
      })

      if (!res.ok) throw new Error('Failed to fetch scan results')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  })

  const scanResults: FinalQuantScore[] = scanResponse?.results || []

  // Top candidates para las tarjetas
  const topCards = scanResults.slice(0, 9).filter(r => !r.noData)

  const filtered = scanResults
    .filter(r => {
      if (filter === 'opportunities') return r.suggestions.some(s => s.type === 'opportunity') || r.quant?.action === 'BUY'
      if (filter === 'warnings') return r.suggestions.some(s => s.type === 'warning') || r.quant?.action === 'SELL'
      return true
    })
    .filter(r => {
      if (!search) return true
      return r.symbol.toLowerCase().includes(search.toLowerCase()) || r.name.toLowerCase().includes(search.toLowerCase())
    })

  const selectedResult = scanResults.find(r => r.symbol === selectedSymbol)

  const getDisplayAction = (r: FinalQuantScore) => {
    if (r.quant?.action === 'BUY' || r.quant?.action === 'SELL') return r.quant.action
    if (r.finalScore >= 60) return 'BUY (Tech)'
    if (r.finalScore <= 40) return 'SELL (Tech)'
    return 'HOLD'
  }

  const isBullishCard = (r: FinalQuantScore) => {
    const action = getDisplayAction(r)
    return action === 'BUY' || action === 'BUY (Tech)'
  }

  const isBearishCard = (r: FinalQuantScore) => {
    const action = getDisplayAction(r)
    return action === 'SELL' || action === 'SELL (Tech)'
  }

  const isSelectedSymbolVerifying = verifyState.symbol === selectedSymbol;
  const quantLoading = isSelectedSymbolVerifying && verifyState.status === 'consultando';
  const quantError = isSelectedSymbolVerifying && (verifyState.status === 'error' || verifyState.status === 'modo_basico');
  const quantAnalysis = isSelectedSymbolVerifying ? verifyState.data : null;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">TradeMind Intelligence</h1>
        <p className="text-sm text-gray-400 mt-1">
          Escaneo Quant de {scanSymbols.length} activos en {selectedCategory?.name ?? 'Zesty'}
          {scanResponse && ` · Python top ${scanResponse.quant_processed}`}
        </p>
      </div>

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
                href={`/analysis?symbol=${r.symbol}&market=${r.market}`}
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
                
                {r.quant && (
                   <div className="text-[10px] text-gray-400 mb-2 mt-1 space-y-1">
                     <div className="flex justify-between">
                       <span>Confianza:</span>
                       <span className="text-white font-mono">{r.quant.confidence}%</span>
                     </div>
                     <div className="flex justify-between">
                       <span>Régimen:</span>
                       <span className="text-white truncate max-w-[100px]">{r.quant.market_regime}</span>
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
          <button
            onClick={() => runVerification('AAPL')}
            disabled={verifyState.status === 'consultando'}
            className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg transition-all"
          >
            {verifyState.status === 'consultando' && verifyState.symbol === 'AAPL' ? 'Probando...' : 'Probar motor con AAPL'}
          </button>
        </div>

        {/* Status Message */}
        {verifyState.symbol && (
          <div className={cn(
            "text-xs px-3 py-2 rounded-lg border font-medium flex items-center justify-between flex-wrap gap-2",
            verifyState.status === 'conectado'
              ? "bg-emerald-500/5 text-emerald-400 border-emerald-500/20"
              : verifyState.status === 'consultando'
              ? "bg-amber-500/5 text-amber-400 border-amber-500/20 animate-pulse"
              : verifyState.status === 'modo_basico'
              ? "bg-gray-800/40 text-gray-400 border-gray-700"
              : "bg-red-500/5 text-red-400 border-red-500/20"
          )}>
            <div className="flex flex-col gap-0.5">
              <span>
                {verifyState.status === 'conectado' ? `Motor Cuántico Conectado para: ${verifyState.symbol}`
                  : verifyState.status === 'consultando' ? `Consultando Python para: ${verifyState.symbol}...`
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
                  verifyState.status === 'error' ? "bg-red-400" :
                  verifyState.status === 'modo_basico' ? "bg-amber-500" : "bg-gray-600"
                )} />
                <span className={cn(
                  "text-xs font-bold font-mono",
                  verifyState.status === 'conectado' ? "text-emerald-400" :
                  verifyState.status === 'consultando' ? "text-amber-400" :
                  verifyState.status === 'error' ? "text-red-400" :
                  verifyState.status === 'modo_basico' ? "text-amber-500" : "text-gray-400"
                )}>
                  {verifyState.status === 'conectado' ? 'Motor Cuántico Conectado' :
                   verifyState.status === 'consultando' ? 'Consultando' :
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
            {verifyState.status === 'conectado' && verifyState.data ? (
              <div className="space-y-1 text-[11px] font-mono">
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <div className="text-gray-400">Acción:</div>
                  <div className={cn("font-bold text-right", verifyState.data.action === 'BUY' ? 'text-emerald-400' : verifyState.data.action === 'SELL' ? 'text-red-400' : 'text-amber-400')}>{verifyState.data.action}</div>
                  <div className="text-gray-400">Confianza:</div>
                  <div className="text-white text-right">{verifyState.data.confidence}%</div>
                </div>
                <div className="text-[9px] text-emerald-400 text-center font-bold mt-1 bg-emerald-950/20 border border-emerald-900/30 rounded py-0.5">
                  Resultado recibido desde Python
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-12 text-xs text-gray-500 font-mono italic">Sin datos</div>
            )}
          </div>
        </div>
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
                  onClick={() => handleSelectSymbol(r.symbol)}
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
                        {r.quant.action}
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
                    <Link href={`/analysis?symbol=${r.symbol}&market=${r.market}`} onClick={(e) => e.stopPropagation()} className="text-gray-500 hover:text-emerald-400 transition-colors">
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
