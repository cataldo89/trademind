'use client'

import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import type { MouseEventParams, Time } from 'lightweight-charts'
import { useQuery } from '@tanstack/react-query'
import { Market, Candle } from '@/types'
import { getChartRangeConfig, type ChartRange } from '@/lib/chart-ranges'
import { Loader2, AlertCircle, TrendingUp, Mountain, CandlestickChart as CandlesIcon, Maximize2, ZoomIn } from 'lucide-react'
import { cn, formatLargeNumber, formatPriceRaw } from '@/lib/utils'
import { useMarketStatus } from '@/hooks/useMarketStatus'
import { calculateSMA } from '@/lib/indicators'

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

function getChartBarSpacing(range: ChartRange, candlesCount: number) {
  if (candlesCount <= 30) return 14
  if (range === '1D' || range === '5D') return 4
  if (candlesCount <= 90) return 8
  return 5
}

function normalizeChartCandle(candle: Candle): Candle | null {
  const open = Number(candle.open)
  const high = Number(candle.high)
  const low = Number(candle.low)
  const close = Number(candle.close)
  const time = Number(candle.time)

  if (![time, open, high, low, close].every((value) => Number.isFinite(value)) || time <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0) {
    return null
  }

  return {
    ...candle,
    time,
    open,
    high: Math.max(high, open, close),
    low: Math.min(low, open, close),
    close,
    volume: Math.max(0, Number(candle.volume) || 0),
  }
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sma20SeriesRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sma50SeriesRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sma100SeriesRef = useRef<any>(null)
  const candlesByTimeRef = useRef<Map<number, Candle>>(new Map())
  const sma20ByTimeRef = useRef<Map<number, number>>(new Map())
  const sma50ByTimeRef = useRef<Map<number, number>>(new Map())
  const sma100ByTimeRef = useRef<Map<number, number>>(new Map())
  const didFitContentRef = useRef(false)

  const [chartMode, setChartMode] = useState<ChartMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('analysis_chart_mode')
      if (saved === 'mountain' || saved === 'candles') return saved
    }
    return 'candles'
  })

  const [showMAs, setShowMAs] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('analysis_show_mas')
      if (saved !== null) return saved === 'true'
    }
    return true
  })

  const [isZoomEnabled, setIsZoomEnabled] = useState(false)

  const handleChartModeChange = (mode: ChartMode) => {
    setChartMode(mode)
    if (mode !== 'candles') {
      setIsZoomEnabled(false)
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem('analysis_chart_mode', mode)
    }
  }

  const handleShowMAsChange = (show: boolean) => {
    setShowMAs(show)
    if (typeof window !== 'undefined') {
      localStorage.setItem('analysis_show_mas', String(show))
    }
  }

  const handleContainerClick = (e: React.MouseEvent) => {
    if (chartMode !== 'candles') return
    
    // Ignore clicks on controls or buttons
    const target = e.target as HTMLElement
    if (target.closest('.pointer-events-auto') || target.closest('button')) {
      return
    }
    
    setIsZoomEnabled((prev) => !prev)
  }

  const [hoverData, setHoverData] = useState<HoverData | null>(null)
  const statuses = useMarketStatus()
  const marketOpen = statuses[market]?.isOpen ?? false
  const [chartReadyVersion, setChartReadyVersion] = useState(0)
  const rangeConfig = getChartRangeConfig(range)

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

  const drawableCandles = useMemo(() => {
    return candles.map(normalizeChartCandle).filter((c): c is Candle => Boolean(c))
  }, [candles])

  const sma20Data = useMemo(() => {
    return calculateSMA(drawableCandles, 20).map((item) => ({
      time: item.time as Time,
      value: item.value,
    }))
  }, [drawableCandles])

  const sma50Data = useMemo(() => {
    return calculateSMA(drawableCandles, 50).map((item) => ({
      time: item.time as Time,
      value: item.value,
    }))
  }, [drawableCandles])

  const sma100Data = useMemo(() => {
    return calculateSMA(drawableCandles, 100).map((item) => ({
      time: item.time as Time,
      value: item.value,
    }))
  }, [drawableCandles])

  const smaMaps = useMemo(() => {
    return {
      sma20: new Map<number, number>(sma20Data.map((d) => [d.time as number, d.value])),
      sma50: new Map<number, number>(sma50Data.map((d) => [d.time as number, d.value])),
      sma100: new Map<number, number>(sma100Data.map((d) => [d.time as number, d.value])),
      candles: new Map<number, Candle>(drawableCandles.map((c) => [c.time, c])),
    }
  }, [sma20Data, sma50Data, sma100Data, drawableCandles])

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
      sma20SeriesRef.current = null
      sma50SeriesRef.current = null
      sma100SeriesRef.current = null
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
          attributionLogo: false,
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
        visible: false,
      })

      const sma20Series = chart.addSeries(lwc.LineSeries, {
        color: '#f59e0b',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: false,
      })

      const sma50Series = chart.addSeries(lwc.LineSeries, {
        color: '#3b82f6',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: false,
      })

      const sma100Series = chart.addSeries(lwc.LineSeries, {
        color: '#a855f7',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: false,
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
      sma20SeriesRef.current = sma20Series
      sma50SeriesRef.current = sma50Series
      sma100SeriesRef.current = sma100Series
      didFitContentRef.current = false
      setChartReadyVersion((version) => version + 1)

      const resizeObserver = new ResizeObserver(() => {
        if (chartContainerRef.current && chartRef.current) {
          const width = chartContainerRef.current.clientWidth
          const height = chartContainerRef.current.clientHeight || 420
          chartRef.current.applyOptions({ width, height })
          if (width > 0 && !didFitContentRef.current && candlesByTimeRef.current.size > 0) {
            requestAnimationFrame(() => {
              chartRef.current?.timeScale().fitContent()
            })
            didFitContentRef.current = true
          }
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
    if (!sma20SeriesRef.current || !sma50SeriesRef.current || !sma100SeriesRef.current) return

    sma20SeriesRef.current.applyOptions({ visible: showMAs })
    sma50SeriesRef.current.applyOptions({ visible: showMAs })
    sma100SeriesRef.current.applyOptions({ visible: showMAs })
  }, [showMAs])

  useEffect(() => {
    if (!chartRef.current) return

    const zoomActive = isZoomEnabled && chartMode === 'candles'
    chartRef.current.applyOptions({
      handleScroll: {
        mouseWheel: zoomActive,
        pressedMouseMove: zoomActive,
        horzTouchDrag: zoomActive,
        vertTouchDrag: zoomActive,
      },
      handleScale: {
        axisPressedMouseMove: {
          time: zoomActive,
          price: zoomActive,
        },
        mouseWheel: zoomActive,
        pinch: zoomActive,
      },
    })

    if (!zoomActive && smaMaps.candles.size > 0) {
      requestAnimationFrame(() => {
        chartRef.current?.timeScale().fitContent()
      })
    }
  }, [isZoomEnabled, chartMode, smaMaps])

  useEffect(() => {
    didFitContentRef.current = false
  }, [symbol, effectiveRange])

  useEffect(() => {
    if (!candlestickSeriesRef.current || !areaSeriesRef.current || !volumeSeriesRef.current) return

    chartRef.current?.timeScale().applyOptions({
      rightOffset: 2,
      barSpacing: 6,
      fixLeftEdge: true,
      fixRightEdge: true,
      tickMarkFormatter: (time: Time) => formatAxisTime(time, effectiveRange),
    })

    if (drawableCandles.length === 0) {
      try {
        candlestickSeriesRef.current.setData([])
        areaSeriesRef.current.setData([])
        volumeSeriesRef.current.setData([])
        if (sma20SeriesRef.current) sma20SeriesRef.current.setData([])
        if (sma50SeriesRef.current) sma50SeriesRef.current.setData([])
        if (sma100SeriesRef.current) sma100SeriesRef.current.setData([])
        candlesByTimeRef.current = new Map()
        sma20ByTimeRef.current = new Map()
        sma50ByTimeRef.current = new Map()
        sma100ByTimeRef.current = new Map()
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHoverData(null)
      } catch (e) {
        console.error('[Chart] Data clear error:', e)
      }
      return
    }

    const candleData = drawableCandles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))

    const areaData = drawableCandles.map((c) => ({
      time: c.time,
      value: c.close,
    }))

    const volumeData = drawableCandles.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(148, 163, 184, 0.25)' : 'rgba(148, 163, 184, 0.16)',
    }))

    const first = drawableCandles[0]
    const last = drawableCandles[drawableCandles.length - 1]
    candlesByTimeRef.current = smaMaps.candles
    sma20ByTimeRef.current = smaMaps.sma20
    sma50ByTimeRef.current = smaMaps.sma50
    sma100ByTimeRef.current = smaMaps.sma100
    const activeColor = last.close >= first.open ? '#00c896' : '#ff6380'
    const topColor = last.close >= first.open ? 'rgba(0, 200, 150, 0.28)' : 'rgba(255, 99, 128, 0.28)'
    const bottomColor = last.close >= first.open ? 'rgba(0, 200, 150, 0.02)' : 'rgba(255, 99, 128, 0.02)'

    try {
      const latestPrice = last.close
      let precision = 2
      let minMove = 0.01
      if (latestPrice > 0) {
        if (latestPrice < 0.001) {
          precision = 8
          minMove = 0.00000001
        } else if (latestPrice < 0.1) {
          precision = 6
          minMove = 0.000001
        } else if (latestPrice < 1) {
          precision = 4
          minMove = 0.0001
        }
      }

      candlestickSeriesRef.current.applyOptions({
        priceLineColor: activeColor,
        visible: chartMode === 'candles',
        priceFormat: {
          type: 'price',
          precision,
          minMove,
        }
      })
      areaSeriesRef.current.applyOptions({
        lineColor: activeColor,
        priceLineColor: activeColor,
        topColor,
        bottomColor,
        visible: chartMode === 'mountain',
        priceFormat: {
          type: 'price',
          precision,
          minMove,
        }
      })
      chartRef.current?.timeScale().applyOptions({
        barSpacing: getChartBarSpacing(effectiveRange, drawableCandles.length),
        rightOffset: 2,
        fixLeftEdge: true,
        fixRightEdge: true,
      })

      try {
        candlestickSeriesRef.current.setData(candleData)
      } catch (e) {
        console.error('[Chart] Candlestick data update error:', e)
      }
      try {
        areaSeriesRef.current.setData(areaData)
      } catch (e) {
        console.error('[Chart] Area data update error:', e)
      }
      try {
        volumeSeriesRef.current.setData(volumeData)
      } catch (e) {
        console.error('[Chart] Volume data update error:', e)
      }
      try {
        if (sma20SeriesRef.current) sma20SeriesRef.current.setData(sma20Data)
      } catch (e) {
        console.error('[Chart] SMA 20 data update error:', e)
      }
      try {
        if (sma50SeriesRef.current) sma50SeriesRef.current.setData(sma50Data)
      } catch (e) {
        console.error('[Chart] SMA 50 data update error:', e)
      }
      try {
        if (sma100SeriesRef.current) sma100SeriesRef.current.setData(sma100Data)
      } catch (e) {
        console.error('[Chart] SMA 100 data update error:', e)
      }

      const containerWidth = chartContainerRef.current?.clientWidth ?? 0
      if (containerWidth > 0 && (!didFitContentRef.current || !isZoomEnabled)) {
        requestAnimationFrame(() => {
          chartRef.current?.timeScale().fitContent()
        })
        didFitContentRef.current = true
      }
    } catch (e) {
      console.error('[Chart] Data update error:', e)
    }
  }, [candles, chartMode, effectiveRange, chartReadyVersion, drawableCandles, sma20Data, sma50Data, sma100Data, smaMaps, isZoomEnabled])

  const errorMessage = error instanceof Error ? error.message : ''
  const notFound = errorMessage.startsWith('404:')

  const currentSma20 = showMAs && displayCandle ? smaMaps.sma20.get(displayCandle.time) : undefined
  const currentSma50 = showMAs && displayCandle ? smaMaps.sma50.get(displayCandle.time) : undefined
  const currentSma100 = showMAs && displayCandle ? smaMaps.sma100.get(displayCandle.time) : undefined

  return (
    <div
      className={cn(
        "w-full h-full min-h-[340px] relative transition-all duration-200",
        chartMode === 'candles' && (isZoomEnabled ? 'cursor-zoom-out bg-cyan-950/5' : 'cursor-zoom-in hover:bg-cyan-950/2')
      )}
      ref={chartContainerRef}
      onClick={handleContainerClick}
    >
       <div className="pointer-events-none absolute left-4 right-20 top-3 z-10 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div className="rounded-lg border border-gray-800/80 bg-gray-950/78 px-2.5 py-1.5 shadow-xl backdrop-blur text-xs">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${dotPulse}`} />
                <span className={`text-[10px] font-medium ${marketStatusColor}`}>{marketStatusText}</span>
              </div>
              <span className="font-mono font-semibold text-white">{symbol}</span>
              {displayCandle && (
                <>
                  <span className="font-mono text-white">{formatPriceRaw(displayCandle.close)}</span>
                  <span className={cn('font-mono font-semibold text-xs', chartChange.positive ? 'text-emerald-400' : 'text-red-400')}>
                    {chartChange.positive ? '+' : ''}{formatPriceRaw(chartChange.value)} ({chartChange.positive ? '+' : ''}{chartChange.percent.toFixed(2)}%)
                  </span>
                </>
              )}
            </div>
           {displayCandle && (
              <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9px] text-gray-500">
                <span>{formatChartTime(displayCandle.time, effectiveRange)}</span>
                {chartMode === 'candles' && (
                  <>
                    <span>O <b className="font-mono text-gray-300">{formatPriceRaw(displayCandle.open)}</b></span>
                    <span>H <b className="font-mono text-gray-300">{formatPriceRaw(displayCandle.high)}</b></span>
                    <span>L <b className="font-mono text-gray-300">{formatPriceRaw(displayCandle.low)}</b></span>
                    <span>C <b className="font-mono text-gray-300">{formatPriceRaw(displayCandle.close)}</b></span>
                  </>
                )}
                <span>Vol <b className="font-mono text-gray-300">{formatLargeNumber(displayCandle.volume)}</b></span>
                {currentSma20 !== undefined && (
                  <span>SMA20 <b className="font-mono text-amber-400">{formatPriceRaw(currentSma20)}</b></span>
                )}
                {currentSma50 !== undefined && (
                  <span>SMA50 <b className="font-mono text-blue-400">{formatPriceRaw(currentSma50)}</b></span>
                )}
                {currentSma100 !== undefined && (
                  <span>SMA100 <b className="font-mono text-purple-400">{formatPriceRaw(currentSma100)}</b></span>
                )}
              </div>
           )}
         </div>

        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-gray-800/80 bg-gray-950/78 p-1 shadow-xl backdrop-blur">
          <button
            type="button"
            onClick={() => handleChartModeChange('mountain')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              chartMode === 'mountain' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'
            )}
          >
            <Mountain className="h-3.5 w-3.5" />
            Línea
          </button>
          <button
            type="button"
            onClick={() => handleChartModeChange('candles')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              chartMode === 'candles' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white'
            )}
          >
            <CandlesIcon className="h-3.5 w-3.5" />
            Velas
          </button>
          {chartMode === 'candles' ? (
            <button
              type="button"
              onClick={() => setIsZoomEnabled(!isZoomEnabled)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors border',
                isZoomEnabled
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 hover:bg-cyan-500/30'
                  : 'bg-cyan-950/40 text-cyan-400 hover:text-white border-cyan-800/40 hover:bg-cyan-900/40'
              )}
              title="Habilitar zoom interactivo (Rueda / Pellizco)"
            >
              <ZoomIn className="h-3.5 w-3.5" />
              Zoom: {isZoomEnabled ? 'Activo' : 'Desactivado'}
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-transparent cursor-not-allowed"
              title="Zoom interactivo solo disponible en modo Velas"
            >
              <ZoomIn className="h-3.5 w-3.5 text-gray-700" />
              Zoom (Solo Velas)
            </button>
          )}
          <div className="h-5 w-px bg-gray-800" />
          <button
            type="button"
            onClick={() => handleShowMAsChange(!showMAs)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors border',
              showMAs
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                : 'text-gray-400 hover:text-white border-transparent hover:bg-gray-800/50'
            )}
            title="Mostrar Medias Móviles Acumuladas (SMA 20, SMA 50 y SMA 100)"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            SMA 20/50/100
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

      {chartMode === 'candles' && !isLoading && !error && candles.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-md border border-cyan-500/20 bg-gray-950/90 px-3 py-1.5 text-xs text-gray-300 backdrop-blur-md shadow-xl transition-all duration-300">
          {isZoomEnabled ? (
            <span className="flex items-center gap-2 text-cyan-400 font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
              </span>
              Zoom Activo (Usa la rueda del mouse o gestos táctiles para ampliar)
            </span>
          ) : (
            <span className="flex items-center gap-2 text-gray-400">
              <ZoomIn className="w-3.5 h-3.5 text-cyan-500" />
              Haz clic en el gráfico o presiona &quot;Zoom&quot; para activar zoom interactivo
            </span>
          )}
        </div>
      )}
    </div>
  )
}

