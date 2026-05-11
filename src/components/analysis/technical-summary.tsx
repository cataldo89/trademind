'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Market, Candle } from '@/types'
import type { ChartRange } from '@/lib/chart-ranges'
import {
  calculateRSI, calculateMACD, calculateBollingerBands,
  calculateSMA, calculateVWAP, generateSignal, interpretRSI
} from '@/lib/indicators'
import { Loader2, TrendingUp, TrendingDown, Minus, ChevronRight, Zap } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import Link from 'next/link'
import { toast } from 'sonner'
import { useState } from 'react'
import { AIAdvisor } from './ai-advisor'
import { fetchVirtualBalanceProfile } from '@/lib/virtual-balance'

interface TechnicalSummaryProps {
  symbol: string
  market: Market
  range: ChartRange
}

async function fetchCandles(symbol: string, market: Market, range: ChartRange): Promise<Candle[]> {
  const res = await fetch(`/api/market/candles?symbol=${encodeURIComponent(symbol)}&range=${range}&market=${market}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.data || []
}

function parseSimulatedOrderAmount(value: string) {
  return Number(value.trim().replace(',', '.'))
}

function formatSimulatedQuantity(quantity: number) {
  return quantity.toLocaleString('en-US', {
    minimumFractionDigits: quantity < 1 ? 4 : 0,
    maximumFractionDigits: quantity < 1 ? 8 : 6,
  })
}

function getPerformanceLabel(range: ChartRange) {
  const labels: Record<ChartRange, { title: string; text: string }> = {
    '1D': { title: 'RENDIMIENTO 1 DÍA', text: 'al inicio del día' },
    '5D': { title: 'RENDIMIENTO 5 DÍAS', text: 'hace 5 días' },
    '1M': { title: 'RENDIMIENTO 1 MES', text: 'hace 1 mes' },
    '6M': { title: 'RENDIMIENTO 6 MESES', text: 'hace 6 meses' },
    'YTD': { title: 'RENDIMIENTO YTD', text: 'al inicio del año' },
    '1Y': { title: 'RENDIMIENTO 1 AÑO', text: 'hace 1 año' },
    '5Y': { title: 'RENDIMIENTO 5 AÑOS', text: 'hace 5 años' },
    'ALL': { title: 'RENDIMIENTO TOTAL', text: 'al inicio del historial disponible' },
  }

  return labels[range]
}

const ACTIONABLE_SIGNAL_RANGES = new Set<ChartRange>(['1D', '5D', '1M'])

function getSignalWindowHelp(range: ChartRange) {
  if (range === '1D') return 'Señal intradía: válida para seguimiento durante la sesión actual.'
  if (range === '5D') return 'Señal swing corta: válida para los próximos días de mercado.'
  if (range === '1M') return 'Señal swing: válida como máximo para seguimiento mensual.'
  return 'Este rango es retrospectivo/contextual. Para guardar una señal activa usa 1D, 5D o 1M.'
}

export function TechnicalSummary({ symbol, market, range }: TechnicalSummaryProps) {
  const [isSaving, setIsSaving] = useState(false)
  const queryClient = useQueryClient()

  const { data: candles = [], isLoading } = useQuery({
    queryKey: ['candles-analysis', symbol, market, range],
    queryFn: () => fetchCandles(symbol, market, range),
    staleTime: 60 * 1000,
  })

  // Señal técnica siempre basada en 1Y para consistencia
  const { data: signalCandles = [] } = useQuery({
    queryKey: ['candles-signal', symbol, market],
    queryFn: () => fetchCandles(symbol, market, '1Y'),
    staleTime: 60 * 1000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
      </div>
    )
  }

  if (candles.length < 2) {
    return (
      <div className="p-4 text-center text-sm text-gray-500">
        Se necesitan más datos para calcular indicadores
      </div>
    )
  }

  const lastCandle = candles[candles.length - 1]
  const previousCandle = candles[candles.length - 2]
  const dayChange = lastCandle.close - previousCandle.close
  const dayChangePercent = previousCandle.close > 0 ? (dayChange / previousCandle.close) * 100 : 0
  const hasFullIndicatorSet = candles.length >= 30
  const rsi = calculateRSI(candles)
  const macd = calculateMACD(candles)
  const bb = calculateBollingerBands(candles)
  const ma20 = calculateSMA(candles, 20)
  const ma50 = calculateSMA(candles, 50)
  const vwap = calculateVWAP(candles)

  const lastRSI = rsi[rsi.length - 1]?.value
  const lastMACD = macd[macd.length - 1]
  const lastBB = bb[bb.length - 1]
  const lastMA20 = ma20[ma20.length - 1]?.value
  const lastMA50 = ma50[ma50.length - 1]?.value
  const lastVWAP = vwap[vwap.length - 1]?.value

  const signal = generateSignal(signalCandles)
  const rsiInterpret = lastRSI !== undefined ? interpretRSI(lastRSI) : null

  const performanceLabel = getPerformanceLabel(range)
  const performanceStartPrice = candles.length >= 2 ? candles[0].close : null
  const performanceCurrentPrice = lastCandle.close
  const performance = performanceStartPrice && performanceStartPrice > 0
    ? ((performanceCurrentPrice - performanceStartPrice) / performanceStartPrice) * 100
    : null
  const canSaveSignal = ACTIONABLE_SIGNAL_RANGES.has(range)
  const canExecuteBuy = signal.type === 'BUY'

  const SignalIcon = signal.type === 'BUY' ? TrendingUp : signal.type === 'SELL' ? TrendingDown : Minus
  const signalColors = {
    BUY: { text: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
    SELL: { text: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' },
    HOLD: { text: 'text-gray-400', bg: 'bg-gray-800 border-gray-700' },
  }

  const saveSignal = async () => {
    if (!canSaveSignal) {
      toast.error('Usa 1D, 5D o 1M para guardar una señal activa')
      return
    }

    setIsSaving(true)
    try {
      // Import createClient dynamically or use a new one to avoid conflicts
      const { createClient } = await import('@/lib/supabase/client')
      const supabaseClient = createClient()
      const { data: { session } } = await supabaseClient.auth.getSession()
      const token = session?.access_token

      const res = await fetch('/api/signals', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          symbol,
          market,
          type: signal.type,
          strength: signal.strength,
          reason: signal.reasons.join('. '),
          price: lastCandle.close,
          timeframe: range,
        }),
      })

      if (res.status === 401) {
        toast.error('Inicia sesión para guardar señales')
        return
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        console.error('[saveSignal response]', res.status, body)
        toast.error(body?.error || `Error al guardar señal (${res.status})`)
        return
      }

      queryClient.invalidateQueries({ queryKey: ['all-signals'] })
      queryClient.invalidateQueries({ queryKey: ['active-signals'] })
      toast.success(`Señal ${signal.type} guardada para ${symbol} (${range})`)
    } catch (err) {
      console.error('[saveSignal error]', err)
      toast.error('Error inesperado')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* Performance Card */}
      <div className={cn('p-4 rounded-xl border', performance !== null && performance >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30')}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-400">{performanceLabel.title}</span>
          <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
            Retrospectivo
          </span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          {performance !== null ? (
            <>
              {performance >= 0
                ? <TrendingUp className="w-5 h-5 text-emerald-400" />
                : <TrendingDown className="w-5 h-5 text-red-400" />}
              <span className={cn('text-lg font-bold', performance >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {performance >= 0 ? '+' : ''}{performance.toFixed(2)}%
              </span>
            </>
          ) : (
            <span className="text-lg font-bold text-gray-400">Sin datos</span>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mb-3">
          {performance !== null
            ? `Si hubieras comprado ${symbol} ${performanceLabel.text}, ahora tendrías ${performance >= 0 ? '+' : ''}${performance.toFixed(2)}% de ganancia/pérdida`
            : `Datos insuficientes para calcular ${performanceLabel.title.toLowerCase()}`}
        </p>

        {/* Mini bar */}
        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden mb-3">
          <div
            className={cn('h-full rounded-full transition-all', performance !== null && performance >= 0 ? 'bg-emerald-400' : 'bg-red-400')}
            style={{ width: `${performance !== null ? Math.min(Math.abs(performance) * 3, 100) : 0}%` }}
          />
        </div>
      </div>

      {/* Indicators */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Indicadores</h3>

        {!hasFullIndicatorSet && (
          <div className="rounded-lg border border-gray-800 bg-gray-900/30 px-3 py-2 text-xs text-gray-400">
            Datos suficientes para tendencia diaria, pero no para el set completo de indicadores avanzados.
          </div>
        )}

        {/* RSI */}
        {lastRSI !== undefined && (
          <IndicatorRow
            label="RSI (14)"
            value={lastRSI.toFixed(1)}
            signal={rsiInterpret?.signal || ''}
            signalColor={rsiInterpret?.color || 'text-gray-400'}
          />
        )}

        {/* MACD */}
        {lastMACD && (
          <IndicatorRow
            label="MACD"
            value={lastMACD.macd.toFixed(4)}
            signal={lastMACD.histogram >= 0 ? 'Alcista' : 'Bajista'}
            signalColor={lastMACD.histogram >= 0 ? 'text-emerald-400' : 'text-red-400'}
          />
        )}

        {/* MA20 */}
        {lastMA20 !== undefined && (
          <IndicatorRow
            label="MA 20"
            value={lastMA20.toFixed(2)}
            signal={lastCandle.close > lastMA20 ? 'Sobre' : 'Bajo'}
            signalColor={lastCandle.close > lastMA20 ? 'text-emerald-400' : 'text-red-400'}
          />
        )}

        {/* MA50 */}
        {lastMA50 !== undefined && (
          <IndicatorRow
            label="MA 50"
            value={lastMA50.toFixed(2)}
            signal={lastCandle.close > lastMA50 ? 'Sobre' : 'Bajo'}
            signalColor={lastCandle.close > lastMA50 ? 'text-emerald-400' : 'text-red-400'}
          />
        )}

        {/* Bollinger Bands */}
        {lastBB && (
          <>
            <IndicatorRow label="BB Superior" value={lastBB.upper.toFixed(2)} />
            <IndicatorRow label="BB Media" value={lastBB.middle.toFixed(2)} />
            <IndicatorRow label="BB Inferior" value={lastBB.lower.toFixed(2)} />
          </>
        )}

        {/* VWAP */}
        {lastVWAP !== undefined && (
          <IndicatorRow
            label="VWAP"
            value={lastVWAP.toFixed(2)}
            signal={lastCandle.close > lastVWAP ? 'Sobre' : 'Bajo'}
            signalColor={lastCandle.close > lastVWAP ? 'text-emerald-400' : 'text-red-400'}
          />
        )}
      </div>

      {/* AI Advisor Native Integration */}
      <AIAdvisor symbol={symbol} market={market} />

      {/* Save Signal Button */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/30 px-3 py-2 text-[11px] text-gray-400">
        {getSignalWindowHelp(range)}
      </div>
      <button
        onClick={saveSignal}
        disabled={isSaving || !canSaveSignal}
        className={cn(
          'flex items-center justify-center gap-2 w-full py-2 text-xs font-medium rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          canSaveSignal ? 'bg-emerald-500 hover:bg-emerald-400 text-white' : 'bg-gray-800 text-gray-500'
        )}
      >
        {isSaving ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Guardando...
          </>
        ) : (
          <>
            <TrendingUp className="w-3.5 h-3.5" />
            {canSaveSignal ? `Guardar señal ${signal.type} para ${symbol}` : 'Rango no guardable como señal'}
          </>
        )}
      </button>

      {/* Add to portfolio CTA */}
      <button
        onClick={async () => {
          if (!canExecuteBuy) {
            toast.error(`No se ejecuta compra porque la señal actual es ${signal.type}. Guárdala para seguimiento o usa ajuste manual si decides operar.`)
            return
          }

          setIsSaving(true)
          try {
            const { createClient } = await import('@/lib/supabase/client')
            const supabaseClient = createClient()
            const { data: { user } } = await supabaseClient.auth.getUser()
            if (!user) { toast.error('Inicia sesion para operar'); return }

            const price = Number(lastCandle.close)
            if (!Number.isFinite(price) || price <= 0) {
              toast.error('No hay precio valido para ejecutar la compra')
              return
            }

            const { data: { session } } = await supabaseClient.auth.getSession()
            const profile = await fetchVirtualBalanceProfile(session?.access_token)
            const virtualBalance = Number(profile.virtual_balance ?? 0)
            if (!Number.isFinite(virtualBalance) || virtualBalance <= 0) {
              toast.error('No tienes capital virtual disponible. Ajusta el capital en Portafolio.')
              return
            }

            const amountInput = window.prompt(
              `Monto virtual a invertir en ${symbol}. Saldo disponible: ${formatCurrency(virtualBalance)}`,
              String(Math.min(100, virtualBalance))
            )
            if (amountInput === null) return

            const amount = parseSimulatedOrderAmount(amountInput)
            if (!Number.isFinite(amount) || amount <= 0) {
              toast.error('Ingresa un monto valido')
              return
            }

            const res = await fetch('/api/portfolio/trade', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
              },
              body: JSON.stringify({
                side: 'BUY',
                symbol,
                name: symbol,
                market,
                amount,
                price,
                source: 'analysis',
                notes: 'Compra fraccional simulada desde analisis tecnico',
              }),
            })

            const body = await res.json().catch(() => null)
            if (!res.ok || !body?.ok) {
              throw new Error(body?.error?.message || 'Error al ejecutar operacion simulada')
            }

            const quantity = Number(body.data?.position?.quantity ?? amount / price)
            toast.success(`Compraste ${formatSimulatedQuantity(quantity)} ${symbol} por ${formatCurrency(amount)}`)
            queryClient.invalidateQueries({ queryKey: ['positions'] })
            queryClient.invalidateQueries({ queryKey: ['profile'] })
            queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] })
          } catch (err) {
            console.warn('[analysis fractional buy]', err)
            toast.error(err instanceof Error ? err.message : 'Error al ejecutar operacion simulada')
          } finally {
            setIsSaving(false)
          }
        }}
        disabled={isSaving || !canExecuteBuy}
        className={cn(
          "flex items-center justify-center gap-2 w-full py-2 text-xs font-bold rounded-lg transition-all active:scale-95 disabled:opacity-50",
          canExecuteBuy
            ? "bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/20"
            : "bg-gray-800 text-gray-500 border border-gray-700"
        )}
      >
        {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
        {canExecuteBuy ? 'EJECUTAR COMPRA FRACCIONAL' : `COMPRA BLOQUEADA: SEÑAL ${signal.type}`}
      </button>
      <Link
        href={`/portfolio?add=${symbol}&market=${market}`}
        className="flex items-center justify-center gap-2 w-full py-2 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors border border-gray-700"
      >
        + Ajustar y agregar manualmente
      </Link>
    </div>
  )
}

function IndicatorRow({
  label,
  value,
  signal,
  signalColor = 'text-gray-400',
}: {
  label: string
  value: string
  signal?: string
  signalColor?: string
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-800/50">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-white">{value}</span>
        {signal && <span className={cn('text-xs', signalColor)}>{signal}</span>}
      </div>
    </div>
  )
}
