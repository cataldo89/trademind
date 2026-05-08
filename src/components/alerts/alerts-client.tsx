'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { AlertCondition, AlertStatus, Market } from '@/types'
import { Bell, Plus, Trash2, Loader2, CheckCircle, Clock, PauseCircle, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import { ZESTY_SYMBOLS } from '@/lib/market-data'

interface Alert {
  id: string
  symbol: string
  market: Market
  condition: AlertCondition
  value: number
  status: AlertStatus
  notify_email: boolean
  notify_app: boolean
  message?: string
  created_at: string
  triggered_at?: string
}

type SymbolSuggestion = {
  symbol: string
  name: string
}

const CONDITION_LABELS: Record<AlertCondition, string> = {
  price_above: 'Precio supera',
  price_below: 'Precio cae bajo',
  change_percent_above: '% cambio supera',
  change_percent_below: '% cambio cae bajo',
  volume_above: 'Volumen supera',
  rsi_above: 'RSI supera',
  rsi_below: 'RSI cae bajo',
  ma_crossover_bull: 'Cruce MA alcista',
  ma_crossover_bear: 'Cruce MA bajista',
}

const alertSchema = z.object({
  symbol: z.string().min(1, 'Requerido'),
  market: z.enum(['US']),
  condition: z.enum([
    'price_above', 'price_below', 'change_percent_above', 'change_percent_below',
    'volume_above', 'rsi_above', 'rsi_below', 'ma_crossover_bull', 'ma_crossover_bear',
  ] as const),
  value: z.string().min(1, 'Requerido').refine((v) => Number.isFinite(Number(v)), 'Valor invalido'),
  notifyEmail: z.boolean().default(false).optional(),
  message: z.string().optional(),
})

type AlertForm = {
  symbol: string
  market: 'US'
  condition: 'price_above' | 'price_below' | 'change_percent_above' | 'change_percent_below' | 'volume_above' | 'rsi_above' | 'rsi_below' | 'ma_crossover_bull' | 'ma_crossover_bear'
  value: string
  notifyEmail?: boolean
  message?: string
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase()
}

function uniqueSymbols(symbols: SymbolSuggestion[]) {
  const seen = new Set<string>()
  return symbols.filter((item) => {
    if (seen.has(item.symbol)) return false
    seen.add(item.symbol)
    return true
  })
}

function getSymbolSuggestions(query: string) {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return []

  const exactSymbol: SymbolSuggestion[] = []
  const symbolPrefix: SymbolSuggestion[] = []
  const namePrefix: SymbolSuggestion[] = []
  const contains: SymbolSuggestion[] = []

  for (const item of ZESTY_SYMBOLS) {
    const symbol = item.symbol.toUpperCase()
    const name = item.name
    const normalizedSymbol = normalizeText(symbol)
    const normalizedName = normalizeText(name)
    const candidate = { symbol, name }

    if (normalizedSymbol === normalizedQuery) exactSymbol.push(candidate)
    else if (normalizedSymbol.startsWith(normalizedQuery)) symbolPrefix.push(candidate)
    else if (normalizedName.startsWith(normalizedQuery)) namePrefix.push(candidate)
    else if (normalizedName.includes(normalizedQuery) || normalizedSymbol.includes(normalizedQuery)) contains.push(candidate)
  }

  return uniqueSymbols([...exactSymbol, ...symbolPrefix, ...namePrefix, ...contains]).slice(0, 6)
}

async function fetchAlerts(userId: string): Promise<Alert[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('alerts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  return data || []
}

async function fetchQuote(symbol: string, market: Market) {
  const res = await fetch(`/api/market/quote?symbol=${encodeURIComponent(symbol)}&market=${market}`, { cache: 'no-store' })
  if (!res.ok) return null
  const payload = await res.json()
  const quote = payload.data || payload
  const price = Number(quote?.price || quote?.regularMarketPrice)
  if (!Number.isFinite(price) || price <= 0) return null
  return {
    price,
    name: quote?.name || quote?.shortName || quote?.longName || symbol,
  }
}

export function AlertsClient() {
  const [showForm, setShowForm] = useState(false)
  const [symbolPreview, setSymbolPreview] = useState<SymbolSuggestion | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const queryClient = useQueryClient()
  const supabase = createClient()

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      return user
    },
  })

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ['alerts', user?.id],
    queryFn: () => fetchAlerts(user!.id),
    enabled: !!user,
    refetchInterval: 60 * 1000,
  })

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<AlertForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(alertSchema) as any,
    defaultValues: { market: 'US' as const, condition: 'price_above', notifyEmail: false },
  })

  const watchedSymbol = watch('symbol')
  const watchedValue = watch('value')
  const watchedMarket = watch('market')
  const suggestions = useMemo(() => getSymbolSuggestions(watchedSymbol || ''), [watchedSymbol])

  const selectSuggestion = (suggestion: SymbolSuggestion) => {
    setValue('symbol', suggestion.symbol, { shouldDirty: true, shouldValidate: true })
    setValue('market', 'US', { shouldDirty: true, shouldValidate: true })
    setSymbolPreview(suggestion)
  }

  useEffect(() => {
    const raw = watchedSymbol?.trim()
    if (!raw) {
      setSymbolPreview(null)
      return
    }

    const best = getSymbolSuggestions(raw)[0] || null
    if (!best) {
      setSymbolPreview(null)
      return
    }

    setSymbolPreview(best)

    const normalizedRaw = normalizeSymbol(raw)
    const normalizedName = normalizeText(best.name)
    const normalizedRawText = normalizeText(raw)
    if (normalizedRaw !== best.symbol && normalizedName.startsWith(normalizedRawText)) {
      setValue('symbol', best.symbol, { shouldDirty: true, shouldValidate: true })
    }
  }, [setValue, watchedSymbol])

  useEffect(() => {
    const symbol = symbolPreview?.symbol || normalizeSymbol(watchedSymbol || '')
    if (!symbol) return

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setQuoteLoading(true)
      try {
        const res = await fetch(`/api/market/quote?symbol=${encodeURIComponent(symbol)}&market=${watchedMarket || 'US'}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!res.ok) return
        const payload = await res.json()
        const quote = payload.data || payload
        const price = Number(quote?.price || quote?.regularMarketPrice)
        const name = quote?.name || quote?.shortName || quote?.longName || symbolPreview?.name
        if (name) setSymbolPreview({ symbol, name })
        if (!watchedValue && Number.isFinite(price) && price > 0) {
          setValue('value', price.toFixed(2), { shouldDirty: true, shouldValidate: true })
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') console.warn('[alert quote lookup]', error)
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false)
      }
    }, 350)

    return () => {
      controller.abort()
      clearTimeout(timer)
      setQuoteLoading(false)
    }
  }, [setValue, symbolPreview?.symbol, symbolPreview?.name, watchedMarket, watchedSymbol, watchedValue])

  const onSubmit = async (data: AlertForm) => {
    if (!user) return

    const suggestion = getSymbolSuggestions(data.symbol)[0]
    const symbol = suggestion?.symbol || normalizeSymbol(data.symbol)
    const numericValue = Number(data.value)
    if (!Number.isFinite(numericValue)) { toast.error('Valor invalido'); return }

    const quote = await fetchQuote(symbol, data.market)
    if (!quote) {
      toast.error(`No reconozco el simbolo ${symbol}`)
      return
    }

    const { error } = await supabase.from('alerts').insert({
      user_id: user.id,
      symbol,
      market: data.market,
      condition: data.condition,
      value: numericValue,
      current_value: quote.price,
      notify_email: data.notifyEmail || false,
      notify_app: true,
      message: data.message,
      status: 'active',
    })
    if (error) { toast.error(`Error al crear alerta: ${error.message}`); return }
    toast.success(`Alerta creada para ${symbol}`)
    reset()
    setSymbolPreview(null)
    setShowForm(false)
    queryClient.invalidateQueries({ queryKey: ['alerts'] })
  }

  const deleteAlert = async (id: string) => {
    const { error } = await supabase.from('alerts').delete().eq('id', id)
    if (error) { toast.error('Error al eliminar'); return }
    toast.success('Alerta eliminada')
    queryClient.invalidateQueries({ queryKey: ['alerts'] })
  }

  const toggleStatus = async (alert: Alert) => {
    const newStatus: AlertStatus = alert.status === 'active' ? 'paused' : 'active'
    const { error } = await supabase.from('alerts').update({ status: newStatus }).eq('id', alert.id)
    if (error) { toast.error('Error'); return }
    queryClient.invalidateQueries({ queryKey: ['alerts'] })
  }

  const activeCount = alerts.filter((a) => a.status === 'active').length
  const triggeredCount = alerts.filter((a) => a.status === 'triggered').length

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Alertas</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {activeCount} activas · {triggeredCount} disparadas
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nueva alerta
        </button>
      </div>

      {showForm && (
        <div className="glass rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Crear alerta</h3>
          <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="col-span-2 lg:col-span-1 relative">
              <label className="text-xs text-gray-400 block mb-1">Simbolo *</label>
              <input {...register('symbol')} placeholder="nvid, tesla, aapl..." autoComplete="off" className={inputClass} />
              {quoteLoading && <Loader2 className="absolute right-3 top-8 h-4 w-4 animate-spin text-emerald-400" />}
              {symbolPreview && (
                <button
                  type="button"
                  onClick={() => selectSuggestion(symbolPreview)}
                  className="mt-2 w-full rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-left text-xs text-emerald-200 hover:bg-emerald-500/15"
                >
                  Sugerido: <span className="font-mono font-bold text-white">{symbolPreview.symbol}</span> · {symbolPreview.name}
                </button>
              )}
              {suggestions.length > 1 && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/95 p-1 shadow-xl">
                  {suggestions.slice(0, 5).map((suggestion) => (
                    <button
                      key={suggestion.symbol}
                      type="button"
                      onClick={() => selectSuggestion(suggestion)}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-800 hover:text-white"
                    >
                      <span className="font-mono font-bold">{suggestion.symbol}</span>
                      <span className="truncate text-gray-500">{suggestion.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {errors.symbol && <p className="text-xs text-red-400 mt-1">{errors.symbol.message}</p>}
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Mercado</label>
              <select {...register('market')} className={inputClass}>
                <option value="US">USA</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Condicion</label>
              <select {...register('condition')} className={inputClass}>
                {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Valor *</label>
              <input type="number" step="any" {...register('value')} placeholder="Precio objetivo" className={inputClass} />
              {errors.value && <p className="text-xs text-red-400 mt-1">{errors.value.message}</p>}
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Mensaje (opcional)</label>
              <input {...register('message')} placeholder="Descripcion de la alerta..." className={inputClass} />
            </div>
            <div className="col-span-2 flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                <input type="checkbox" {...register('notifyEmail')} className="w-4 h-4 accent-emerald-500" />
                Notificar por email
              </label>
            </div>
            <div className="col-span-2 lg:col-span-4 flex gap-3">
              <button
                type="submit"
                disabled={isSubmitting || quoteLoading}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {(isSubmitting || quoteLoading) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Crear alerta
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="glass rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="py-16 text-center">
            <Bell className="w-10 h-10 text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No tienes alertas configuradas</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {alerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                onDelete={() => deleteAlert(alert.id)}
                onToggle={() => toggleStatus(alert)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AlertRow({
  alert,
  onDelete,
  onToggle,
}: {
  alert: Alert
  onDelete: () => void
  onToggle: () => void
}) {
  const statusConfig = {
    active: { icon: Clock, color: 'text-emerald-400', label: 'Activa', dot: 'bg-emerald-400 animate-pulse' },
    triggered: { icon: CheckCircle, color: 'text-yellow-400', label: 'Disparada', dot: 'bg-yellow-400' },
    paused: { icon: PauseCircle, color: 'text-gray-500', label: 'Pausada', dot: 'bg-gray-600' },
    expired: { icon: AlertTriangle, color: 'text-red-400', label: 'Expirada', dot: 'bg-red-400' },
  }

  const config = statusConfig[alert.status]
  const StatusIcon = config.icon

  return (
    <div className="flex items-center justify-between px-5 py-4">
      <div className="flex items-center gap-4 min-w-0">
        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', config.dot)} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-white text-sm">{alert.symbol}</span>
            <span className="text-xs text-gray-500">{alert.market}</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {CONDITION_LABELS[alert.condition]}: <span className="text-white font-mono">{alert.value}</span>
          </p>
          {alert.message && <p className="text-xs text-gray-600 mt-0.5">{alert.message}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0 ml-4">
        <span className={cn('flex items-center gap-1 text-xs', config.color)}>
          <StatusIcon className="w-3 h-3" />
          {config.label}
        </span>

        <button
          onClick={onToggle}
          className="text-xs text-gray-500 hover:text-white transition-colors px-2 py-1 rounded border border-gray-700 hover:border-gray-600"
        >
          {alert.status === 'active' ? 'Pausar' : 'Activar'}
        </button>

        <button
          onClick={onDelete}
          className="text-gray-600 hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

const inputClass = 'w-full px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 outline-none focus:border-emerald-500 transition-colors'
