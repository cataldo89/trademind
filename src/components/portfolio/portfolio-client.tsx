'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { Market } from '@/types'
import { formatCurrency, formatPercent, getPnLColor, cn } from '@/lib/utils'
import {
  Plus, Loader2, TrendingUp, TrendingDown, Trash2, ArrowUpRight, Briefcase
} from 'lucide-react'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { ZESTY_SYMBOLS } from '@/lib/market-data'

interface Position {
  id: string
  symbol: string
  name: string
  market: Market
  quantity: number
  entry_price: number
  entry_date: string
  status: 'open' | 'closed'
  currency: string
  notes?: string
  // Live data
  currentPrice?: number
  pnl?: number
  pnlPercent?: number
  value?: number
}

const addPositionSchema = z.object({
  symbol: z.string().min(1, 'Requerido').toUpperCase(),
  name: z.string().optional(),
  market: z.enum(['US']),
  quantity: z.coerce.number().positive('Debe ser mayor a 0'),
  entryPrice: z.coerce.number().positive('Debe ser mayor a 0'),
  entryDate: z.string(),
  notes: z.string().optional(),
})

type AddPositionForm = z.infer<typeof addPositionSchema>

const DEFAULT_VIRTUAL_BALANCE = 10000

async function fetchPositionsWithPrices(userId: string): Promise<Position[]> {
  const supabase = createClient()
  const { data: positions } = await supabase
    .from('positions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('entry_date', { ascending: false })

  if (!positions || positions.length === 0) return []

  // Enrich with live prices
  const enriched = await Promise.all(
    positions.map(async (pos) => {
      try {
        const res = await fetch(`/api/market/quote?symbol=${pos.symbol}&market=${pos.market}`)
        if (!res.ok) return pos
        const data = await res.json()
        const quote = data.data
        if (!quote) return pos
        const value = quote.price * pos.quantity
        const cost = pos.entry_price * pos.quantity
        const pnl = value - cost
        const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0
        return { ...pos, currentPrice: quote.price, value, pnl, pnlPercent }
      } catch {
        return pos
      }
    })
  )

  return enriched
}

export function PortfolioClient() {
  const [showAddForm, setShowAddForm] = useState(false)
  const [showBalanceForm, setShowBalanceForm] = useState(false)
  const [balanceAmount, setBalanceAmount] = useState('')
  const [balanceSaving, setBalanceSaving] = useState(false)
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

  const { data: profile } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('virtual_balance').eq('id', user!.id).single()
      return data
    },
    enabled: !!user,
  })

  const { data: positions = [], isLoading } = useQuery({
    queryKey: ['positions', user?.id],
    queryFn: () => fetchPositionsWithPrices(user!.id),
    enabled: !!user,
    refetchInterval: 2 * 60 * 1000,
    staleTime: 60 * 1000,
  })

  const zestyBySymbol = useMemo(() => {
    return new Map(ZESTY_SYMBOLS.map((item) => [item.symbol, item]))
  }, [])

  const { data: signals = [] } = useQuery({
    queryKey: ['signals', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('signals').select('*').eq('status', 'active').order('created_at', { ascending: false })
      return data || []
    },
    enabled: !!user,
  })

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<AddPositionForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(addPositionSchema) as any,
    defaultValues: { market: 'US' as const, entryDate: new Date().toISOString().split('T')[0] },
  })

  const watchedSymbol = watch('symbol')
  const virtualBalance = Number(profile?.virtual_balance ?? DEFAULT_VIRTUAL_BALANCE)

  useEffect(() => {
    if (showBalanceForm) {
      setBalanceAmount(String(virtualBalance))
    }
  }, [showBalanceForm, virtualBalance])

  useEffect(() => {
    const symbol = watchedSymbol?.trim().toUpperCase()
    if (!symbol || symbol.length < 1) return

    const match = zestyBySymbol.get(symbol)
    if (match) {
      setValue('name', match.name, { shouldDirty: true })
    }

    if (!match && symbol.length < 2) return

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setQuoteLoading(true)
      try {
        const res = await fetch(`/api/market/quote?symbol=${encodeURIComponent(symbol)}&market=US`, { signal: controller.signal })
        if (!res.ok) return
        const payload = await res.json()
        const quote = payload.data || payload
        const price = quote?.price || quote?.regularMarketPrice
        const name = quote?.name || quote?.shortName || quote?.longName

        if (name) setValue('name', name, { shouldDirty: true })
        const numericPrice = Number(price)
        if (numericPrice > 0 && Number.isFinite(numericPrice)) {
          setValue('entryPrice', Number(numericPrice.toFixed(2)), { shouldDirty: true, shouldValidate: true })
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.warn('[portfolio quote lookup]', err)
        }
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false)
      }
    }, 450)

    return () => {
      controller.abort()
      clearTimeout(timer)
      setQuoteLoading(false)
    }
  }, [setValue, watchedSymbol, zestyBySymbol])

  const addPosition = async (data: AddPositionForm) => {
    if (!user) return
    const { error } = await supabase.from('positions').insert({
      user_id: user.id,
      symbol: data.symbol,
      name: data.name || data.symbol,
      market: data.market,
      quantity: data.quantity,
      entry_price: data.entryPrice,
      entry_date: data.entryDate,
      currency: 'USD',
      notes: data.notes,
      status: 'open',
    })
    if (error) { toast.error('Error al agregar posición'); return }
    toast.success(`Posición en ${data.symbol} agregada`)
    reset()
    setShowAddForm(false)
    queryClient.invalidateQueries({ queryKey: ['positions'] })
    queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] })
  }

  const closePosition = async (id: string, symbol: string) => {
    const { error } = await supabase
      .from('positions')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { toast.error('Error al cerrar posicion'); return }
    toast.success(`Posicion en ${symbol} cerrada`)
    queryClient.invalidateQueries({ queryKey: ['positions'] })
    queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] })
  }

  const updateVirtualBalance = async (nextBalance: number) => {
    if (!user) { toast.error('Inicia sesion para modificar el capital'); return }
    if (!Number.isFinite(nextBalance) || nextBalance < 0) {
      toast.error('Ingresa un capital virtual valido')
      return
    }

    setBalanceSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch('/api/profile/virtual-balance', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ virtualBalance: nextBalance }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || 'No se pudo actualizar capital virtual')
      }

      queryClient.setQueryData(['profile', user.id], { virtual_balance: nextBalance })
      toast.success(nextBalance === 0 ? 'Capital virtual eliminado' : `Capital virtual actualizado a ${formatCurrency(nextBalance)}`)
      setShowBalanceForm(false)
      queryClient.invalidateQueries({ queryKey: ['profile'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] })
    } catch (err) {
      console.warn('[update virtual balance]', err)
      toast.error('Error al actualizar capital virtual')
    } finally {
      setBalanceSaving(false)
    }
  }

  // Portfolio totals
  const totalValue = positions.reduce((sum, p) => sum + (p.value || p.entry_price * p.quantity), 0)
  const totalPnL = positions.reduce((sum, p) => sum + (p.pnl || 0), 0)
  const totalCost = positions.reduce((sum, p) => sum + p.entry_price * p.quantity, 0)
  const totalPnLPercent = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Portafolio</h1>
          <p className="text-sm text-gray-400 mt-0.5">{positions.length} posiciones abiertas</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBalanceForm((current) => !current)}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-semibold rounded-lg transition-colors border border-gray-700"
          >
            Ajustar capital
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nueva posición
          </button>
        </div>
      </div>

      {showBalanceForm && (
        <div className="glass rounded-xl p-5 border border-emerald-500/20">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Capital virtual del simulador</h3>
              <p className="text-xs text-gray-400 mt-1">Define el capital total disponible. Puedes bajarlo o dejarlo en cero sin afectar tus posiciones.</p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const nextBalance = balanceAmount.trim() === '' ? Number.NaN : Number(balanceAmount)
                updateVirtualBalance(nextBalance)
              }}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <FormField label="Capital total">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={balanceAmount}
                  onChange={(event) => setBalanceAmount(event.target.value)}
                  placeholder="10000"
                  className={inputClass}
                />
              </FormField>
              <div className="flex gap-2">
                {[0, 5000, 10000, 25000].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setBalanceAmount(String(amount))}
                    className="px-3 py-2 rounded-lg border border-gray-700 bg-gray-800/50 text-xs font-semibold text-gray-300 hover:border-emerald-500/50 hover:text-emerald-300 transition-colors"
                  >
                    {amount === 0 ? 'Cero' : formatCurrency(amount)}
                  </button>
                ))}
              </div>
              <button
                type="submit"
                disabled={balanceSaving}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {balanceSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Guardar
              </button>
              <button
                type="button"
                disabled={balanceSaving}
                onClick={() => updateVirtualBalance(0)}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-300 text-sm font-semibold rounded-lg transition-colors border border-red-500/30 disabled:opacity-50"
              >
                Eliminar capital
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard label="Capital Virtual" value={formatCurrency(virtualBalance)} color="emerald" />
        <SummaryCard label="Valor total" value={formatCurrency(totalValue)} />
        <SummaryCard label="Costo total" value={formatCurrency(totalCost)} />
        <SummaryCard
          label="P&L Total"
          value={`${totalPnL >= 0 ? '+' : ''}${formatCurrency(Math.abs(totalPnL))}`}
          sub={formatPercent(totalPnLPercent)}
          color={totalPnL >= 0 ? 'emerald' : 'red'}
        />
        <SummaryCard label="Posiciones" value={String(positions.length)} />
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="glass rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Nueva posición</h3>
          
          {signals.length > 0 && (
            <div className="mb-6 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
              <label className="block text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-2">Sincronizar con señal guardada</label>
              <div className="flex flex-wrap gap-2">
                {signals.map((sig: any) => (
                  <button
                    key={sig.id}
                    type="button"
                    onClick={() => {
                      setValue('symbol', sig.symbol, { shouldValidate: true })
                      setValue('market', 'US' as any)
                      setValue('entryPrice', sig.price, { shouldValidate: true })
                      toast.success(`Datos de ${sig.symbol} cargados`)
                    }}
                    className="px-2.5 py-1.5 text-[11px] font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-md transition-colors flex items-center gap-2"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {sig.symbol} @ {formatCurrency(sig.price)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit(addPosition)} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <FormField label="Símbolo *" error={errors.symbol?.message}>
              <input {...register('symbol')} list="portfolio-symbols" placeholder="NVDA, AMZN, SPY..." className={inputClass} />
              <datalist id="portfolio-symbols">
                {ZESTY_SYMBOLS.map((item) => (
                  <option key={item.symbol} value={item.symbol}>{item.name}</option>
                ))}
              </datalist>
            </FormField>
            <FormField label="Nombre">
              <input {...register('name')} placeholder="Se completa automáticamente" className={inputClass} />
            </FormField>
            <FormField label="Mercado">
              <select {...register('market')} className={inputClass}>
                <option value="US">USA</option>
              </select>
            </FormField>
            <FormField label="Cantidad *" error={errors.quantity?.message}>
              <input type="number" step="any" {...register('quantity')} placeholder="10" className={inputClass} />
            </FormField>
            <FormField label="Precio entrada *" error={errors.entryPrice?.message}>
              <div className="relative">
                <input type="number" step="any" {...register('entryPrice')} placeholder="Precio actual" className={inputClass} />
                {quoteLoading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-emerald-400" />}
              </div>
            </FormField>
            <FormField label="Fecha entrada">
              <input type="date" {...register('entryDate')} className={inputClass} />
            </FormField>
            <FormField label="Notas" className="col-span-2">
              <input {...register('notes')} placeholder="Notas opcionales..." className={inputClass} />
            </FormField>

            <div className="col-span-2 lg:col-span-4 flex gap-3">
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Agregar posición
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Positions table */}
      <div className="glass rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
          </div>
        ) : positions.length === 0 ? (
          <div className="py-16 text-center">
            <Briefcase className="w-10 h-10 text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No tienes posiciones abiertas</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="mt-3 text-xs text-emerald-400 hover:text-emerald-300"
            >
              Agregar tu primera posición →
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Símbolo', 'Cantidad', 'Precio entrada', 'Precio actual', 'Valor', 'P&L', 'P&L %', 'Acciones'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {positions.map((pos) => {
                  const isPnLPositive = (pos.pnl || 0) >= 0
                  return (
                    <tr key={pos.id} className="hover:bg-gray-800/20 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/analysis?symbol=${pos.symbol}&market=${pos.market}`} className="flex items-center gap-2 group">
                          <div className="w-7 h-7 rounded-lg bg-gray-800 flex items-center justify-center">
                            <span className="text-xs font-bold text-gray-400">{pos.symbol.slice(0, 2)}</span>
                          </div>
                          <div>
                            <p className="font-mono font-semibold text-white group-hover:text-emerald-400 transition-colors">
                              {pos.symbol}
                            </p>
                            <p className="text-xs text-gray-500">{pos.market}</p>
                          </div>
                          <ArrowUpRight className="w-3 h-3 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono text-white">{pos.quantity}</td>
                      <td className="px-4 py-3 font-mono text-white">{pos.entry_price.toFixed(2)}</td>
                      <td className="px-4 py-3 font-mono text-white">
                        {pos.currentPrice ? pos.currentPrice.toFixed(2) : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-white">
                        {pos.value ? formatCurrency(pos.value) : '—'}
                      </td>
                      <td className={cn('px-4 py-3 font-mono font-semibold', isPnLPositive ? 'text-emerald-400' : 'text-red-400')}>
                        {pos.pnl !== undefined ? `${isPnLPositive ? '+' : ''}${formatCurrency(Math.abs(pos.pnl))}` : '—'}
                      </td>
                      <td className={cn('px-4 py-3 font-mono font-semibold', isPnLPositive ? 'text-emerald-400' : 'text-red-400')}>
                        {pos.pnlPercent !== undefined ? formatPercent(pos.pnlPercent) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => closePosition(pos.id, pos.symbol)}
                          className="text-gray-600 hover:text-red-400 transition-colors p-1"
                          title="Cerrar posición"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const inputClass = 'w-full px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 outline-none focus:border-emerald-500 transition-colors'

function FormField({ label, error, children, className }: {
  label: string; error?: string; children: React.ReactNode; className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}

function SummaryCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: 'emerald' | 'red'
}) {
  return (
    <div className="glass rounded-xl p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={cn(
        'text-lg font-bold font-mono',
        color === 'emerald' ? 'text-emerald-400' : color === 'red' ? 'text-red-400' : 'text-white'
      )}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}
