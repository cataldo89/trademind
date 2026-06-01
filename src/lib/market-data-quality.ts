import type { Candle } from '@/types'

export type MarketDataQualityStatus = 'OK' | 'WARNING' | 'FAILED'

export interface MarketDataQualityIssue {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface MarketDataQualityInput {
  symbol: string
  provider: string
  timeframe: string
  start_date?: string
  end_date?: string
  dataset: Array<Partial<Candle> | Record<string, unknown>>
  metadata?: Record<string, unknown>
}

export interface MarketDataQualityResult {
  symbol: string
  provider: string
  timeframe: string
  status: MarketDataQualityStatus
  usable_for_chart: boolean
  usable_for_ta: boolean
  usable_for_ml: boolean
  usable_for_backtest: boolean
  quality_score: number
  issues: MarketDataQualityIssue[]
  warnings: MarketDataQualityIssue[]
  blocking_errors: MarketDataQualityIssue[]
  recommendation: string
  raw_diagnostics: Record<string, unknown>
}

const REQUIRED_PRICE_COLUMNS = ['open', 'high', 'low', 'close'] as const
const REQUIRED_COLUMNS = [...REQUIRED_PRICE_COLUMNS, 'volume'] as const

function issue(code: string, message: string, details?: Record<string, unknown>): MarketDataQualityIssue {
  return details ? { code, message, details } : { code, message }
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function parseTime(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)
  }

  if (typeof value === 'string') {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric)
    }
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
  }

  return null
}

function rowValue(row: Partial<Candle> | Record<string, unknown>, key: string) {
  return (row as Record<string, unknown>)[key]
}

function normalizeCandle(row: Partial<Candle> | Record<string, unknown>) {
  return {
    time: parseTime(rowValue(row, 'time') ?? rowValue(row, 'timestamp') ?? rowValue(row, 'date') ?? rowValue(row, 'datetime')),
    open: toFiniteNumber(rowValue(row, 'open') ?? rowValue(row, 'Open')),
    high: toFiniteNumber(rowValue(row, 'high') ?? rowValue(row, 'High')),
    low: toFiniteNumber(rowValue(row, 'low') ?? rowValue(row, 'Low')),
    close: toFiniteNumber(rowValue(row, 'close') ?? rowValue(row, 'Close')),
    volume: toFiniteNumber(rowValue(row, 'volume') ?? rowValue(row, 'Volume')),
  }
}

function metadataFailure(metadata: Record<string, unknown>) {
  for (const key of ['error', 'provider_error', 'failure', 'exception']) {
    const value = metadata[key]
    if (value) return String(value)
  }

  const status = String(metadata.status ?? metadata.provider_status ?? '').toLowerCase()
  if (['error', 'failed', 'failure', 'no_data', 'empty'].includes(status)) return status

  for (const key of ['note', 'information', 'warning']) {
    const value = metadata[key]
    const text = String(value ?? '').toLowerCase()
    if (value && ['limit', 'error', 'fail', 'empty', 'no data'].some(token => text.includes(token))) {
      return String(value)
    }
  }

  return null
}

function adjustmentStatus(metadata: Record<string, unknown>): boolean | null {
  for (const key of ['adjusted', 'is_adjusted', 'auto_adjust', 'uses_adjusted_close']) {
    const value = metadata[key]
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      const normalized = value.toLowerCase()
      if (['true', 'yes', '1', 'adjusted'].includes(normalized)) return true
      if (['false', 'no', '0', 'raw', 'unadjusted'].includes(normalized)) return false
    }
  }
  return null
}

function qualityThresholds(timeframe: string) {
  const normalized = timeframe.toLowerCase()
  const intraday = ['1m', '5m', '15m', '30m', '1h', '4h'].includes(normalized)
  return {
    min_chart_candles: 1,
    min_ta_candles: 50,
    min_ml_candles: 120,
    min_backtest_candles: 252,
    min_ml_history_days: intraday ? 20 : 180,
    min_backtest_history_days: intraday ? 60 : 365,
  }
}

function expectedIntervalSeconds(timeframe: string, observedMedian: number | null) {
  const mapping: Record<string, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
    daily: 86400,
    '1w': 604800,
    '1wk': 604800,
    weekly: 604800,
  }
  return mapping[timeframe.toLowerCase()] ?? observedMedian ?? 86400
}

function businessDayCount(startSeconds: number, endSeconds: number) {
  let count = 0
  const current = new Date(startSeconds * 1000)
  current.setUTCHours(0, 0, 0, 0)
  const end = new Date(endSeconds * 1000)
  end.setUTCHours(0, 0, 0, 0)

  while (current <= end) {
    const day = current.getUTCDay()
    if (day !== 0 && day !== 6) count += 1
    current.setUTCDate(current.getUTCDate() + 1)
  }

  return count
}

export function assessMarketDataQuality(input: MarketDataQualityInput): MarketDataQualityResult {
  const metadata = input.metadata ?? {}
  const thresholds = qualityThresholds(input.timeframe)
  const rows = input.dataset.map(normalizeCandle)
  const rowCount = rows.length

  const issues: MarketDataQualityIssue[] = []
  const warnings: MarketDataQualityIssue[] = []
  const blocking_errors: MarketDataQualityIssue[] = []
  let score = 100

  const provider_failure = metadataFailure(metadata)
  if (provider_failure) {
    blocking_errors.push(issue('PROVIDER_FAILURE', 'Provider reported a failure.', { provider_failure }))
    score -= 50
  }

  if (rowCount === 0) {
    blocking_errors.push(issue('EMPTY_DATASET', 'Dataset is empty.'))
    if (!provider_failure) {
      blocking_errors.push(issue('PROVIDER_SILENT_FAILURE', 'Provider returned no rows without a structured error.'))
    }
    score -= 80
  }

  const sourceKeys = new Set(input.dataset.flatMap(row => Object.keys(row).map(key => key.toLowerCase())))
  const missing_columns = REQUIRED_COLUMNS.filter(column => !sourceKeys.has(column))
  const hasTime = rows.some(row => row.time !== null)

  if (!hasTime) {
    blocking_errors.push(issue('MISSING_TIME_COLUMN', 'Dataset has no usable time/date column.'))
    score -= 40
  }

  if (rowCount > 0 && missing_columns.length > 0) {
    blocking_errors.push(issue('MISSING_OHLCV_COLUMNS', 'Dataset is missing required OHLCV columns.', { missing_columns }))
    score -= 45
  }

  const null_counts = Object.fromEntries(
    REQUIRED_COLUMNS.map(column => [column, rows.filter(row => row[column] === null).length])
  )
  const null_price_cells = REQUIRED_PRICE_COLUMNS.reduce((total, column) => total + null_counts[column], 0)
  if (null_price_cells > 0) {
    issues.push(issue('NULL_PRICE_VALUES', 'Open/high/low/close contain null values.', { null_price_cells }))
    score -= Math.min(25, null_price_cells * 2)
  }

  const non_positive_price_count = rows.filter(row =>
    REQUIRED_PRICE_COLUMNS.some(column => {
      const value = row[column]
      return value !== null && value <= 0
    })
  ).length
  if (non_positive_price_count > 0) {
    blocking_errors.push(issue('NON_POSITIVE_PRICES', 'Dataset contains zero or negative OHLC prices.', { rows: non_positive_price_count }))
    score -= 45
  }

  const invalid_ohlc_count = rows.filter(row => {
    if (REQUIRED_PRICE_COLUMNS.some(column => row[column] === null)) return false
    const high = row.high as number
    const low = row.low as number
    return high < Math.max(row.open as number, row.close as number, low) ||
      low > Math.min(row.open as number, row.close as number, high)
  }).length
  if (invalid_ohlc_count > 0) {
    blocking_errors.push(issue('INVALID_OHLC_RANGE', 'OHLC rows have inconsistent high/low ranges.', { rows: invalid_ohlc_count }))
    score -= 35
  }

  const null_volume_count = null_counts.volume
  const zero_volume_count = rows.filter(row => (row.volume ?? 0) <= 0).length
  if (null_volume_count > 0) {
    warnings.push(issue('NULL_VOLUME_VALUES', 'Volume contains null values.', { rows: null_volume_count }))
    score -= Math.min(12, null_volume_count)
  }

  const zero_volume_ratio = rowCount ? zero_volume_count / rowCount : 0
  if (zero_volume_ratio >= 0.8) {
    issues.push(issue('SUSPICIOUS_VOLUME', 'Most candles have zero or missing volume.', { zero_volume_ratio }))
    score -= 20
  } else if (zero_volume_count > 0) {
    warnings.push(issue('ZERO_VOLUME_CANDLES', 'Some candles have zero volume.', { rows: zero_volume_count }))
    score -= Math.min(10, zero_volume_count)
  }

  const validTimes = rows.map(row => row.time).filter((time): time is number => time !== null)
  const chronological = validTimes.every((time, index) => index === 0 || time >= validTimes[index - 1])
  if (!chronological) {
    issues.push(issue('NOT_CHRONOLOGICAL', 'Candles are not sorted in chronological order.'))
    score -= 15
  }

  const seenTimes = new Set<number>()
  let duplicate_time_count = 0
  for (const time of validTimes) {
    if (seenTimes.has(time)) duplicate_time_count += 1
    seenTimes.add(time)
  }
  if (duplicate_time_count > 0) {
    issues.push(issue('DUPLICATE_TIMESTAMPS', 'Dataset contains duplicated timestamps.', { rows: duplicate_time_count }))
    score -= 15
  }

  const sortedTimes = Array.from(seenTimes).sort((a, b) => a - b)
  const min_time = sortedTimes[0] ? new Date(sortedTimes[0] * 1000).toISOString() : null
  const max_time = sortedTimes.length ? new Date(sortedTimes[sortedTimes.length - 1] * 1000).toISOString() : null
  const history_days = sortedTimes.length > 1 ? (sortedTimes[sortedTimes.length - 1] - sortedTimes[0]) / 86400 : 0
  const deltas = sortedTimes.slice(1).map((time, index) => time - sortedTimes[index])
  const sortedDeltas = [...deltas].sort((a, b) => a - b)
  const median_gap_seconds = sortedDeltas.length ? sortedDeltas[Math.floor(sortedDeltas.length / 2)] : null
  const max_gap_seconds = sortedDeltas.length ? sortedDeltas[sortedDeltas.length - 1] : null
  const expectedSeconds = expectedIntervalSeconds(input.timeframe, median_gap_seconds)
  const large_gap_count = deltas.filter(delta => delta > expectedSeconds * 3.5).length
  if (large_gap_count > 0) {
    warnings.push(issue('TEMPORAL_GAPS', 'Dataset has temporal gaps larger than expected.', { large_gap_count }))
    score -= Math.min(20, large_gap_count * 2)
  }

  let expected_missing_periods = 0
  let expected_missing_ratio = 0
  if (input.timeframe.toLowerCase() === '1d' && sortedTimes.length > 1) {
    const expectedDays = businessDayCount(sortedTimes[0], sortedTimes[sortedTimes.length - 1])
    expected_missing_periods = Math.max(0, expectedDays - seenTimes.size)
    expected_missing_ratio = expectedDays ? expected_missing_periods / expectedDays : 0
    if (expected_missing_ratio > 0.15) {
      issues.push(issue('MISSING_DATES', 'Dataset is missing too many expected trading dates.', {
        missing_periods: expected_missing_periods,
        missing_ratio: expected_missing_ratio,
      }))
      score -= 20
    } else if (expected_missing_periods > 0) {
      warnings.push(issue('MISSING_DATES_MINOR', 'Dataset has some missing expected trading dates.', {
        missing_periods: expected_missing_periods,
        missing_ratio: expected_missing_ratio,
      }))
      score -= Math.min(10, expected_missing_periods)
    }
  }

  const adjusted = adjustmentStatus(metadata)
  if (adjusted === false) {
    warnings.push(issue('UNADJUSTED_DATA', 'Provider metadata says prices are not adjusted.'))
    score -= 15
  } else if (adjusted === null) {
    warnings.push(issue('ADJUSTMENT_UNKNOWN', 'Provider metadata does not declare whether prices are adjusted.'))
    score -= 5
  }

  if (rowCount < thresholds.min_ta_candles) {
    warnings.push(issue('INSUFFICIENT_TA_HISTORY', 'Dataset has too few candles for reliable technical analysis.', {
      min_required: thresholds.min_ta_candles,
      actual: rowCount,
    }))
    score -= 25
  }

  if (rowCount < thresholds.min_ml_candles || history_days < thresholds.min_ml_history_days) {
    warnings.push(issue('INSUFFICIENT_ML_HISTORY', 'Dataset has too little history for ML models.', {
      min_candles: thresholds.min_ml_candles,
      actual_candles: rowCount,
      min_history_days: thresholds.min_ml_history_days,
      actual_history_days: history_days,
    }))
    score -= 20
  }

  if (rowCount < thresholds.min_backtest_candles || history_days < thresholds.min_backtest_history_days) {
    warnings.push(issue('INSUFFICIENT_BACKTEST_HISTORY', 'Dataset has too little history for backtesting.', {
      min_candles: thresholds.min_backtest_candles,
      actual_candles: rowCount,
      min_history_days: thresholds.min_backtest_history_days,
      actual_history_days: history_days,
    }))
    score -= 10
  }

  const quality_score = Math.max(0, Math.min(100, Math.round(score)))
  const noBlockingErrors = blocking_errors.length === 0
  const severeMissingDates = expected_missing_ratio > 0.15
  const severeGaps = rowCount > 0 && large_gap_count > Math.max(1, Math.floor(rowCount * 0.05))
  const volumeQualityOk = rowCount > 0 && zero_volume_ratio < 0.8 && (null_volume_count / rowCount) < 0.2

  const usable_for_chart = noBlockingErrors && rowCount >= thresholds.min_chart_candles
  const usable_for_ta = usable_for_chart &&
    rowCount >= thresholds.min_ta_candles &&
    chronological &&
    duplicate_time_count === 0 &&
    !severeMissingDates
  const usable_for_ml = usable_for_ta &&
    rowCount >= thresholds.min_ml_candles &&
    history_days >= thresholds.min_ml_history_days &&
    volumeQualityOk &&
    !severeGaps &&
    adjusted !== false
  const usable_for_backtest = usable_for_ml &&
    rowCount >= thresholds.min_backtest_candles &&
    history_days >= thresholds.min_backtest_history_days

  const status: MarketDataQualityStatus = !usable_for_chart
    ? 'FAILED'
    : !usable_for_ml || !usable_for_backtest || issues.length > 0 || quality_score < 80
      ? 'WARNING'
      : 'OK'

  const recommendation = !usable_for_chart
    ? 'Bloquear graficos, analisis tecnico, ML y backtesting hasta corregir datos OHLCV.'
    : !usable_for_ml
      ? 'Usar como maximo para grafico/diagnostico; no ejecutar ML ni emitir BUY/SELL confiado.'
      : !usable_for_backtest
        ? 'Datos aptos para TA/ML, pero no para backtesting robusto.'
        : 'Datos aptos para grafico, TA, ML y backtesting bajo los umbrales actuales.'

  return {
    symbol: input.symbol,
    provider: input.provider,
    timeframe: input.timeframe,
    status,
    usable_for_chart,
    usable_for_ta,
    usable_for_ml,
    usable_for_backtest,
    quality_score,
    issues,
    warnings,
    blocking_errors,
    recommendation,
    raw_diagnostics: {
      row_count: rowCount,
      required_columns: REQUIRED_COLUMNS,
      missing_columns,
      null_counts,
      non_positive_price_count,
      invalid_ohlc_count,
      null_volume_count,
      zero_volume_count,
      duplicate_time_count,
      chronological,
      min_time,
      max_time,
      history_days,
      expected_missing_periods,
      expected_missing_ratio,
      large_gap_count,
      median_gap_seconds,
      max_gap_seconds,
      adjusted,
      provider_failure,
      thresholds,
      start_date: input.start_date,
      end_date: input.end_date,
    },
  }
}
