import { create } from 'zustand';
import { CandleData, TradeSignal } from '@/types/market';

interface MarketState {
  symbol: string;
  data: CandleData[];
  signals: TradeSignal[];
  setSymbol: (sym: string) => void;
  setData: (data: CandleData[]) => void;
  addCandle: (candle: CandleData) => void;
  addSignal: (signal: TradeSignal) => void;
}

export const useMarketStore = create<MarketState>((set) => ({
  symbol: 'SPY',
  data: [],
  signals: [],
  setSymbol: (sym) => set({ symbol: sym }),
  setData: (data) => set({ data }),
  addCandle: (candle) => set((state) => {
    // Avoid duplicates by time
    const exists = state.data.some(d => d.time === candle.time);
    if (exists) {
      return { data: state.data.map(d => d.time === candle.time ? candle : d) };
    }
    return { data: [...state.data, candle] };
  }),
  addSignal: (signal) => set((state) => ({ signals: [signal, ...state.signals] })),
}));
