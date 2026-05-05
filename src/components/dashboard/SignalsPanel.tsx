'use client';

import { useMarketStore } from '@/store/marketStore';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown } from 'lucide-react';

export function SignalsPanel() {
  const { signals } = useMarketStore();

  return (
    <div className="flex flex-col bg-white/[0.02] border border-white/5 rounded-2xl p-4 backdrop-blur-sm h-full">
      <h3 className="text-lg font-bold text-white mb-4">Señales de IA Automáticas</h3>
      
      <div className="flex-1 overflow-y-auto pr-2 space-y-3">
        {signals.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">
            Esperando análisis del motor IA...
          </div>
        ) : (
          <AnimatePresence>
            {signals.map((signal) => (
              <motion.div
                key={signal.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className={`p-4 rounded-xl border ${
                  signal.action === 'BUY' 
                    ? 'bg-emerald-500/10 border-emerald-500/20' 
                    : 'bg-red-500/10 border-red-500/20'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {signal.action === 'BUY' ? (
                      <TrendingUp className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-red-400" />
                    )}
                    <span className={`font-bold ${signal.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {signal.action === 'BUY' ? 'COMPRA' : 'VENTA'}
                    </span>
                  </div>
                  <span className="text-sm font-mono text-gray-300">${signal.price.toFixed(2)}</span>
                </div>
                <p className="text-sm text-gray-400">{signal.reasoning}</p>
                <div className="mt-2 text-xs text-gray-500 flex justify-between">
                  <span>Confianza: {signal.confidence}%</span>
                  <span>{new Date(signal.timestamp).toLocaleTimeString()}</span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

# bumped: 2026-05-05T04:21:00