import { NextResponse, type NextRequest } from 'next/server'
import { getAuthenticatedContext } from '@/lib/api/auth'
import { getAlpacaEnv, getAlpacaOAuthConfig } from '@/lib/alpaca/config'
import { createAlpacaOAuthState, getAlpacaStateCookieName } from '@/lib/alpaca/oauth-state'

export async function GET(request: NextRequest) {
  try {
    const { user } = await getAuthenticatedContext(request)
    if (!user) {
      return NextResponse.redirect(new URL('/login?redirectTo=/settings', request.url))
    }

    const config = getAlpacaOAuthConfig()
    const environment = getAlpacaEnv()
    const state = createAlpacaOAuthState(user.id)
    const authorizeUrl = new URL(config.authorizeUrl)

    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('client_id', config.clientId)
    authorizeUrl.searchParams.set('redirect_uri', config.redirectUri)
    authorizeUrl.searchParams.set('state', state)
    authorizeUrl.searchParams.set('scope', 'account:write trading data')
    authorizeUrl.searchParams.set('env', environment)

    const response = NextResponse.redirect(authorizeUrl)
    response.cookies.set(getAlpacaStateCookieName(), state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 10 * 60,
    })

    return response
  } catch (error) {
    console.error('[alpaca/oauth/start]', error)
    return NextResponse.redirect(new URL('/settings?alpaca=missing_config', request.url))
  }
}
