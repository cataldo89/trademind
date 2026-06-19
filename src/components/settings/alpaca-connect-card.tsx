'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, Link2, Loader2, PlugZap, Unplug } from 'lucide-react'

type AlpacaConnectionStatus = {
  connected: boolean
  environment: 'paper' | 'live'
  status: 'connected' | 'disconnected' | 'error' | null
  alpacaAccountId: string | null
  scope: string | null
  connectedAt: string | null
  lastSyncedAt: string | null
}

export function AlpacaConnectCard() {
  const [status, setStatus] = useState<AlpacaConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)

  async function loadStatus() {
    setLoading(true)
    try {
      const response = await fetch('/api/alpaca/connection', { cache: 'no-store' })
      const body = await response.json()
      setStatus(body?.data ?? null)
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }

  async function disconnect() {
    setDisconnecting(true)
    try {
      await fetch('/api/alpaca/connection', { method: 'DELETE' })
      await loadStatus()
    } finally {
      setDisconnecting(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const connected = status?.connected

  return (
    <div className="glass rounded-xl p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <PlugZap className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">Alpaca Connect</h2>
          </div>
          <p className="mt-2 max-w-xl text-xs leading-5 text-gray-400">
            Conecta tu cuenta Alpaca Paper para que TradeMind pueda leer cuenta, posiciones y
            ejecutar órdenes solo cuando confirmes una operación.
          </p>
        </div>

        {loading ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-300">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Revisando
          </span>
        ) : connected ? (
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Paper conectado
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-300">
            <Link2 className="h-3.5 w-3.5" />
            Sin conectar
          </span>
        )}
      </div>

      {connected && (
        <div className="grid gap-3 rounded-lg border border-gray-800 bg-gray-950/50 p-4 text-xs sm:grid-cols-2">
          <div>
            <p className="text-gray-500">Ambiente</p>
            <p className="mt-1 font-mono text-emerald-300">{status.environment}</p>
          </div>
          <div>
            <p className="text-gray-500">Alpaca Account ID</p>
            <p className="mt-1 truncate font-mono text-gray-300">{status.alpacaAccountId || 'Pendiente'}</p>
          </div>
          <div>
            <p className="text-gray-500">Scopes</p>
            <p className="mt-1 truncate font-mono text-gray-300">{status.scope || 'read-only'}</p>
          </div>
          <div>
            <p className="text-gray-500">Conectado</p>
            <p className="mt-1 text-gray-300">
              {status.connectedAt ? new Date(status.connectedAt).toLocaleString('es') : 'N/A'}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        {connected ? (
          <>
            <a
              href="/api/alpaca/oauth/start"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-gray-950 transition hover:bg-emerald-300"
            >
              Reconectar
              <ExternalLink className="h-4 w-4" />
            </a>
            <button
              type="button"
              onClick={disconnect}
              disabled={disconnecting}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
              Desconectar
            </button>
          </>
        ) : (
          <a
            href="/api/alpaca/oauth/start"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-gray-950 transition hover:bg-emerald-300"
          >
            Conectar Alpaca Paper
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  )
}
