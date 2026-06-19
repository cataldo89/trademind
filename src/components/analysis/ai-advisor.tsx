'use client'

import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Market } from '@/types'
import { Bot, Loader2, RefreshCcw, Sparkles, MessageSquare, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import type { AdvisorScreenerContext } from '@/lib/ai-advisor-context'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'

interface AIAdvisorProps {
  symbol: string
  market: Market
  technicalSignal?: {
    type: 'BUY' | 'SELL' | 'HOLD'
    strength: number
    reasons: string[]
  }
  range?: string
  screenerContext?: AdvisorScreenerContext
}

interface AIAnalysisResponse {
  data?: {
    suggestion?: string
    provider?: string
    model?: string
    promptContext?: string
  }
  error?: string
}

export function AIAdvisor({ symbol, market, technicalSignal, range, screenerContext }: AIAdvisorProps) {
  const queryClient = useQueryClient()
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [engine, setEngine] = useState<{ provider?: string; model?: string } | null>(null)
  const [promptContext, setPromptContext] = useState<string | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Chat states
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)

  const chatEndRef = useRef<HTMLDivElement>(null)

  const suggestionPrompts = [
    '¿Cuáles son los principales riesgos?',
    'Explícame las señales técnicas',
    '¿Qué dicen las noticias más recientes?'
  ]

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chatMessages, isChatLoading])

  // Listen to Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsChatOpen(false)
      }
    }
    if (isChatOpen) {
      window.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isChatOpen])

  const handleAnalyze = async () => {
    setIsLoading(true)
    setAnalysis(null)
    setEngine(null)
    setPromptContext(null)
    setChatMessages([]) // Clear chat messages on new analysis
    setChatInput('')

    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, market, technicalSignal, range, screenerContext }),
      })

      const payload = (await res.json()) as AIAnalysisResponse

      if (!res.ok) {
        throw new Error(payload.error || 'No se pudo conectar con el asesor IA')
      }

      setAnalysis(payload.data?.suggestion ?? '')
      setEngine({ provider: payload.data?.provider, model: payload.data?.model })
      setPromptContext(payload.data?.promptContext ?? null)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo conectar con el asesor IA'
      toast.error(message || 'No se pudo conectar con el asesor IA')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSendChatMessage = async (messageText?: string) => {
    const textToSend = messageText || chatInput
    if (!textToSend.trim() || isChatLoading) return

    const userMessage = { role: 'user' as const, content: textToSend }
    const updatedMessages = [...chatMessages, userMessage]

    setChatMessages(updatedMessages)
    if (!messageText) setChatInput('')
    setIsChatLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          market,
          promptContext,
          originalSuggestion: analysis,
          messages: updatedMessages,
        }),
      })

      if (!res.ok) {
        throw new Error('No se pudo obtener respuesta del Asesor IA')
      }

      const data = await res.json()
      setChatMessages([...updatedMessages, { role: 'assistant', content: data.text }])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al enviar mensaje')
    } finally {
      setIsChatLoading(false)
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

          <div className="grid grid-cols-2 gap-2 border-b border-indigo-500/20 pb-4">
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
                const idempotencyKey = crypto.randomUUID()
                let res = await fetch('/api/portfolio/trade', {
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
                    source: 'manual',
                    idempotencyKey,
                    notes: 'Orden simulada desde asesor IA',
                  }),
                })
                let body = await res.json().catch(() => null)
                if (body?.error?.code === 'TRADE_CONFIRMATION_REQUIRED') {
                  const confirmed = window.confirm(body.error.message || 'La operacion requiere confirmacion. Continuar con la ejecucion virtual?')
                  if (!confirmed) return
                  res = await fetch('/api/portfolio/trade', {
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
                      source: 'manual',
                      idempotencyKey,
                      confirmationAccepted: true,
                      notes: 'Orden simulada desde asesor IA',
                    }),
                  })
                  body = await res.json().catch(() => null)
                }
                if (!res.ok || !body?.ok) throw new Error(body?.error?.message || 'No se pudo ejecutar la orden')
                queryClient.invalidateQueries({ queryKey: ['positions'] })
                queryClient.invalidateQueries({ queryKey: ['profile'] })
                queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] })
                queryClient.invalidateQueries({ queryKey: ['live-portfolio-simulation'] })
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

            {/* Botón para abrir el Chat Interactivo (Modal Ventana) */}
            <button
              onClick={() => setIsChatOpen(true)}
              className="col-span-2 py-2 px-4 text-xs font-semibold bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 border border-indigo-400/20 active:scale-95"
            >
              <MessageSquare className="w-4 h-4 text-indigo-200 animate-pulse" />
              Preguntar al Asesor
            </button>

            {promptContext && (
              <button
                onClick={() => setShowPrompt(!showPrompt)}
                className="col-span-2 mt-1 py-1.5 text-[10px] font-medium border border-indigo-500/30 hover:bg-indigo-500/10 text-indigo-300 rounded-lg transition-colors"
              >
                {showPrompt ? 'Ocultar datos inyectados' : '¿Cómo sé que la IA usó mis datos? (Ver inyección)'}
              </button>
            )}
          </div>

          {showPrompt && promptContext && (
            <div className="mt-3 p-3 bg-black/40 border border-indigo-500/20 rounded-lg overflow-x-auto">
              <p className="text-[10px] font-bold text-indigo-400 mb-2 uppercase">Prompt exacto enviado a Gemini/OpenAI:</p>
              <pre className="text-[9px] text-gray-400 font-mono whitespace-pre-wrap">
                {promptContext}
              </pre>
            </div>
          )}

          {/* Ventana Modal de Chat Interactivo */}
          <AnimatePresence>
            {isChatOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
                {/* Backdrop click to close */}
                <div className="absolute inset-0" onClick={() => setIsChatOpen(false)} />

                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 20 }}
                  transition={{ type: 'spring', duration: 0.3 }}
                  className="relative w-full max-w-2xl h-[80vh] min-h-[500px] flex flex-col bg-gray-950/95 border border-indigo-500/30 rounded-2xl shadow-2xl overflow-hidden glass"
                >
                  {/* Cabecera */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-indigo-500/20 bg-gradient-to-r from-indigo-950/20 via-gray-900/30 to-purple-950/20">
                    <div className="flex items-center gap-3">
                      <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 shadow-inner">
                        <Bot className="w-5 h-5 text-indigo-400" />
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-gray-950 rounded-full animate-ping" />
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-gray-950 rounded-full" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-indigo-100 flex items-center gap-1.5">
                          Chat con Asesor IA: <span className="font-mono text-emerald-400">{symbol}</span>
                        </h3>
                        <p className="text-[11px] text-gray-400">Preguntas y respuestas sobre el análisis de mercado de {symbol}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setIsChatOpen(false)}
                      className="p-1.5 rounded-lg bg-gray-900/60 border border-gray-800 text-gray-400 hover:text-white hover:border-gray-700 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Recomendación inicial (Colapsable) */}
                  <div className="px-6 py-3 border-b border-indigo-500/10 bg-indigo-950/20">
                    <details className="group">
                      <summary className="flex items-center justify-between text-xs text-indigo-300 font-medium cursor-pointer list-none select-none">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Ver recomendación inicial</span>
                        </div>
                        <span className="text-[10px] text-gray-500 group-open:rotate-180 transition-transform">▼</span>
                      </summary>
                      <div className="mt-2 text-xs text-gray-400 max-h-32 overflow-y-auto whitespace-pre-wrap border-t border-indigo-500/10 pt-2 leading-relaxed font-sans">
                        {analysis.replace(/\*\*/g, '')}
                      </div>
                    </details>
                  </div>

                  {/* Historial de Mensajes */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin scrollbar-thumb-indigo-500/10 scrollbar-track-transparent">
                    {/* Mensaje de bienvenida inicial si está vacío */}
                    {chatMessages.length === 0 && (
                      <div className="flex gap-3 items-start mr-auto max-w-[85%]">
                        <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30 flex-shrink-0">
                          <Bot className="w-4 h-4 text-indigo-400" />
                        </div>
                        <div className="p-3.5 bg-indigo-950/30 border border-indigo-500/20 text-gray-300 rounded-2xl rounded-tl-none text-xs leading-relaxed shadow-sm space-y-1">
                          <p className="font-semibold text-[10px] text-indigo-400 uppercase tracking-wider">Asesor IA</p>
                          <p>He completado el análisis para <strong>{symbol}</strong>. ¿Tienes alguna pregunta sobre la recomendación, los indicadores técnicos o el comportamiento del activo?</p>
                        </div>
                      </div>
                    )}

                    {chatMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          'flex gap-3 items-start max-w-[85%]',
                          msg.role === 'user' ? 'ml-auto justify-end' : 'mr-auto'
                        )}
                      >
                        {msg.role !== 'user' && (
                          <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30 flex-shrink-0">
                            <Bot className="w-4 h-4 text-indigo-400" />
                          </div>
                        )}
                        <div
                          className={cn(
                            'p-3.5 rounded-2xl text-xs leading-relaxed shadow-sm whitespace-pre-wrap',
                            msg.role === 'user'
                              ? 'bg-gray-800/80 border border-gray-700/50 text-gray-200 rounded-tr-none'
                              : 'bg-indigo-950/40 border border-indigo-500/20 text-gray-300 rounded-tl-none'
                          )}
                        >
                          <span className="font-semibold block mb-1 text-[10px] text-gray-400 uppercase tracking-wider">
                            {msg.role === 'user' ? 'Tú' : 'Asesor IA'}
                          </span>
                          {msg.content}
                        </div>
                      </div>
                    ))}

                    {isChatLoading && (
                      <div className="flex gap-3 items-start mr-auto max-w-[85%]">
                        <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30 flex-shrink-0 animate-pulse">
                          <Bot className="w-4 h-4 text-indigo-400" />
                        </div>
                        <div className="p-3 bg-indigo-950/20 border border-indigo-500/10 text-gray-400 rounded-2xl rounded-tl-none text-xs flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                          <span>El asesor está escribiendo...</span>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Panel de Entrada e Inputs */}
                  <div className="p-4 border-t border-indigo-500/20 bg-gray-950/80 backdrop-blur-sm space-y-3">
                    {/* Botones de sugerencia */}
                    <div className="flex flex-wrap gap-1.5">
                      {suggestionPrompts.map((promptText, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSendChatMessage(promptText)}
                          disabled={isChatLoading}
                          className="px-2.5 py-1 text-[10px] font-medium border border-indigo-500/20 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-indigo-300 rounded-lg transition-all disabled:opacity-50 active:scale-95"
                        >
                          {promptText}
                        </button>
                      ))}
                    </div>

                    {/* Formulario de entrada */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleSendChatMessage()
                          }
                        }}
                        placeholder="Pregúntale más al asesor sobre este análisis..."
                        disabled={isChatLoading}
                        className="flex-1 px-3 py-2 text-xs bg-black/40 border border-indigo-500/30 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all disabled:opacity-50"
                      />
                      <button
                        onClick={() => handleSendChatMessage()}
                        disabled={isChatLoading || !chatInput.trim()}
                        className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all disabled:opacity-50 flex items-center gap-1.5 active:scale-95 shadow-md shadow-indigo-500/20"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Enviar</span>
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

        </div>
      )}
    </div>
  )
}
