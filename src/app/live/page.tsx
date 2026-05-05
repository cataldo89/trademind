'use client';

import { useEffect } from 'react';
import { RealtimeChart } from '@/components/dashboard/RealtimeChart';
import { SignalsPanel } from '@/components/dashboard/SignalsPanel';
import { useMarketStore } from '@/store/marketStore';

export default function LiveMonitorPage() {
  const { addCandle, addSignal } = useMarketStore();

  useEffect(() => {
    // ---------------------------------------------------------
    // Phase 2 & 3: Simulation of Supabase Realtime / ETF Feed
    // In production, this would be a Supabase Realtime subscription:
    // supabase.channel('public:etf_prices').on('postgres_changes', ...).subscribe()
    // ---------------------------------------------------------
    
    let time = Math.floor(Date.now() / 1000);
    let lastClose = 500;

    // Simulate incoming websocket market data every second
    const marketInterval = setInterval(() => {
      const volatility = 0.5;
      const change = (Math.random() - 0.5) * volatility;
      
      const open = lastClose;
      const close = open + change;
      const high = Math.max(open, close) + Math.random() * 0.2;
      const low = Math.min(open, close) - Math.random() * 0.2;
      
      lastClose = close;
      time += 60; // Assume 1-minute candles for the visual pace

      addCandle({
        time,
        open,
        high,
        low,
        close
      });
      
    }, 1000);

    // Simulate backend AI Algorithm detecting a pattern and emitting a signal
    const signalInterval = setInterval(() => {
      const isBuy = Math.random() > 0.5;
      addSignal({
        id: Math.random().toString(36).substring(7),
        symbol: 'SPY',
        action: isBuy ? 'BUY' : 'SELL',
        price: lastClose,
        timestamp: new Date().toISOString(),
        confidence: Math.floor(Math.random() * 20) + 80, // 80-99%
        reasoning: isBuy 
          ? 'RSI en sobreventa profunda combinado con cruce dorado en MACD de marco temporal corto.' 
          : 'Divergencia bajista detectada en volumen y precio. Alta probabilidad de retroceso.'
      });
    }, 12000);

    return () => {
      clearInterval(marketInterval);
      clearInterval(signalInterval);
    };
  }, [addCandle, addSignal]);

  return (
    <div className="p-6 h-[calc(100vh-4rem)] flex flex-col space-y-6 bg-black">
      <div>
        <h1 className="text-2xl font-bold text-white">Live AI Monitor</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Monitoreo algorítmico en tiempo real vía WebSockets
        </p>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
        <div className="lg:col-span-2 h-full">
          <RealtimeChart />
        </div>
        <div className="h-full">
          <SignalsPanel />
        </div>
      </div>
    </div>
  );
}
