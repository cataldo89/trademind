import { createAdminClient } from '@/lib/supabase/server'
import { decryptAlpacaToken } from './crypto'
import { getAlpacaTradingBaseUrl, type AlpacaEnvironment } from './config'

export type AlpacaConnectionStatus = {
  connected: boolean
  environment: AlpacaEnvironment
  status: 'connected' | 'disconnected' | 'error' | null
  alpacaAccountId: string | null
  scope: string | null
  connectedAt: string | null
  lastSyncedAt: string | null
}

type AlpacaConnectionRow = {
  environment: AlpacaEnvironment
  status: 'connected' | 'disconnected' | 'error'
  alpaca_account_id: string | null
  scope: string | null
  connected_at: string | null
  last_synced_at: string | null
  access_token_encrypted?: string | null
}

export async function getAlpacaConnectionStatus(
  userId: string,
  environment: AlpacaEnvironment = 'paper'
): Promise<AlpacaConnectionStatus> {
  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('alpaca_connections')
    .select('environment,status,alpaca_account_id,scope,connected_at,last_synced_at')
    .eq('user_id', userId)
    .eq('environment', environment)
    .maybeSingle()

  if (error) throw error

  const row = data as AlpacaConnectionRow | null
  return {
    connected: row?.status === 'connected',
    environment,
    status: row?.status ?? null,
    alpacaAccountId: row?.alpaca_account_id ?? null,
    scope: row?.scope ?? null,
    connectedAt: row?.connected_at ?? null,
    lastSyncedAt: row?.last_synced_at ?? null,
  }
}

export async function getAlpacaAccessToken(userId: string, environment: AlpacaEnvironment = 'paper') {
  const admin = await createAdminClient()
  const { data, error } = await admin
    .from('alpaca_connections')
    .select('access_token_encrypted,status')
    .eq('user_id', userId)
    .eq('environment', environment)
    .maybeSingle()

  if (error) throw error
  const row = data as Pick<AlpacaConnectionRow, 'access_token_encrypted' | 'status'> | null

  if (!row || row.status !== 'connected' || !row.access_token_encrypted) {
    return null
  }

  return decryptAlpacaToken(row.access_token_encrypted)
}

export async function callAlpacaTradingApi<T>(
  userId: string,
  path: string,
  environment: AlpacaEnvironment = 'paper',
  init?: RequestInit
): Promise<T> {
  const token = await getAlpacaAccessToken(userId, environment)
  if (!token) throw new Error('Alpaca account is not connected')

  const response = await fetch(`${getAlpacaTradingBaseUrl(environment)}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Alpaca request failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}
