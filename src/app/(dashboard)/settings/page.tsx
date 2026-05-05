import type { Metadata } from 'next'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const metadata: Metadata = { title: 'Configuración' }

export default async function SettingsPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  let user = { id: 'test-user', email: 'test@trademind.com' } as User
  let profile = null

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = await createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) redirect('/login')

    user = authUser
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    profile = data
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Configuración</h1>
        <p className="text-sm text-gray-400 mt-0.5">Administra tu cuenta y preferencias</p>
      </div>

      {/* Profile Card */}
      <div className="glass rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-white">Perfil</h2>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center text-xl font-bold text-white">
            {user.email?.[0]?.toUpperCase()}
          </div>
          <div>
            <p className="text-white font-medium">{profile?.full_name || 'Sin nombre'}</p>
            <p className="text-sm text-gray-400">{user.email}</p>
            <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 capitalize">
              Plan {profile?.plan || 'free'}
            </span>
          </div>
        </div>
      </div>

      {/* API Keys info */}
      <div className="glass rounded-xl p-6 space-y-3">
        <h2 className="text-sm font-semibold text-white">APIs de mercado</h2>
        <p className="text-xs text-gray-400">
          Los datos del mercado se obtienen de APIs externas. Configura tus claves en el archivo <code className="text-emerald-400 font-mono bg-gray-800 px-1 rounded">.env.local</code>
        </p>

        <div className="space-y-2">
          {[
            { name: 'Yahoo Finance', status: 'Activo', note: 'No requiere API key', color: 'emerald' },
            { name: 'Alpha Vantage', status: 'Requiere key', note: 'ALPHA_VANTAGE_API_KEY', color: 'yellow' },
            { name: 'Finnhub', status: 'Requiere key', note: 'FINNHUB_API_KEY', color: 'yellow' },
          ].map((api) => (
            <div key={api.name} className="flex items-center justify-between py-2 border-b border-gray-800">
              <div>
                <p className="text-sm text-white">{api.name}</p>
                <p className="text-xs text-gray-500 font-mono">{api.note}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                api.color === 'emerald'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
              }`}>
                {api.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Account metadata */}
      <div className="glass rounded-xl p-6 space-y-3">
        <h2 className="text-sm font-semibold text-white">Cuenta</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">ID de usuario</span>
            <span className="font-mono text-xs text-gray-400">{user.id.slice(0, 16)}…</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Email confirmado</span>
            <span className={user.email_confirmed_at ? 'text-emerald-400' : 'text-yellow-400'}>
              {user.email_confirmed_at ? 'Sí' : 'Pendiente'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Última sesión</span>
            <span className="text-gray-400 text-xs">
              {user.last_sign_in_at
                ? new Date(user.last_sign_in_at).toLocaleString('es')
                : 'N/A'
              }
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
