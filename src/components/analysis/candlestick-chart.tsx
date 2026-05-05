'use client'

import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import type { MouseEventParams, Time } from 'lightweight-charts'
import { useQuery } from '@tanstack/react-query'
import { Market, Candle } from '@/types'
import { getChartRangeConfig, type ChartRange } from '@/lib/chart-ranges'
import { Loader2, AlertCircle, TrendingUp, Mountain, CandlestickChart as CandlesIcon, Maximize2 } from 'lucide-react'
import { cn, formatLargeNumber } from '@/lib/utils'
import { isMarketOpen } from '@/lib/market-schedule'

interface CandlestickChartProps {
  symbol: string
  market: Market
  range: ChartRange
  onMetadataChange?: (metadata: CandleResponse | undefined) => void
}

interface CandleResponse {
  data: Candle[]
  range: ChartRange
  requestedRange?: ChartRange
  interval?: string
  fallback?: boolean
  fallbackReason?: string
}

type ChartMode = 'mountain' | 'candles'

const EMPTY_CANDLES: Candle[] = []
const US_MARKET_TIMEZONE = 'America/New_York'

const intradayAxisFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: US_MARKET_TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
})

const intradayTooltipFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: US_MARKET_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
})

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: US_MARKET_TIMEZONE,
  day: '2-digit',
  month: 'short',
})

interface HoverData {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

async function fetchCandles(symbol: string, market: Market, range: ChartRange): Promise<CandleResponse> {
  const res = await fetch(`/api/market/candles?symbol=${encodeURIComponent(symbol)}&range=${range}&market=${market}`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const message = typeof body?.error === 'string' ? body.error : 'Error fetching candles'
    throw new Error(`${res.status}:${message}`)
  }
  const data = await res.json()
  return {
    data: data.data || [],
    range: data.range || range,
    requestedRange: data.requestedRange,
    interval: data.interval,
    fallback: data.fallback,
    fallbackReason: data.fallbackReason,
  }
}

function isIntradayRange(range: ChartRange) {
  return range === '1D' || range === '5D'
}

function chartTimeToDate(time: Time): Date | null {
  if (typeof time === 'number') {
    return new Date(time * 1000)
  }

  if (typeof time === 'string') {
    const date = new Date(time)
    return Number.isNaN(date.getTime()) ? null : date
  }

  return new Date(Date.UTC(time.year, time.month - 1, time.day))
}

function formatAxisTime(time: Time, range: ChartRange) {
  const date = chartTimeToDate(time)
  if (!date) return ''

  if (range === '1D') {
    return intradayAxisFormatter.format(date)
  }

  if (range === '5D') {
    return `${dateFormatter.format(date)} ${intradayAxisFormatter.format(date)}`
  }

  return dateFormatter.format(date)
}

function formatCrosshairTime(time: Time) {
  const date = chartTimeToDate(time)
  if (!date) return ''

  return `${dateFormatter.format(date)}, ${intradayTooltipFormatter.format(date)} ET`
}

function formatChartTime(time: number, range: ChartRange) {
  const date = new Date(time * 1000)
  const datePart = dateFormatter.format(date)

  if (isIntradayRange(range)) {
    return `${datePart}, ${intradayTooltipFormatter.format(date)} ET`
  }

  return datePart
}

export function CandlestickChart({ symbol, market, range, onMetadataChange }: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  // Use any to avoid LWC v5 type issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candlestickSeriesRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const areaSeriesRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumeSeriesRef = useRef<any>(null)
  const candlesByTimeRef = useRef<Map<number, Candle>>(new Map())
  const didFitContentRef = useRef(false)
  const [chartMode, setChartMode] = useState<ChartMode>('mountain')
  const [hoverData, setHoverData] = useState<HoverData | null>(null)
  const [marketOpen, setMarketOpen] = useState(false)
  const [chartReadyVersion, setChartReadyVersion] = useState(0)
  const rangeConfig = getChartRangeConfig(range)

  // Check market status
  useEffect(() => {
    const check = () => setMarketOpen(isMarketOpen(market))
    check()
    const interval = setInterval(check, 60000) // Check every minute
    return () => clearInterval(interval)
  }, [market])

  const marketStatusText = marketOpen ? 'EN VIVO' : 'MERCADO CERRADO'
  const marketStatusColor = marketOpen ? 'text-emerald-400' : 'text-gray-400'
  const dotColor = marketOpen ? 'bg-emerald-500' : 'bg-gray-500'
  const dotPulse = marketOpen ? 'animate-pulse' : ''

  const { data: response, isLoading, error } = useQuery({
    queryKey: ['candles', symbol, market, range],
    queryFn: () => fetchCandles(symbol, market, range),
    staleTime: Math.min(rangeConfig.refetchMs, 60_000),
    refetchInterval: marketOpen ? rangeConfig.refetchMs : false,
  })

  const candles = response?.data ?? EMPTY_CANDLES
  const effectiveRange = response?.range ?? range

  useEffect(() => {
    onMetadataChange?.(response)
  }, [onMetadataChange, response])

  const latestCandle = candles.at(-1) || null
  const firstCandle = candles[0] || null
  const displayCandle = hoverData || latestCandle
  const chartChange = useMemo(() => {
    if (!displayCandle || !firstCandle) return { value: 0, percent: 0, positive: true }
    const value = displayCandle.close - firstCandle.open
    const percent = firstCandle.open ? (value / firstCandle.open) * 100 : 0
    return { value, percent, positive: value >= 0 }
  }, [displayCandle, firstCandle])

  const initChart = useCallback(async () => {
    if (!chartContainerRef.current) return

    if (chartRef.current) {
      try { chartRef.current.remove() } catch { /* ignore */ }
      chartRef.current = null
      candlestickSeriesRef.current = null
      areaSeriesRef.current = null
      volumeSeriesRef.current = null
    }

    const lwc = await import('lightweight-charts')
    if (!lwc || !lwc.createChart) return

    try {
      const chart = lwc.createChart(chartContainerRef.current, {
        handleScroll: {
          mouseWheel: false,
          pressedMouseMove: false,
          horzTouchDrag: false,
          vertTouchDrag: false,
        },
        handleScale: {
          axisPressedMouseMove: {
            time: false,
            price: false,
          },
          mouseWheel: false,
          pinch: false,
        },
        layout: {
          background: { type: lwc.ColorType.Solid, color: 'transparent' },
          textColor: '#94a3b8',
          fontFamily: 'JetBrains Mono, Inter, monospace',
          fontSize: 11,
        },
        localization: {
          timeFormatter: (time: Time) => formatCrosshairTime(time),
        },
        grid: {
          vertLines: { color: 'rgba(71, 85, 105, 0.08)' },
          horzLines: { color: 'rgba(148, 163, 184, 0.18)' },
        },
        crosshair: {
          mode: lwc.CrosshairMode.Normal,
          vertLine: { color: 'rgba(148, 163, 184, 0.45)', style: lwc.LineStyle.Dashed, labelBackgroundColor: '#0f172a' },
          horzLine: { color: 'rgba(148, 163, 184, 0.45)', style: lwc.LineStyle.Dashed, labelBackgroundColor: '#0f172a' },
        },
        rightPriceScale: {
          borderColor: 'rgba(71, 85, 105, 0.35)',
          scaleMargins: { top: 0.08, bottom: 0.22 },
        },
        timeScale: {
          borderColor: 'rgba(71, 85, 105, 0.35)',
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 8,
          barSpacing: 5,
          fixRightEdge: true,
        },
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight || 420,
      })

      const candleSeries = chart.addSeries(lwc.CandlestickSeries, {
        upColor: '#00c896',
        downColor: '#ff6380',
        borderUpColor: '#00c896',
        borderDownColor: '#ff6380',
        wickUpColor: '#00c896',
        wickDownColor: '#ff6380',
        priceLineColor: '#00c896',
        lastValueVisible: true,
        visible: false,
      })

      const areaSeries = chart.addSeries(lwc.AreaSeries, {
        lineColor: '#00c896',
        topColor: 'rgba(0, 200, 150, 0.28)',
        bottomColor: 'rgba(0, 200, 150, 0.02)',
        lineWidth: 2,
        priceLineColor: '#00c896',
        lastValueVisible: true,
      })

      const volumeSeries = chart.addSeries(lwc.HistogramSeries, {
        color: 'rgba(148, 163, 184, 0.22)',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      })

      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.82, bottom: 0.02 },
      })

      const crosshairHandler = (param: MouseEventParams) => {
        if (typeof param.time !== 'number') {
          setHoverData(null)
          return
        }

        const candle = candlesByTimeRef.current.get(param.time)
        if (!candle) {
          setHoverData(null)
          return
        }

        setHoverData({
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        })
      }

      chart.subscribeCrosshairMove(crosshairHandler)

      chartRef.current = chart
      candlestickSeriesRef.current = candleSeries
      areaSeriesRef.current = areaSeries
      volumeSeriesRef.current = volumeSeries
      didFitContentRef.current = false
      setChartReadyVersion((version) => version + 1)

      const resizeObserver = new ResizeObserver(() => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight || 420,
          })
        }
      })

      resizeObserver.observe(chartContainerRef.current)
      return () => {
        chart.unsubscribeCrosshairMove(crosshairHandler)
        resizeObserver.disconnect()
      }
    } catch (err) {
      console.error('[Chart] Init error:', err)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | undefined

    const setup = async () => {
      cleanup = await initChart()
      if (cancelled && cleanup) cleanup()
    }

    setup()

    return () => {
      cancelled = true
      if (cleanup) cleanup()
      didFitContentRef.current = false
      setHoverData(null)
    }
  }, [initChart])

  useEffect(() => {
    if (!candlestickSeriesRef.current || !areaSeriesRef.current) return

    candlestickSeriesRef.current.applyOptions({ visible: chartMode === 'candles' })
    areaSeriesRef.current.applyOptions({ visible: chartMode === 'mountain' })
  }, [chartMode])

  useEffect(() => {
    if (!candlestickSeriesRef.current || !areaSeriesRef.current || !volumeSeriesRef.current) return

    const rightPadding = effectiveRange === '1D' ? 28 : 4
    chartRef.current?.timeScale().applyOptions({
      rightOffset: rightPadding,
      barSpacing: effectiveRange === '1D' ? 4 : 6,
      tickMarkFormatter: (time: Time) => formatAxisTime(time, effectiveRange),
    })

    if (candles.length === 0) {
      try {
        candlestickSeriesRef.current.setData([])
        areaSeriesRef.current.setData([])
        volumeSeriesRef.current.setData([])
        candlesByTimeRef.current = new Map()
        setHoverData(null)
      } catch (e) {
        console.error('[Chart] Data clear error:', e)
      }
      return
    }

    const candleData = candles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))

    const areaData = candles.map((c) => ({
      time: c.time,
      value: c.close,
    }))

    const volumeData = candles.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(148, 163, 184, 0.25)' : 'rgba(148, 163, 184, 0.16)',
    }))

    const first = candles[0]
    const last = candles[candles.length - 1]
    candlesByTimeRef.current = new Map(candles.map((c) => [c.time, c]))
    const activeColor = last.close >= first.open ? '#00c896' : '#ff6380'
    const topColor = last.close >= first.open ? 'rgba(0, 200, 150, 0.28)' : 'rgba(255, 99, 128, 0.28)'
    const bottomColor = last.close >= first.open ? 'rgba(0, 200, 150, 0.02)' : 'rgba(255, 99, 128, 0.02)'

    try {
      candlestickSeriesRef.current.applyOptions({
        priceLineColor: activeColor,
        visible: chartMode === 'candles',
      })
      areaSeriesRef.current.applyOptions({
        lineColor: activeColor,
        priceLineColor: activeColor,
        topColor,
        bottomColor,
        visible: chartMode === 'mountain',
      })
      candlestickSeriesRef.current.setData(candleData)
      areaSeriesRef.current.setData(areaData)
      volumeSeriesRef.current.setData(volumeData)
      const from = 0
      const to = candles.length - 1 + rightPadding

      chartRef.current?.timeScale().setVisibleLogicalRange({ from, to })
      didFitContentRef.current = true
    } catch (e) {
      console.error('[Chart] Data update error:', e)
    }
  }, [candles, chartMode, effectiveRange, chartReadyVersion])

  const errorMessage = error instanceof Error ? error.message : ''
  const notFound = errorMessage.startsWith('404:')

  return (
    <div className="w-full h-full min-h-[340px] relative" ref={chartContainerRef}>
       <div className="pointer-events-none absolute left-4 right-4 top-3 z-10 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div className="rounded-lg border border-gray-800/80 bg-gray-950/78 px-2.5 py-1.5 shadow-xl backdrop-blur text-xs">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${dotPulse}`} />
                <span className={`text-[10px] font-medium ${marketStatusColor}`}>{marketStatusText}</span>
              </div>
              <span className="font-mono font-semibold text-white">{symbol}</span>
              {displayCandle && (
                <>
                  <span className="font-mono text-white">{displayCandle.close.toFixed(2)}</span>
                  <span className={cn('font-mono font-semibold text-xs', chartChange.positive ? 'text-emerald-400' : 'text-red-400')}>
                    {chartChange.positive ? '+' : ''}{chartChange.value.toFixed(2)} ({chartChange.positive ? '+' : ''}{chartChange.percent.toFixed(2)}%)
                  </span>
                </>
              )}
            </div>
           {displayCandle && (
             <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9px] text-gray-500">
               <span>{formatChartTime(displayCandle.time, effectiveRange)}</span>
               {chartMode === 'candles' && (
                 <>
                   <span>O <b className="font-mono text-gray-300">{displayCandle.open.toFixed(2)}</b></span>
                   <span>H <b className="font-mono text-gray-300">{displayCandle.high.toFixed(2)}</b></span>
                   <span>L <b className="font-mono text-gray-300">{displayCandle.low.toFixed(2)}</b></span>
                   <span>C <b className="font-mono text-gray-300">{displayCandle.close.toFixed(2)}</b></span>
                 </>
               )}
               <span>Vol <b className="font-mono text-gray-300">{formatLargeNumber(displayCandle.volume)}</b></span>
             </div>
           )}
         </div>

        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-gray-800/80 bg-gray-950/78 p-1 shadow-xl backdrop-blur">
          <button
            type="button"
            onClick={() => setChartMode('mountain')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              chartMode === 'mountain' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'
            )}
          >
            <Mountain className="h-3.5 w-3.5" />
            Mountain
          </button>
          <button
            type="button"
            onClick={() => setChartMode('candles')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              chartMode === 'candles' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'
            )}
          >
            <CandlesIcon className="h-3.5 w-3.5" />
            Velas
          </button>
          <div className="h-5 w-px bg-gray-800" />
          <Maximize2 className="mx-1 h-3.5 w-3.5 text-gray-500" />
        </div>
      </div>

      {response?.fallback && (
        <div className="pointer-events-none absolute left-4 top-20 z-10 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200 backdrop-blur">
          Sin datos para {response.requestedRange ?? range}. Mostrando {response.range} · {response.interval ?? getChartRangeConfig(response.range).interval}.
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-gray-500 bg-gray-950/20 backdrop-blur-[1px]">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-400 mb-3" />
          <p className="text-sm">Cargando datos de {symbol}...</p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-red-400 gap-2 bg-gray-950/40">
          <AlertCircle className="w-6 h-6" />
          <p className="text-sm">Error al cargar el gráfico</p>
          <p className="text-xs text-gray-500">
            {notFound ? 'Verifica que el símbolo sea válido' : 'No se pudieron obtener datos de mercado en este momento'}
          </p>
        </div>
      )}

      {!isLoading && !error && candles.length === 0 && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-gray-500 gap-2 bg-gray-950/30">
          <TrendingUp className="w-8 h-8 text-gray-700" />
          <p className="text-sm">Sin datos de mercado</p>
          <p className="text-xs text-gray-600">El mercado puede estar cerrado o el símbolo no existe</p>
        </div>
      )}
    </div>
  )
}

# bumped: 2026-05-05T04:21:00