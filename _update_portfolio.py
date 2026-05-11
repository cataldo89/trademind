# -*- coding: utf-8 -*-
import os
path = r'C:\Users\catal\Desktop\IA\SAASFACTORY\IA SA AS TRADE CV\trademind\src\components\portfolio\portfolio-client.tsx'
with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

insert_after_line = -1
for i, line in enumerate(lines):
    if "SummaryCard label=" in line and "Posiciones" in line:
        for j in range(i+1, min(i+20, len(lines))):
            if '</div>' in lines[j] and 'grid' not in lines[j]:
                insert_after_line = j
                break
    if insert_after_line > 0:
        break

if insert_after_line < 0:
    print("Could not find insertion point")
else:
    pending_section = """


      {/* Pending Signals Section - Weekend/Holiday signals waiting for market open */}
      {pendingSignals.length > 0 && (
        <div className="glass rounded-xl p-5 border border-blue-500/20 bg-blue-500/5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-semibold text-white">Señales Pendientes ({pendingSignals.length})</h3>
            </div>
            <button
              onClick={handleExecutePending}
              disabled={pendingExecuting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {pendingExecuting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Ejecutar Todas
            </button>
          </div>

          {executedResults.length > 0 && (
            <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <p className="text-xs text-emerald-300 font-semibold">
                {executedResults.length} posicion(es) ejecutada(s exitosamente:
              </p>
              <div className="mt-1 space-y-0.5">
                {executedResults.map((r, i) => (
                  <p key={i} className="text-[10px] text-emerald-400/80 font-mono">
                    {r.symbol} @ ${r.price.toFixed(2)}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            {pendingSignals.map((sig) => (
              <div key={sig.id} className="flex items-center justify-between p-3 bg-gray-800/40 rounded-lg border border-gray-700">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <div>
                    <Link href={`/analysis?symbol=${sig.symbol}&market=${sig.market}`} className="text-xs font-mono font-bold text-white hover:text-emerald-400 transition-colors">
                      {sig.symbol}
                    </Link>
                    <p className="text-[10px] text-gray-500">{sig.timeframe} · Guardada hace {(Date.now() - new Date(sig.created_at).getTime()) / (1000 * 60 * 60).toFixed(0)}h</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono text-white">${sig.price.toFixed(2)}</p>
                  {sig.currentPrice && sig.performance !== undefined && (
                    <p className={`text-[10px] font-semibold ${sig.performance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {sig.performance >= 0 ? '+' : ''}{sig.performance.toFixed(2)}%
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-3 text-[10px] text-gray-500">
            Señales guardadas fuera de horario de mercado. Se ejecutaran al abrir con el precio actual del mercado.
          </p>
        </div>
      )}

"""
    
    new_lines = lines[:insert_after_line+1] + [pending_section] + lines[insert_after_line+1:]
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print(f"Pending signals section inserted after line {insert_after_line + 1}")