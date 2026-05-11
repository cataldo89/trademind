import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedContext, type AuthenticatedContext } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/server'

type Payload = {
  virtualBalance?: number
}

type DbError = {
  code?: string
  message?: string
}

type VirtualBalanceData = {
  virtual_balance: number
}

const DEFAULT_VIRTUAL_BALANCE = 10000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getErrorCode(error: unknown) {
  return isRecord(error) ? String(error.code || '') : ''
}

function isMissingVirtualBalanceColumn(error: unknown) {
  const code = getErrorCode(error)
  const message = isRecord(error) ? String(error.message || '') : ''
  return code === '42703' || code === 'PGRST204' || message.includes('virtual_balance')
}

function parseVirtualBalance(value: unknown) {
  const balance = Number(value)
  return Number.isFinite(balance) && balance >= 0 ? balance : DEFAULT_VIRTUAL_BALANCE
}

function getMetadataBalance(user: NonNullable<AuthenticatedContext['user']>) {
  return parseVirtualBalance(user.user_metadata?.virtual_balance)
}

async function getLatestMetadataBalance(user: NonNullable<AuthenticatedContext['user']>) {
  try {
    const adminClient = await createAdminClient()
    const { data, error } = await adminClient.auth.admin.getUserById(user.id)
    if (!error) {
      return parseVirtualBalance(data.user?.user_metadata?.virtual_balance)
    }
  } catch (error) {
    console.warn('[api/profile/capital auth metadata read]', error)
  }

  return getMetadataBalance(user)
}
function profileResponse(virtualBalance: number, source: 'profiles' | 'auth_metadata' | 'default') {
  return NextResponse.json({
    data: { virtual_balance: virtualBalance } satisfies VirtualBalanceData,
    source,
  })
}

async function saveBalanceInAuthMetadata(
  dbClient: AuthenticatedContext['dbClient'],
  user: NonNullable<AuthenticatedContext['user']>,
  virtualBalance: number
) {
  const metadata = isRecord(user.user_metadata) ? user.user_metadata : {}

  try {
    const adminClient = await createAdminClient()
    const { error } = await adminClient.auth.admin.updateUserById(user.id, {
      user_metadata: { ...metadata, virtual_balance: virtualBalance },
    })

    if (!error) {
      return profileResponse(virtualBalance, 'auth_metadata')
    }

    console.error('[api/profile/capital auth metadata admin]', error)
  } catch (error) {
    console.error('[api/profile/capital auth metadata admin fatal]', error)
  }

  const { error } = await dbClient.auth.updateUser({
    data: { ...metadata, virtual_balance: virtualBalance },
  })

  if (error) {
    console.error('[api/profile/capital auth metadata]', error)
    return NextResponse.json({ error: 'Failed to update virtual balance' }, { status: 500 })
  }

  return profileResponse(virtualBalance, 'auth_metadata')
}
async function createMissingProfile(user: NonNullable<AuthenticatedContext['user']>, virtualBalance: number) {
  try {
    const adminClient = await createAdminClient()
    return await adminClient
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email || '',
        virtual_balance: virtualBalance,
      }, { onConflict: 'id' })
      .select('virtual_balance')
      .single()
  } catch (error) {
    return { data: null, error: error as DbError }
  }
}

export async function GET(request: NextRequest) {
  try {
    const { dbClient, user, userError } = await getAuthenticatedContext(request)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await dbClient
      .from('profiles')
      .select('virtual_balance')
      .eq('id', user.id)
      .maybeSingle()

    if (error) {
      if (isMissingVirtualBalanceColumn(error)) {
        return profileResponse(await getLatestMetadataBalance(user), 'auth_metadata')
      }

      console.error('[api/profile/virtual-balance GET]', error)
      return NextResponse.json({ error: 'Failed to load virtual balance' }, { status: 500 })
    }

    return profileResponse(parseVirtualBalance(data?.virtual_balance), data ? 'profiles' : 'default')
  } catch (error) {
    console.error('[api/profile/virtual-balance GET fatal]', error)
    return NextResponse.json({ error: 'Unexpected profile error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { dbClient, user, userError } = await getAuthenticatedContext(request)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await request.json().catch(() => null) as Payload | null
    const virtualBalance = Number(payload?.virtualBalance)

    if (!Number.isFinite(virtualBalance) || virtualBalance < 0) {
      return NextResponse.json({ error: 'Invalid virtual balance' }, { status: 400 })
    }

    const { data: updateData, error: updateError } = await dbClient
      .from('profiles')
      .update({ virtual_balance: virtualBalance })
      .eq('id', user.id)
      .select('virtual_balance')
      .maybeSingle()

    if (updateError) {
      if (isMissingVirtualBalanceColumn(updateError)) {
        return saveBalanceInAuthMetadata(dbClient, user, virtualBalance)
      }

      console.error('[api/profile/virtual-balance PATCH]', updateError)
      return NextResponse.json({ error: 'Failed to update virtual balance' }, { status: 500 })
    }

    if (updateData) {
      return profileResponse(parseVirtualBalance(updateData.virtual_balance), 'profiles')
    }

    const { data: profileData, error: profileError } = await createMissingProfile(user, virtualBalance)
    if (profileError) {
      if (isMissingVirtualBalanceColumn(profileError)) {
        return saveBalanceInAuthMetadata(dbClient, user, virtualBalance)
      }

      console.error('[api/profile/virtual-balance profile upsert]', profileError)
      return saveBalanceInAuthMetadata(dbClient, user, virtualBalance)
    }

    return profileResponse(parseVirtualBalance(profileData?.virtual_balance), 'profiles')
  } catch (error) {
    console.error('[api/profile/virtual-balance PATCH fatal]', error)
    return NextResponse.json({ error: 'Unexpected profile error' }, { status: 500 })
  }
}