'use client';

import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { useMarketStore } from '@/store/marketStore';

export function RealtimeChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  
  const { data, symbol } = useMarketStore();

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Initialize chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9CA3AF', // text-gray-400
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1, // Normal mode
      }
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981', // emerald-500
      downColor: '#EF4444', // red-500
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Update data when it changes
  useEffect(() => {
    if (seriesRef.current && data.length > 0) {
      // lightweight-charts expects data to be sorted by time and unique
      const sortedData = [...data].sort((a, b) => a.time - b.time);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      seriesRef.current.setData(sortedData as any);
    }
  }, [data]);

  return (
    <div className="w-full h-full flex flex-col bg-white/[0.02] border border-white/5 rounded-2xl p-4 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-white">{symbol}</h2>
          <p className="text-sm text-gray-400">Datos en Tiempo Real</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </span>
          <span className="text-xs text-emerald-400 font-medium">Live</span>
        </div>
      </div>
      <div ref={chartContainerRef} className="w-full flex-1" />
    </div>
  );
}
