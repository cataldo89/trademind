import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthenticatedContext } from '@/lib/api/auth'
import { getAlpacaEnv, getAlpacaOAuthConfig } from '@/lib/alpaca/config'
import { encryptAlpacaToken } from '@/lib/alpaca/crypto'
import { getAlpacaStateCookieName, verifyAlpacaOAuthState } from '@/lib/alpaca/oauth-state'

type AlpacaTokenResponse = {
  access_token?: string
  token_type?: string
  scope?: string
}

async function fetchAlpacaAccount(accessToken: string, environment: 'paper' | 'live') {
  const baseUrl = environment === 'live'
    ? 'https://api.alpaca.markets'
    : 'https://paper-api.alpaca.markets'

  const response = await fetch(`${baseUrl}/v2/account`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  })

  if (!response.ok) return null
  return response.json() as Promise<Record<string, unknown>>
}

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin

  try {
    const code = request.nextUrl.searchParams.get('code')
    const state = request.nextUrl.searchParams.get('state')
    const cookieState = request.cookies.get(getAlpacaStateCookieName())?.value

    const { user } = await getAuthenticatedContext(request)
    if (!user) {
      return NextResponse.redirect(new URL('/login?redirectTo=/settings', origin))
    }

    if (!code || !state || !cookieState || state !== cookieState || !verifyAlpacaOAuthState(state, user.id)) {
      return NextResponse.redirect(new URL('/settings?alpaca=invalid_state', origin))
    }

    const config = getAlpacaOAuthConfig()
    const environment = getAlpacaEnv()
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    })

    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    })

    if (!tokenResponse.ok) {
      console.error('[alpaca/oauth/callback token]', tokenResponse.status)
      return NextResponse.redirect(new URL('/settings?alpaca=token_error', origin))
    }

    const tokenJson = (await tokenResponse.json()) as AlpacaTokenResponse
    if (!tokenJson.access_token) {
      return NextResponse.redirect(new URL('/settings?alpaca=token_missing', origin))
    }

    const account = await fetchAlpacaAccount(tokenJson.access_token, environment)
    const admin = await createAdminClient()

    const { error } = await admin
      .from('alpaca_connections')
      .upsert({
        user_id: user.id,
        environment,
        status: 'connected',
        alpaca_account_id: typeof account?.id === 'string' ? account.id : null,
        scope: tokenJson.scope || null,
        token_type: tokenJson.token_type || 'bearer',
        access_token_encrypted: encryptAlpacaToken(tokenJson.access_token),
        raw_account: account || {},
        connected_at: new Date().toISOString(),
        disconnected_at: null,
        last_synced_at: account ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,environment' })

    if (error) {
      console.error('[alpaca/oauth/callback upsert]', error)
      return NextResponse.redirect(new URL('/settings?alpaca=save_error', origin))
    }

    const response = NextResponse.redirect(new URL('/settings?alpaca=connected', origin))
    response.cookies.delete(getAlpacaStateCookieName())
    return response
  } catch (error) {
    console.error('[alpaca/oauth/callback]', error)
    return NextResponse.redirect(new URL('/settings?alpaca=error', origin))
  }
}
