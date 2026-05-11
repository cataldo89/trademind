type CacheEntry<T> = {
  expiresAt: number
  value: T
}

const cache = new Map<string, CacheEntry<unknown>>()

export async function getCached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const current = cache.get(key) as CacheEntry<T> | undefined

  if (current && current.expiresAt > now) {
    return current.value
  }

  const value = await loader()
  cache.set(key, { value, expiresAt: now + ttlMs })
  return value
}