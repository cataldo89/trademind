import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const STATE_COOKIE = 'trademind_alpaca_oauth_state'

function getStateSecret() {
  const secret = process.env.ALPACA_OAUTH_STATE_SECRET
  if (!secret) throw new Error('ALPACA_OAUTH_STATE_SECRET is required')
  return secret
}

function sign(value: string) {
  return createHmac('sha256', getStateSecret()).update(value).digest('base64url')
}

export function getAlpacaStateCookieName() {
  return STATE_COOKIE
}

export function createAlpacaOAuthState(userId: string) {
  const payload = {
    userId,
    nonce: randomBytes(24).toString('base64url'),
    createdAt: Date.now(),
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${sign(encoded)}`
}

export function verifyAlpacaOAuthState(state: string, expectedUserId: string) {
  const [encoded, signature] = state.split('.')
  if (!encoded || !signature) return false

  const expectedSignature = sign(encoded)
  const left = Buffer.from(signature)
  const right = Buffer.from(expectedSignature)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
    userId?: string
    createdAt?: number
  }

  const ageMs = Date.now() - Number(payload.createdAt || 0)
  return payload.userId === expectedUserId && ageMs >= 0 && ageMs <= 10 * 60 * 1000
}
