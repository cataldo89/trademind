'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User } from '@supabase/supabase-js'
import {
  LayoutDashboard,
  LineChart,
  Bell,
  Briefcase,
  Search,
  Settings,
  Shield,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState } from 'react'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  description?: string
  badge?: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    title: 'Inicio',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Flujo de inversión',
    items: [
      { href: '/screener', label: 'Screener', description: 'Encuentra oportunidades', icon: Search },
      { href: '/analysis', label: 'Análisis', description: 'Valida la señal', icon: LineChart },
      { href: '/portfolio', label: 'Portafolio', description: 'Gestiona posiciones', icon: Briefcase },
    ],
  },
  {
    title: 'Seguimiento',
    items: [
      { href: '/signals', label: 'Señales', description: 'Ideas guardadas', icon: TrendingUp },
      { href: '/alerts', label: 'Alertas', description: 'Avisos de precio', icon: Bell },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { href: '/settings', label: 'Configuración', icon: Settings },
    ],
  },
]

interface AppSidebarProps {
  user: User
}

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  const isAdmin = user.email?.includes('admin') // Simple admin check

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-gray-800 bg-gray-900/80 backdrop-blur transition-all duration-300',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between h-14 px-4 border-b border-gray-800">
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white text-sm">TradeMind</span>
          </Link>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center mx-auto">
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            'text-gray-400 hover:text-white transition-colors',
            collapsed && 'mx-auto'
          )}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 overflow-y-auto">
        <div className="space-y-4">
          {navSections.map((section) => (
            <div key={section.title} className="space-y-1">
              {!collapsed && (
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-600">
                  {section.title}
                </div>
              )}

              {section.items.map((item) => {
                const isActive =
                  item.href === '/dashboard'
                    ? pathname === '/dashboard'
                    : pathname.startsWith(item.href)

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
                      isActive
                        ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                        : 'text-gray-400 hover:bg-gray-800/60 hover:text-white',
                      collapsed && 'justify-center px-0'
                    )}
                    title={collapsed ? `${item.label}${item.description ? ` - ${item.description}` : ''}` : undefined}
                  >
                    <div className="flex-shrink-0">
                      <item.icon className="h-[18px] w-[18px]" />
                    </div>
                    {!collapsed && (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate">{item.label}</span>
                          {item.badge && (
                            <span className="ml-auto rounded-full bg-emerald-500 px-1.5 py-0.5 text-xs text-white">
                              {item.badge}
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className={cn('mt-0.5 truncate text-[11px]', isActive ? 'text-emerald-300/70' : 'text-gray-600 group-hover:text-gray-500')}>
                            {item.description}
                          </p>
                        )}
                      </div>
                    )}
                  </Link>
                )
              })}
            </div>
          ))}
        </div>

        {/* Admin link */}
        {isAdmin && (
          <Link
            href="/admin"
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
              pathname.startsWith('/admin')
                ? 'bg-violet-500/10 text-violet-400'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/60',
              collapsed && 'justify-center px-0'
            )}
          >
            <Shield className="w-[18px] h-[18px] flex-shrink-0" />
            {!collapsed && <span>Admin</span>}
          </Link>
        )}
      </nav>

      {/* User info */}
      {!collapsed && (
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-semibold">
                {user.email?.[0]?.toUpperCase() || 'U'}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white font-medium truncate">{user.email}</p>
              <p className="text-xs text-gray-500">Trader</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
