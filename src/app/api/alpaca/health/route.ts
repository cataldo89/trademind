import { NextResponse } from 'next/server'
import { getAlpacaEnv } from '@/lib/alpaca/config'

type Probe = {
  ok: boolean
  status: number | null
  expectedStatus?: number[]
  error?: string
}

async function probe(url: string, expectedStatus: number[]): Promise<Probe> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'manual',
      headers: { Accept: 'application/json,text/html;q=0.9,*/*;q=0.8' },
    })

    return {
      ok: expectedStatus.includes(response.status),
      status: response.status,
      expectedStatus,
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      expectedStatus,
      error: error instanceof Error ? error.message : 'Unknown network error',
    }
  }
}

export async function GET() {
  const environment = getAlpacaEnv()
  const tradingBaseUrl = environment === 'live'
    ? 'https://api.alpaca.markets'
    : 'https://paper-api.alpaca.markets'

  const clientId = process.env.ALPACA_CLIENT_ID
  const redirectUri = process.env.ALPACA_OAUTH_REDIRECT_URI

  const authorizeUrl = new URL('https://app.alpaca.markets/oauth/authorize')
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', clientId || 'missing-client-id')
  authorizeUrl.searchParams.set('redirect_uri', redirectUri || 'https://missing-redirect-uri.invalid')
  authorizeUrl.searchParams.set('scope', 'account:write trading data')
  authorizeUrl.searchParams.set('env', environment)
  authorizeUrl.searchParams.set('state', 'healthcheck')

  const [oauthAuthorize, tradingApi] = await Promise.all([
    probe(authorizeUrl.toString(), [200, 302, 303, 307, 308, 400]),
    // 401/403 is a good network-level proof here: Vercel reached Alpaca, but no user OAuth token was sent.
    probe(`${tradingBaseUrl}/v2/account`, [401, 403]),
  ])

  const config = {
    environment,
    clientIdConfigured: Boolean(clientId),
    clientSecretConfigured: Boolean(process.env.ALPACA_CLIENT_SECRET),
    redirectUriConfigured: Boolean(redirectUri),
    tokenEncryptionConfigured: Boolean(process.env.ALPACA_TOKEN_ENCRYPTION_KEY),
    stateSecretConfigured: Boolean(process.env.ALPACA_OAUTH_STATE_SECRET),
    redirectUri,
  }

  const ok = Object.entries(config)
    .filter(([key]) => key.endsWith('Configured'))
    .every(([, value]) => value === true)
    && oauthAuthorize.ok
    && tradingApi.ok

  return NextResponse.json({
    ok,
    provider: 'alpaca',
    config,
    probes: {
      oauthAuthorize,
      tradingApi,
    },
    nextStep: ok
      ? 'Network and environment are ready. Connect a user through Alpaca OAuth, then verify /api/alpaca/account while logged in.'
      : 'Review missing env vars or blocked network probes.',
  }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
