import type { AuthenticatedContext } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/server'

export const DEFAULT_VIRTUAL_BALANCE = 10000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseVirtualBalance(value: unknown, fallback = DEFAULT_VIRTUAL_BALANCE) {
  const balance = Number(value)
  return Number.isFinite(balance) && balance >= 0 ? balance : fallback
}

async function getLatestUserMetadata(user: NonNullable<AuthenticatedContext['user']>) {
  const fallback = isRecord(user.user_metadata) ? user.user_metadata : {}

  try {
    const adminClient = await createAdminClient()
    const { data, error } = await adminClient.auth.admin.getUserById(user.id)
    if (!error && isRecord(data.user?.user_metadata)) {
      return data.user.user_metadata
    }
  } catch (error) {
    console.warn('[virtual-balance metadata read]', error)
  }

  return fallback
}

export async function getAuthMetadataVirtualBalance(user: NonNullable<AuthenticatedContext['user']>) {
  const metadata = await getLatestUserMetadata(user)
  return parseVirtualBalance(metadata.virtual_balance)
}

export async function saveAuthMetadataVirtualBalance(
  dbClient: AuthenticatedContext['dbClient'],
  user: NonNullable<AuthenticatedContext['user']>,
  virtualBalance: number
) {
  const metadata = await getLatestUserMetadata(user)

  try {
    const adminClient = await createAdminClient()
    const { error } = await adminClient.auth.admin.updateUserById(user.id, {
      user_metadata: { ...metadata, virtual_balance: virtualBalance },
    })

    if (!error) return null
    console.error('[virtual-balance metadata admin update]', error)
  } catch (error) {
    console.error('[virtual-balance metadata admin update fatal]', error)
  }

  const { error } = await dbClient.auth.updateUser({
    data: { ...metadata, virtual_balance: virtualBalance },
  })

  return error
}