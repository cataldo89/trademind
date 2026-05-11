import { NextRequest } from 'next/server'
import { createClient, createClientForAuthToken } from '@/lib/supabase/server'

type UserScopedDbClient = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createClientForAuthToken>

export type AuthenticatedContext = {
  dbClient: UserScopedDbClient
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null } | null
  userError: unknown
}

export async function getAuthenticatedContext(request: NextRequest): Promise<AuthenticatedContext> {
  const userClient = await createClient()
  let dbClient: UserScopedDbClient = userClient
  let user: AuthenticatedContext['user'] = null
  let userError: unknown = null

  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '').trim()

  if (token) {
    const { data, error } = await userClient.auth.getUser(token)
    user = data?.user
      ? { id: data.user.id, email: data.user.email, user_metadata: data.user.user_metadata }
      : null
    userError = error

    if (user) {
      dbClient = createClientForAuthToken(token)
    }
  }

  if (!user) {
    const { data, error } = await userClient.auth.getUser()
    user = data?.user
      ? { id: data.user.id, email: data.user.email, user_metadata: data.user.user_metadata }
      : null
    userError = error
    dbClient = userClient
  }

  return { dbClient, user, userError }
}