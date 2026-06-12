import { createClient } from '@supabase/supabase-js'

type Market = 'US' | 'CL'

type CacheOptions<T> = {
  symbol: string
  market: Market
  range: string
  ttlMs: number
  provider?: string
  loader: () => Promise<T>
}

type MarketDataCacheRow<T> = {
  payload: T
  expires_at: string
}

function createCacheClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    return null
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function readMarketDataCache<T>(
  symbol: string,
  market: Market,
  range: string,
  provider: string,
  freshOnly: boolean
): Promise<T | null> {
  const client = createCacheClient()
  if (!client) return null

  try {
    let query = client
      .from('market_data_cache')
      .select('payload, expires_at')
      .eq('symbol', symbol)
      .eq('market', market)
      .eq('range', range)
      .eq('provider', provider)
      .limit(1)

    if (freshOnly) {
      query = query.gt('expires_at', new Date().toISOString())
    }

    const { data, error } = await query.maybeSingle<MarketDataCacheRow<T>>()

    if (error) {
      console.warn('[Market Data Cache] Read failed:', error.message)
      return null
    }

    return data?.payload ?? null
  } catch (error) {
    console.warn('[Market Data Cache] Read exception:', error)
    return null
  }
}

async function writeMarketDataCache<T>(
  symbol: string,
  market: Market,
  range: string,
  provider: string,
  ttlMs: number,
  payload: T
) {
  const client = createCacheClient()
  if (!client) return

  try {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttlMs)

    const { error } = await client
      .from('market_data_cache')
      .upsert({
        symbol,
        market,
        range,
        provider,
        payload,
        fetched_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      }, {
        onConflict: 'symbol,market,range,provider',
      })

    if (error) {
      console.warn('[Market Data Cache] Write failed:', error.message)
    }
  } catch (error) {
    console.warn('[Market Data Cache] Write exception:', error)
  }
}

export async function getDurableMarketData<T>({
  symbol,
  market,
  range,
  ttlMs,
  provider = 'yahoo-chart',
  loader,
}: CacheOptions<T>): Promise<T> {
  const normalizedSymbol = symbol.toUpperCase()
  const fresh = await readMarketDataCache<T>(normalizedSymbol, market, range, provider, true)

  if (fresh) {
    return fresh
  }

  try {
    const payload = await loader()
    await writeMarketDataCache(normalizedSymbol, market, range, provider, ttlMs, payload)
    return payload
  } catch (error) {
    const stale = await readMarketDataCache<T>(normalizedSymbol, market, range, provider, false)
    if (stale) {
      return stale
    }

    throw error
  }
}

// ---- Quant Results Cache ----

export async function readQuantResultsCache<T>(
  symbol: string,
  market: Market
): Promise<T | null> {
  const client = createCacheClient()
  if (!client) return null

  try {
    const { data, error } = await client
      .from('quant_results_cache')
      .select('result, expires_at')
      .eq('symbol', symbol.toUpperCase())
      .eq('market', market)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn('[Quant Results Cache] Read failed:', error.message)
      return null
    }

    return data?.result ?? null
  } catch (error) {
    console.warn('[Quant Results Cache] Read exception:', error)
    return null
  }
}

export async function writeQuantResultsCache<T>(
  symbol: string,
  market: Market,
  result: T,
  ttlMs: number = 24 * 60 * 60 * 1000 // 24 hours default
) {
  const client = createCacheClient()
  if (!client) return

  try {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttlMs)

    const { error } = await client
      .from('quant_results_cache')
      .upsert({
        symbol: symbol.toUpperCase(),
        market,
        result,
        fetched_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      }, {
        onConflict: 'symbol,market',
      })

    if (error) {
      console.warn('[Quant Results Cache] Write failed:', error.message)
    }
  } catch (error) {
    console.warn('[Quant Results Cache] Write exception:', error)
  }
}
