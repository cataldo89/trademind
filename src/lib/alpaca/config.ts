export type AlpacaEnvironment = 'paper' | 'live'

export function getAlpacaEnv(): AlpacaEnvironment {
  return process.env.ALPACA_DEFAULT_ENV === 'live' ? 'live' : 'paper'
}

export function getAlpacaTradingBaseUrl(environment: AlpacaEnvironment = getAlpacaEnv()) {
  return environment === 'live'
    ? 'https://api.alpaca.markets'
    : 'https://paper-api.alpaca.markets'
}

export function getAlpacaOAuthConfig() {
  const clientId = process.env.ALPACA_CLIENT_ID
  const clientSecret = process.env.ALPACA_CLIENT_SECRET
  const redirectUri = process.env.ALPACA_OAUTH_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Alpaca OAuth environment variables are required')
  }

  return {
    authorizeUrl: 'https://app.alpaca.markets/oauth/authorize',
    tokenUrl: 'https://api.alpaca.markets/oauth/token',
    clientId,
    clientSecret,
    redirectUri,
  }
}
