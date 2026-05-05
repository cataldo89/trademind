#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_BASE = 'https://trademind-rose.vercel.app'
const DEFAULT_CONCURRENCY = 3
const DEFAULT_OUT = 'reports/zesty-symbol-health.json'
const REQUEST_TIMEOUT_MS = 20000

const STATUSES = [
  'chart_ok',
  'fallback_ok',
  'daily_or_history_only',
  'quote_only',
  'unsupported',
  'api_error',
]

function parseArgs(argv) {
  const options = {
    base: DEFAULT_BASE,
    limit: undefined,
    concurrency: DEFAULT_CONCURRENCY,
    out: DEFAULT_OUT,
  }

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue

    const [key, ...valueParts] = arg.slice(2).split('=')
    const value = valueParts.join('=')

    if (key === 'base' && value) {
      options.base = value.replace(/\/+$/, '')
    } else if (key === 'limit' && value) {
      options.limit = parsePositiveInteger(value, '--limit')
    } else if (key === 'concurrency' && value) {
      options.concurrency = parsePositiveInteger(value, '--concurrency')
    } else if (key === 'out' && value) {
      options.out = value
    } else {
      throw new Error(`Unknown or invalid option: ${arg}`)
    }
  }

  return options
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive integer`)
  }
  return parsed
}

async function readZestySymbols(projectRoot) {
  const marketDataPath = path.join(projectRoot, 'src', 'lib', 'market-data.ts')
  const source = await readFile(marketDataPath, 'utf8')
  const arrayMatch = source.match(/export\s+const\s+ZESTY_SYMBOLS\s*=\s*\[([\s\S]*?)\]\s*(?:\n|$)/)

  if (!arrayMatch) {
    throw new Error(`Could not find ZESTY_SYMBOLS in ${marketDataPath}`)
  }

  const symbols = []
  const objectRegex = /\{[\s\S]*?symbol\s*:\s*(['"])((?:\\.|(?!\1)[\s\S])*?)\1\s*,\s*name\s*:\s*(['"])((?:\\.|(?!\3)[\s\S])*?)\3[\s\S]*?\}/g
  let match

  while ((match = objectRegex.exec(arrayMatch[1])) !== null) {
    symbols.push({
      symbol: unescapeTsString(match[2]),
      name: unescapeTsString(match[4]),
    })
  }

  if (symbols.length === 0) {
    throw new Error('ZESTY_SYMBOLS was found, but no { symbol, name } objects were parsed')
  }

  return symbols
}

function unescapeTsString(value) {
  return value
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    const text = await response.text()
    const json = parseJson(text)

    return {
      ok: response.ok,
      httpStatus: response.status,
      status: response.ok ? 'ok' : `http_${response.status}`,
      json,
      error: response.ok ? undefined : extractError(json, text),
    }
  } catch (error) {
    return {
      ok: false,
      httpStatus: 0,
      status: 'fetch_error',
      json: undefined,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function parseJson(text) {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function extractError(json, text) {
  if (json && typeof json === 'object') {
    return json.error || json.message || json.reason || undefined
  }
  return text ? text.slice(0, 200) : undefined
}

async function auditSymbol(item, base) {
  const quoteUrl = buildUrl(base, '/api/market/quote', {
    symbol: item.symbol,
    market: 'US',
  })
  const candles1DUrl = buildUrl(base, '/api/market/candles', {
    symbol: item.symbol,
    range: '1D',
    market: 'US',
  })

  const [quoteResponse, candles1DResponse] = await Promise.all([
    fetchJson(quoteUrl),
    fetchJson(candles1DUrl),
  ])
  const quoteOk = isQuoteOk(quoteResponse)
  const candles1D = normalizeCandlesResponse(candles1DResponse, '1D')
  let candles1Y = emptyCandles('1Y')
  let candles5Y = emptyCandles('5Y')

  if (candles1D.count === 0) {
    const [candles1YResponse, candles5YResponse] = await Promise.all([
      fetchJson(buildUrl(base, '/api/market/candles', {
        symbol: item.symbol,
        range: '1Y',
        market: 'US',
      })),
      fetchJson(buildUrl(base, '/api/market/candles', {
        symbol: item.symbol,
        range: '5Y',
        market: 'US',
      })),
    ])
    candles1Y = normalizeCandlesResponse(candles1YResponse, '1Y')
    candles5Y = normalizeCandlesResponse(candles5YResponse, '5Y')
  }

  const responses = [quoteResponse, candles1D.response, candles1Y.response, candles5Y.response].filter(Boolean)
  const persistentApiError = responses.length > 0 && responses.every(isServerOrFetchError)
  const status = classifyResult({
    quoteOk,
    candles1D,
    candles1Y,
    candles5Y,
    persistentApiError,
  })

  return {
    symbol: item.symbol,
    name: item.name,
    status,
    quoteStatus: quoteResponse.status,
    candles1DCount: candles1D.count,
    effectiveRange: candles1D.effectiveRange,
    interval: candles1D.interval,
    fallbackReason: candles1D.fallbackReason,
    candles1YCount: candles1Y.count,
    candles5YCount: candles5Y.count,
  }
}

function buildUrl(base, pathname, params) {
  const url = new URL(pathname, base)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

function isQuoteOk(response) {
  if (!response.ok || !response.json || typeof response.json !== 'object') return false
  if (response.json.error || response.json.message === 'Not Found') return false

  const quote = response.json.quote && typeof response.json.quote === 'object'
    ? response.json.quote
    : response.json.data && typeof response.json.data === 'object'
      ? response.json.data
      : response.json

  return [quote.price, quote.regularMarketPrice, quote.currentPrice, quote.previousClose]
    .some((value) => typeof value === 'number' && Number.isFinite(value))
}

function normalizeCandlesResponse(response, requestedRange) {
  const json = response.json
  const data = findCandlesArray(json)
  const effectiveRange = findString(json, ['effectiveRange', 'range', 'requestedRange']) || requestedRange
  const interval = findString(json, ['interval', 'effectiveInterval', 'timeframe'])
  const fallbackReason = findString(json, ['fallbackReason', 'reason'])
  const fallback = Boolean(
    findBoolean(json, ['fallback', 'isFallback']) ||
    fallbackReason ||
    (effectiveRange && effectiveRange.toUpperCase() !== requestedRange.toUpperCase())
  )

  return {
    response,
    count: Array.isArray(data) ? data.length : 0,
    effectiveRange,
    interval,
    fallbackReason,
    fallback,
  }
}

function emptyCandles(requestedRange) {
  return {
    response: undefined,
    count: 0,
    effectiveRange: requestedRange,
    interval: undefined,
    fallbackReason: undefined,
    fallback: false,
  }
}

function findCandlesArray(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return undefined

  for (const key of ['data', 'candles', 'results', 'items']) {
    if (Array.isArray(value[key])) return value[key]
  }

  if (value.data && typeof value.data === 'object') {
    return findCandlesArray(value.data)
  }

  return undefined
}

function findString(value, keys) {
  if (!value || typeof value !== 'object') return undefined

  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key]) return value[key]
  }

  for (const nestedKey of ['meta', 'metadata']) {
    if (value[nestedKey] && typeof value[nestedKey] === 'object') {
      const nestedValue = findString(value[nestedKey], keys)
      if (nestedValue) return nestedValue
    }
  }

  return undefined
}

function findBoolean(value, keys) {
  if (!value || typeof value !== 'object') return undefined

  for (const key of keys) {
    if (typeof value[key] === 'boolean') return value[key]
  }

  for (const nestedKey of ['meta', 'metadata']) {
    if (value[nestedKey] && typeof value[nestedKey] === 'object') {
      const nestedValue = findBoolean(value[nestedKey], keys)
      if (typeof nestedValue === 'boolean') return nestedValue
    }
  }

  return undefined
}

function classifyResult({ quoteOk, candles1D, candles1Y, candles5Y, persistentApiError }) {
  if (candles1D.count > 0) {
    return candles1D.fallback ? 'fallback_ok' : 'chart_ok'
  }

  if (candles1Y.count > 0 || candles5Y.count > 0) return 'daily_or_history_only'
  if (quoteOk) return 'quote_only'
  if (persistentApiError) return 'api_error'
  return 'unsupported'
}

function isServerOrFetchError(response) {
  return response.status === 'fetch_error' || response.httpStatus >= 500
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

function buildTotals(results) {
  const totals = Object.fromEntries(STATUSES.map((status) => [status, 0]))
  for (const result of results) {
    totals[result.status] = (totals[result.status] || 0) + 1
  }
  return totals
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(scriptDir, '..')
  const options = parseArgs(process.argv.slice(2))
  const allSymbols = await readZestySymbols(projectRoot)
  const symbols = typeof options.limit === 'number'
    ? allSymbols.slice(0, options.limit)
    : allSymbols
  let completed = 0

  console.log(`Auditing ${symbols.length}/${allSymbols.length} Zesty symbols against ${options.base}`)

  const results = await mapWithConcurrency(symbols, options.concurrency, async (item) => {
    const result = await auditSymbol(item, options.base)
    completed += 1
    console.log(`[${completed}/${symbols.length}] ${result.symbol} ${result.status} candles=${result.candles1DCount}`)
    return result
  })

  const report = {
    base: options.base,
    generatedAt: new Date().toISOString(),
    totals: buildTotals(results),
    results,
  }
  const outPath = path.resolve(projectRoot, options.out)

  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(`Wrote ${path.relative(projectRoot, outPath)}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
