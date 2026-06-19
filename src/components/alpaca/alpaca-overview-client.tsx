'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BarChart3, CheckCircle2, ExternalLink, Loader2, RefreshCw, Wallet } from 'lucide-react'

type ApiState<T> = {
  data: T | null
  loading: boolean
  error: string | null
}

type Connection = {
  connected: boolean
  environment: 'paper' | 'live'
  alpacaAccountId: string | null
}

type AlpacaAccount = {
  status?: string
  cash?: string
  buying_power?: string
  portfolio_value?: string
  equity?: string
}

type AlpacaPosition = {
  asset_id?: string
  symbol?: string
  qty?: string
  market_value?: string
  unrealized_pl?: string
  unrealized_plpc?: string
}

type AlpacaOrder = {
  id?: string
  symbol?: string
  side?: string
  type?: string
  status?: string
  qty?: string
  notional?: string
}

function currency(value?: string | number | null) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(number)
}

function percent(value?: string | number | null) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0.00%'
  return `${(number * 100).toFixed(2)}%`
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  const body = await response.json()
  if (!response.ok || body?.ok === false) throw new Error(body?.error || 'Request failed')
  return body.data as T
}

export function AlpacaOverviewClient() {
  const [connection, setConnection] = useState<ApiState<Connection>>({ data: null, loading: true, error: null })
  const [account, setAccount] = useState<ApiState<AlpacaAccount>>({ data: null, loading: true, error: null })
  const [positions, setPositions] = useState<ApiState<AlpacaPosition[]>>({ data: null, loading: true, error: null })
  const [orders, setOrders] = useState<ApiState<AlpacaOrder[]>>({ data: null, loading: true, error: null })

  async function load() {
    setConnection((current) => ({ ...current, loading: true, error: null }))
    try {
      const nextConnection = await fetchJson<Connection>('/api/alpaca/connection')
      setConnection({ data: nextConnection, loading: false, error: null })

      if (!nextConnection.connected) {
        setAccount({ data: null, loading: false, error: null })
        setPositions({ data: [], loading: false, error: null })
        setOrders({ data: [], loading: false, error: null })
        return
      }

      const [nextAccount, nextPositions, nextOrders] = await Promise.all([
        fetchJson<AlpacaAccount>('/api/alpaca/account'),
        fetchJson<AlpacaPosition[]>('/api/alpaca/positions'),
        fetchJson<AlpacaOrder[]>('/api/alpaca/orders'),
      ])

      setAccount({ data: nextAccount, loading: false, error: null })
      setPositions({ data: nextPositions, loading: false, error: null })
      setOrders({ data: nextOrders, loading: false, error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar Alpaca'
      setConnection((current) => ({ ...current, loading: false, error: message }))
      setAccount((current) => ({ ...current, loading: false }))
      setPositions((current) => ({ ...current, loading: false }))
      setOrders((current) => ({ ...current, loading: false }))
    }
  }

  useEffect(() => {
    load()
  }, [])

  const exposure = useMemo(() => {
    return (positions.data || []).reduce((sum, position) => sum + Number(position.market_value || 0), 0)
  }, [positions.data])

  if (connection.loading) {
    return (
      <div className="glass rounded-xl p-6 text-sm text-gray-300">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Cargando conexion Alpaca...
      </div>
    )
  }

  if (!connection.data?.connected) {
    return (
      <div className="glass rounded-xl p-8">
        <div className="max-w-2xl">
          <Wallet className="h-8 w-8 text-emerald-400" />
          <h2 className="mt-4 text-xl font-semibold text-white">Conecta Alpaca Paper</h2>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            Esta vista reemplazara gradualmente el portafolio virtual con datos reales de tu cuenta
            Alpaca Paper: equity, cash, buying power, posiciones y ordenes.
          </p>
          <a
            href="/api/alpaca/oauth/start"
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-gray-950 transition hover:bg-emerald-300"
          >
            Conectar Alpaca Paper
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Alpaca {connection.data.environment} conectado
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Account ID: <span className="font-mono text-gray-300">{connection.data.alpacaAccountId || 'Pendiente'}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:bg-gray-800"
        >
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Portfolio value" value={currency(account.data?.portfolio_value || account.data?.equity)} />
        <Metric label="Cash" value={currency(account.data?.cash)} />
        <Metric label="Buying power" value={currency(account.data?.buying_power)} />
        <Metric label="Exposicion" value={currency(exposure)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="glass rounded-xl p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Posiciones Alpaca</h2>
            <Link href="/portfolio" className="text-xs text-emerald-400 hover:text-emerald-300">
              Ver portafolio virtual
            </Link>
          </div>

          {positions.loading ? (
            <LoadingLine />
          ) : !positions.data?.length ? (
            <EmptyLine text="No hay posiciones abiertas en Alpaca Paper." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.12em] text-gray-500">
                  <tr>
                    <th className="py-2">Simbolo</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-right">Valor</th>
                    <th className="py-2 text-right">P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {positions.data.map((position) => (
                    <tr key={position.asset_id || position.symbol}>
                      <td className="py-3 font-semibold text-white">{position.symbol}</td>
                      <td className="py-3 text-right font-mono text-gray-300">{position.qty}</td>
                      <td className="py-3 text-right font-mono text-gray-300">{currency(position.market_value)}</td>
                      <td className="py-3 text-right font-mono text-gray-300">
                        {currency(position.unrealized_pl)} ({percent(position.unrealized_plpc)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="glass rounded-xl p-6">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-cyan-300" />
            <h2 className="text-sm font-semibold text-white">Ordenes recientes</h2>
          </div>

          {orders.loading ? (
            <LoadingLine />
          ) : !orders.data?.length ? (
            <EmptyLine text="No hay ordenes recientes." />
          ) : (
            <div className="space-y-3">
              {orders.data.slice(0, 8).map((order) => (
                <div key={order.id} className="rounded-lg border border-gray-800 bg-gray-950/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-white">{order.symbol}</p>
                    <span className="rounded-full border border-gray-700 px-2 py-0.5 text-xs text-gray-300">
                      {order.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {order.side} - {order.type} - {order.qty || currency(order.notional)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-xl p-5">
      <p className="text-xs uppercase tracking-[0.14em] text-gray-500">{label}</p>
      <p className="mt-2 font-mono text-xl font-semibold text-white">{value}</p>
    </div>
  )
}

function LoadingLine() {
  return (
    <p className="text-sm text-gray-400">
      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
      Cargando...
    </p>
  )
}

function EmptyLine({ text }: { text: string }) {
  return <p className="rounded-lg border border-gray-800 bg-gray-950/50 p-4 text-sm text-gray-400">{text}</p>
}
