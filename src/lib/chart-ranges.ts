export type ChartRange = '1D' | '5D' | '1M' | '6M' | 'YTD' | '1Y' | '5Y' | 'ALL'

export type YahooChartInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk' | '1mo'

export interface ChartRangeConfig {
  range: ChartRange
  label: string
  interval: YahooChartInterval
  period1: Date
  refetchMs: number
  description: string
}

export const CHART_RANGES: Array<{ range: ChartRange; label: string }> = [
  { range: '1D', label: '1D' },
  { range: '5D', label: '5D' },
  { range: '1M', label: '1M' },
  { range: '6M', label: '6M' },
  { range: 'YTD', label: 'YTD' },
  { range: '1Y', label: '1Y' },
  { range: '5Y', label: '5Y' },
  { range: 'ALL', label: 'All' },
]

const CHART_RANGE_SET = new Set<ChartRange>(CHART_RANGES.map(({ range }) => range))

export function normalizeChartRange(value: string | null | undefined): ChartRange {
  const normalized = value?.trim().toUpperCase()

  if (normalized && CHART_RANGE_SET.has(normalized as ChartRange)) {
    return normalized as ChartRange
  }

  return '1D'
}

function subtractDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() - days)
  return result
}

function subtractMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setMonth(result.getMonth() - months)
  return result
}

function subtractYears(date: Date, years: number): Date {
  const result = new Date(date)
  result.setFullYear(result.getFullYear() - years)
  return result
}

export function getChartRangeConfig(range: ChartRange): ChartRangeConfig {
  const now = new Date()
  const label = CHART_RANGES.find((item) => item.range === range)?.label ?? range

  const config: Pick<ChartRangeConfig, 'interval' | 'period1' | 'refetchMs'> = (() => {
    switch (range) {
      case '1D':
        return { interval: '1m', period1: subtractDays(now, 1), refetchMs: 30_000 }
      case '5D':
        return { interval: '5m', period1: subtractDays(now, 5), refetchMs: 60_000 }
      case '1M':
        return { interval: '1d', period1: subtractMonths(now, 1), refetchMs: 120_000 }
      case '6M':
        return { interval: '1d', period1: subtractMonths(now, 6), refetchMs: 300_000 }
      case 'YTD':
        return { interval: '1d', period1: new Date(now.getFullYear(), 0, 1), refetchMs: 300_000 }
      case '1Y':
        return { interval: '1d', period1: subtractYears(now, 1), refetchMs: 300_000 }
      case '5Y':
        return { interval: '1wk', period1: subtractYears(now, 5), refetchMs: 900_000 }
      case 'ALL':
        return { interval: '1mo', period1: new Date(1990, 0, 1), refetchMs: 3_600_000 }
    }
  })()

  return {
    range,
    label,
    ...config,
    description: `${label} · ${config.interval}`,
  }
}

export function getFallbackChartRanges(range: ChartRange): ChartRange[] {
  const fallbacks: ChartRange[] = ['1D', '5D', '1M'].includes(range)
    ? [range, '5D', '1M', '6M', '1Y', '5Y']
    : [range, '1Y', '5Y', 'ALL']

  return Array.from(new Set(fallbacks))
}
