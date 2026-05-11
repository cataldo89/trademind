'use client'

import { useState } from 'react'
import { Market } from '@/types'
import { Bot, Loader2, RefreshCcw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

interface AIAdvisorProps {
  symbol: string
  market: Market
}

interface AIAnalysisResponse {
  data?: {
    suggestion?: string
    provider?: string
    model?: string
  }
  error?: string
}

export function AIAdvisor({ symbol, market }: AIAdvisorProps) {
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [engine, setEngine] = useState<{ provider?: string; model?: string } | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleAnalyze = async () => {
    setIsLoading(true)
    setAnalysis(null)
    setEngine(null)
    
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, market }),
      })

      const payload = (await res.json()) as AIAnalysisResponse

      if (!res.ok) {
        throw new Error(payload.error || 'No se pudo conectar con el asesor IA')
      }

      setAnalysis(payload.data?.suggestion ?? '')
      setEngine({ provider: payload.data?.provider, model: payload.data?.model })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo conectar con el asesor IA'
      toast.error(message || 'No se pudo conectar con el asesor IA')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="p-4 mt-4 rounded-xl border border-indigo-500/30 bg-indigo-500/5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-indigo-400 flex items-center gap-2">
          <Bot className="w-4 h-4" />
          Asesor IA en la nube
        </h3>
      </div>

      {!analysis && !isLoading && (
        <div className="text-center py-4">
          <Sparkles className="w-8 h-8 text-indigo-400/50 mx-auto mb-2" />
          <p className="text-xs text-gray-400 mb-3">
            Analiza {symbol} con datos de mercado, titulares recientes y contexto técnico.
          </p>
          <button
            onClick={handleAnalyze}
            className="w-full py-2 text-xs font-medium bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Bot className="w-4 h-4" />
            Consultar asesor IA
          </button>
        </div>
      )}

      {isLoading && (
        <div className="flex flex-col items-center justify-center py-6 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
          <p className="text-xs text-gray-400">Analizando en la nube...</p>
        </div>
      )}

      {analysis && (
        <div className="space-y-4">
          <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
            {analysis.replace(/\*\*/g, '')}
          </div>
          {engine?.provider && (
            <p className="text-[11px] text-gray-500">
              Motor: {engine.provider}{engine.model ? ` (${engine.model})` : ''}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={async () => {
                const { createClient } = await import('@/lib/supabase/client')
                const supabaseClient = createClient()
                const { data: { user } } = await supabaseClient.auth.getUser()
                if (!user) { toast.error('Inicia sesion para operar'); return }

                const quoteRes = await fetch(`/api/market/quote?symbol=${encodeURIComponent(symbol)}&market=${market}`)
                if (!quoteRes.ok) { toast.error('No pude obtener precio actual'); return }
                const quotePayload = await quoteRes.json()
                const price = Number(quotePayload.data?.price || quotePayload.price)
                if (!Number.isFinite(price) || price <= 0) { toast.error('Precio actual invalido'); return }

                const amountInput = window.prompt(`Monto virtual a invertir en ${symbol}`, '100')
                if (amountInput === null) return
                const amount = Number(amountInput.trim().replace(',', '.'))
                if (!Number.isFinite(amount) || amount <= 0) { toast.error('Ingresa un monto valido'); return }

                const { data: { session } } = await supabaseClient.auth.getSession()
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
                    source: 'ai_advisor',
                    notes: 'Orden simulada desde asesor IA',
                  }),
                })
                const body = await res.json().catch(() => null)
                if (!res.ok || !body?.ok) throw new Error(body?.error?.message || 'No se pudo ejecutar la orden')
                toast.success('Operacion simulada ejecutada')
              }}
              className="py-1.5 text-xs font-bold bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
            >
              EJECUTAR
            </button>
            <button
              onClick={handleAnalyze}
              className="py-1.5 text-xs font-medium border border-indigo-500/50 hover:bg-indigo-500/10 text-indigo-400 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCcw className="w-3.5 h-3.5" />
              Regenerar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
