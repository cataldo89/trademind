'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { AlertCondition, AlertStatus, Market } from '@/types'
import { Bell, Plus, Trash2, Loader2, CheckCircle, Clock, PauseCircle, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { cn } from '@/lib/utils'

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
  value: z.string().transform((v) => parseFloat(v)),
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

async function fetchAlerts(userId: string): Promise<Alert[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('alerts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  return data || []
}

export function AlertsClient() {
  const [showForm, setShowForm] = useState(false)
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

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<AlertForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(alertSchema) as any,
    defaultValues: { market: 'US' as const, condition: 'price_above', notifyEmail: false },
  })

  const onSubmit = async (data: AlertForm) => {
    if (!user) return
    const numericValue = parseFloat(data.value)
    if (isNaN(numericValue)) { toast.error('Valor inválido'); return }
    const { error } = await supabase.from('alerts').insert({
      user_id: user.id,
      symbol: data.symbol.toUpperCase(),
      market: data.market,
      condition: data.condition,
      value: numericValue,
      notify_email: data.notifyEmail || false,
      notify_app: true,
      message: data.message,
      status: 'active',
    })
    if (error) { toast.error('Error al crear alerta'); return }
    toast.success(`Alerta creada para ${data.symbol.toUpperCase()}`)
    reset()
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
      {/* Header */}
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

      {/* Create form */}
      {showForm && (
        <div className="glass rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Crear alerta</h3>
          <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Símbolo *</label>
              <input {...register('symbol')} placeholder="AAPL" className={inputClass} />
              {errors.symbol && <p className="text-xs text-red-400 mt-1">{errors.symbol.message}</p>}
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Mercado</label>
              <select {...register('market')} className={inputClass}>
                <option value="US">USA</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Condición</label>
              <select {...register('condition')} className={inputClass}>
                {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Valor *</label>
              <input type="number" step="any" {...register('value')} placeholder="150.00" className={inputClass} />
              {errors.value && <p className="text-xs text-red-400 mt-1">{errors.value.message}</p>}
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-400 block mb-1">Mensaje (opcional)</label>
              <input {...register('message')} placeholder="Descripción de la alerta..." className={inputClass} />
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
                disabled={isSubmitting}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Crear alerta
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Alerts list */}
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

# bumped: 2026-05-05T04:21:00