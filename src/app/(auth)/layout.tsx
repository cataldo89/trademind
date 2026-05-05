import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { TrendingUp } from 'lucide-react'

export const metadata: Metadata = { title: 'Acceder' }

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (user) redirect('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-gray-950 via-gray-950 to-emerald-950/20 pointer-events-none" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(52,211,153,0.05),transparent_60%)] pointer-events-none" />

      <div className="relative flex flex-col items-center justify-center flex-1 px-4 py-12">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold text-white">TradeMind</span>
        </Link>

        {children}

        <p className="mt-8 text-center text-xs text-gray-600">
          Plataforma de análisis para mercados USA
        </p>
      </div>
    </div>
  )
}
