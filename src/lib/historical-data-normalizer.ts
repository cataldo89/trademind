import type { Candle } from '@/types'

export type HistoricalNormalizationStatus = 'OK' | 'WARNING' | 'FAILED'
export type AdjustedStatus = 'adjusted' | 'unadjusted' | 'unknown'

export interface HistoricalDataNormalizerResult {
  symbol: string
  provider: string
  normalized_dataset: Candle[]
  row_count: number
  timezone: string
  currency?: string
  adjusted_status: AdjustedStatus
  normalization_status: HistoricalNormalizationStatus
  issues: { code: string; message: string; details?: Record<string, unknown> }[]
  warnings: { code: string; message: string; details?: Record<string, unknown> }[]
  raw_diagnostics: Record<string, unknown>
}

const PRICE_KEYS = ['open', 'high', 'low', 'close'] as const
const REQUIRED_KEYS = [...PRICE_KEYS, 'volume'] as const

function normalizeKey(key: string) {
  const normalized = key.trim().toLowerCase().replace(/[\s.-]+/g, '_')
  if (['date', 'datetime', 'timestamp', 'time'].includes(normalized)) return 'time'
  if (['adjclose', 'adj_close', 'adjusted_close'].includes(normalized)) return 'adj_close'
  return normalized
}

function numberOrNull(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function parseTime(value: unknown) {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000)
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)
  }
  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric)
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
  }
  return null
}

function adjustedStatus(metadata: Record<string, unknown>): AdjustedStatus {
  for (const key of ['adjusted', 'is_adjusted', 'auto_adjust', 'uses_adjusted_close']) {
    const value = metadata[key]
    if (typeof value === 'boolean') return value ? 'adjusted' : 'unadjusted'
    if (typeof value === 'string') {
      const normalized = value.toLowerCase()
      if (['true', 'yes', '1', 'adjusted'].includes(normalized)) return 'adjusted'
      if (['false', 'no', '0', 'raw', 'unadjusted'].includes(normalized)) return 'unadjusted'
    }
  }
  return 'unknown'
}

export function normalizeHistoricalData(input: {
  symbol: string
  provider: string
  market: string
  timeframe: string
  raw_dataset: Record<string, unknown>[]
  metadata?: Record<string, unknown>
}): HistoricalDataNormalizerResult {
  const metadata = input.metadata ?? {}
  const issues: HistoricalDataNormalizerResult['issues'] = []
  const warnings: HistoricalDataNormalizerResult['warnings'] = []
  const normalizedRows = input.raw_dataset.map((row) => {
    const normalized: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) normalized[normalizeKey(key)] = value
    return normalized
  })

  const sourceKeys = new Set(normalizedRows.flatMap(row => Object.keys(row)))
  const missingColumns = REQUIRED_KEYS.filter(key => !sourceKeys.has(key))
  if (!sourceKeys.has('time')) issues.push({ code: 'MISSING_TIME_COLUMN', message: 'Raw dataset has no date/time column.' })
  if (missingColumns.length) issues.push({ code: 'MISSING_OHLCV_COLUMNS', message: 'Raw dataset is missing OHLCV columns.', details: { missing_columns: missingColumns } })

  if (issues.length) {
    return {
      symbol: input.symbol,
      provider: input.provider,
      normalized_dataset: [],
      row_count: 0,
      timezone: String(metadata.timezone ?? metadata.tz ?? 'unknown'),
      currency: typeof metadata.currency === 'string' ? metadata.currency : undefined,
      adjusted_status: adjustedStatus(metadata),
      normalization_status: 'FAILED',
      issues,
      warnings,
      raw_diagnostics: { input_rows: input.raw_dataset.length, output_rows: 0 },
    }
  }

  const dedupe = new Set<string>()
  const candles: Candle[] = []
  let droppedRows = 0
  let duplicateRows = 0
  for (const row of normalizedRows) {
    const candle = {
      time: parseTime(row.time),
      open: numberOrNull(row.open),
      high: numberOrNull(row.high),
      low: numberOrNull(row.low),
      close: numberOrNull(row.close),
      volume: numberOrNull(row.volume),
    }
    if (candle.time === null || REQUIRED_KEYS.some(key => candle[key] === null)) {
      droppedRows += 1
      continue
    }
    if (PRICE_KEYS.some(key => (candle[key] as number) <= 0)) {
      droppedRows += 1
      issues.push({ code: 'NON_POSITIVE_PRICES_DROPPED', message: 'Rows with zero or negative prices were rejected.' })
      continue
    }
    const finalCandle = candle as Candle
    const signature = JSON.stringify(finalCandle)
    if (dedupe.has(signature)) {
      duplicateRows += 1
      continue
    }
    dedupe.add(signature)
    candles.push(finalCandle)
  }

  candles.sort((a, b) => a.time - b.time)
  const zeroVolume = candles.filter(candle => candle.volume <= 0).length
  if (zeroVolume) warnings.push({ code: 'ZERO_OR_NULL_VOLUME', message: 'Dataset contains zero or null volume.', details: { rows: zeroVolume } })
  if (duplicateRows) warnings.push({ code: 'DUPLICATE_ROWS_REMOVED', message: 'Exact duplicate candles were removed.', details: { rows: duplicateRows } })
  if (sourceKeys.has('adj_close') && adjustedStatus(metadata) === 'unknown') {
    warnings.push({ code: 'ADJUSTMENT_AMBIGUOUS', message: 'adj_close exists but OHLC adjustment status is not declared.' })
  }

  const status: HistoricalNormalizationStatus = candles.length === 0 ? 'FAILED' : issues.length || warnings.length || droppedRows ? 'WARNING' : 'OK'
  return {
    symbol: input.symbol,
    provider: input.provider,
    normalized_dataset: candles,
    row_count: candles.length,
    timezone: String(metadata.timezone ?? metadata.tz ?? 'unknown'),
    currency: typeof metadata.currency === 'string' ? metadata.currency : undefined,
    adjusted_status: adjustedStatus(metadata),
    normalization_status: status,
    issues,
    warnings,
    raw_diagnostics: { input_rows: input.raw_dataset.length, output_rows: candles.length, dropped_rows: droppedRows, duplicate_rows_removed: duplicateRows },
  }
}
