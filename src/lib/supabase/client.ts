import { createBrowserClient } from '@supabase/ssr'

const DEMO_SUPABASE_URL = 'https://demo.supabase.co'
const DEMO_SUPABASE_ANON_KEY = 'demo-anon-key'

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || DEMO_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEMO_SUPABASE_ANON_KEY
  )
}
