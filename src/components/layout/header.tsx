'use client'

import { User } from '@supabase/supabase-js'
import { Bell, LogOut, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { MarketStatusBadge } from '@/components/market/market-status-badge'

interface AppHeaderProps {
  user: User
}

export function AppHeader({ user }: AppHeaderProps) {
  const router = useRouter()
  const hasSupabaseConfig = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )

  const handleLogout = async () => {
    if (hasSupabaseConfig) {
      const supabase = createClient()
      await supabase.auth.signOut()
    }

    router.push('/login')
    toast.success('Sesión cerrada')
  }

  return (
    <header className="h-14 border-b border-gray-800 bg-gray-900/60 backdrop-blur flex items-center justify-between px-4 flex-shrink-0">
      {/* Market status badges */}
      <div className="flex items-center gap-3">
        <MarketStatusBadge market="US" />
        <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
          <div className="w-1 h-1 rounded-full bg-indigo-400 animate-pulse" />
          Paper Trading
        </div>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-2">
        {/* Refresh */}
        <button
          onClick={() => router.refresh()}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          title="Actualizar datos"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* Notifications */}
        <button
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors relative"
          title={user.email || 'Notificaciones'}
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400" />
        </button>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-400/5 rounded-lg transition-colors"
          title="Cerrar sesión"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
