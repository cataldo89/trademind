import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Shield, Users, Bell, TrendingUp, Briefcase } from 'lucide-react'

export const metadata: Metadata = { title: 'Admin' }

export default async function AdminPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  let usersCount = 0
  let alertsCount = 0
  let positionsCount = 0
  let signalsCount = 0

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/login')

    // Fetch stats using service role client would be better.
    const [profiles, alerts, positions, signals] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('alerts').select('*', { count: 'exact', head: true }),
      supabase.from('positions').select('*', { count: 'exact', head: true }),
      supabase.from('signals').select('*', { count: 'exact', head: true }),
    ])

    usersCount = profiles.count ?? 0
    alertsCount = alerts.count ?? 0
    positionsCount = positions.count ?? 0
    signalsCount = signals.count ?? 0
  }

  const stats = [
    { label: 'Usuarios', value: usersCount ?? 0, icon: Users, color: 'emerald' },
    { label: 'Alertas totales', value: alertsCount ?? 0, icon: Bell, color: 'yellow' },
    { label: 'Posiciones abiertas', value: positionsCount ?? 0, icon: Briefcase, color: 'cyan' },
    { label: 'Señales generadas', value: signalsCount ?? 0, icon: TrendingUp, color: 'violet' },
  ]

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
          <Shield className="w-4 h-4 text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
          <p className="text-sm text-gray-400">Vista de control interno</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="glass rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <stat.icon className={`w-4 h-4 text-${stat.color}-400`} />
              <span className="text-xs text-gray-500">{stat.label}</span>
            </div>
            <p className={`text-2xl font-bold font-mono text-${stat.color}-400`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* System info */}
      <div className="glass rounded-xl p-6">
        <h2 className="text-sm font-semibold text-white mb-4">Estado del sistema</h2>
        <div className="space-y-3">
          {[
            { label: 'Supabase Auth', status: supabaseUrl && supabaseAnonKey ? 'Conectado' : 'Modo demo', ok: true },
            { label: 'Base de datos', status: supabaseUrl && supabaseAnonKey ? 'Conectada' : 'Modo demo', ok: true },
            { label: 'Yahoo Finance API', status: 'Sin key requerida', ok: true },
            { label: 'Alpha Vantage API', status: process.env.ALPHA_VANTAGE_API_KEY ? 'Configurada' : 'Key no configurada', ok: !!process.env.ALPHA_VANTAGE_API_KEY },
            { label: 'Finnhub API', status: process.env.FINNHUB_API_KEY ? 'Configurada' : 'Key no configurada', ok: !!process.env.FINNHUB_API_KEY },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between py-2 border-b border-gray-800">
              <span className="text-sm text-gray-400">{item.label}</span>
              <span className={`text-xs font-medium ${item.ok ? 'text-emerald-400' : 'text-yellow-400'}`}>
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Version info */}
      <div className="text-xs text-gray-700 space-y-1">
        <p>TradeMind v1.0.0</p>
        <p>Next.js 14 · Supabase · Yahoo Finance · Lightweight Charts</p>
        <p>Mercados: NYSE/NASDAQ (USA)</p>
      </div>
    </div>
  )
}

# bumped: 2026-05-05T04:21:00