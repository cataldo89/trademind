export interface CandleData {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TradeSignal {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  price: number;
  timestamp: string;
  confidence: number; // 0 to 100
  reasoning: string;
}
