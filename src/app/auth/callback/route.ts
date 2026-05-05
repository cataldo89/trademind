import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Auth callback — handles email confirmation and password reset redirects
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  if (error) {
    console.error('[Auth Callback] Error:', error, errorDescription)
    const url = new URL('/login', origin)
    url.searchParams.set('error', error)
    return NextResponse.redirect(url)
  }

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              request.cookies.set(name, value)
            )
          },
        },
      }
    )

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (!exchangeError) {
      return NextResponse.redirect(new URL(next, origin))
    }
    console.error('[Auth Callback] Exchange error:', exchangeError)
  }

  return NextResponse.redirect(new URL('/login?error=auth_callback_failed', origin))
}

# bumped: 2026-05-05T04:21:00