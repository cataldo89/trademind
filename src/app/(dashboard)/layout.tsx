import type { Metadata } from 'next'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { AppSidebar } from '@/components/layout/sidebar'
import { AppHeader } from '@/components/layout/header'
import { MarketTicker } from '@/components/market/market-ticker'

export const metadata: Metadata = {
  title: 'Dashboard',
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const demoUser = { id: 'test-user', email: 'test@trademind.com' } as User
  let currentUser: User = demoUser

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (!error && user) {
      currentUser = user
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      {/* Sidebar */}
      <AppSidebar user={currentUser} />

      {/* Main content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Market ticker bar */}
        <MarketTicker />

        {/* Header */}
        <AppHeader user={currentUser} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
