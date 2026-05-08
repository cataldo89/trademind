'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, LineChart, Briefcase, TrendingUp, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

const items = [
  { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
  { href: '/screener', label: 'Screener', icon: Search },
  { href: '/analysis', label: 'Análisis', icon: LineChart },
  { href: '/portfolio', label: 'Portafolio', icon: Briefcase },
  { href: '/signals', label: 'Señales', icon: TrendingUp },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-gray-950/95 backdrop-blur border-t border-gray-800 px-2 pb-safe-offset-1 pt-1">
      <div className="flex items-center justify-around">
        {items.map((item) => {
          const isActive = item.href === '/dashboard' 
            ? pathname === '/dashboard' 
            : pathname.startsWith(item.href)
            
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-1 py-2 px-3 transition-colors',
                isActive ? 'text-emerald-400' : 'text-gray-500 hover:text-gray-300'
              )}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
