import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

function getEncryptionKey() {
  const rawKey = process.env.ALPACA_TOKEN_ENCRYPTION_KEY
  if (!rawKey) throw new Error('ALPACA_TOKEN_ENCRYPTION_KEY is required')

  const key = Buffer.from(rawKey, 'base64')
  if (key.length !== 32) {
    throw new Error('ALPACA_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
  }

  return key
}

export function encryptAlpacaToken(token: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.')
}

export function decryptAlpacaToken(payload: string) {
  const [ivRaw, authTagRaw, ciphertextRaw] = payload.split('.')
  if (!ivRaw || !authTagRaw || !ciphertextRaw) {
    throw new Error('Invalid encrypted Alpaca token payload')
  }

  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivRaw, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagRaw, 'base64'))

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
