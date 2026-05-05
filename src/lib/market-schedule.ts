/**
 * Market Schedule Utilities
 * Handles trading hours for US (NYSE/NASDAQ)
 */

import { Market, MarketStatus } from '@/types'

// US Market: NYSE/NASDAQ
// Regular hours: 09:30–16:00 ET
// Pre-market: 04:00–09:30 ET
// After-hours: 16:00–20:00 ET
const US_MARKET = {
  timezone: 'America/New_York',
  regularOpen: { h: 9, m: 30 },
  regularClose: { h: 16, m: 0 },
  preOpen: { h: 4, m: 0 },
  afterClose: { h: 20, m: 0 },
}

// US Holidays 2025-2026 (simplified set)
const US_HOLIDAYS_2026 = [
  '2026-01-01', // New Year
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-11-27', // Black Friday (early close)
  '2026-12-25', // Christmas
]

function getTimeInZone(timezone: string): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: timezone }))
}

function formatTimeHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatNextOpen(timezone: string, open: { h: number; m: number }): string {
  const now = getTimeInZone(timezone)
  const next = new Date(now)
  next.setHours(open.h, open.m, 0, 0)
  if (now >= next) {
    next.setDate(next.getDate() + 1)
    // Skip weekends
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1)
    }
  }
  return next.toISOString()
}

export function getUSMarketStatus(): MarketStatus {
  const now = getTimeInZone(US_MARKET.timezone)
  const dayOfWeek = now.getDay()
  const dateStr = now.toISOString().split('T')[0]

  // Check weekend
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  // Check holiday
  const isHoliday = US_HOLIDAYS_2026.includes(dateStr)

  if (isWeekend || isHoliday) {
    return {
      market: 'US',
      isOpen: false,
      session: 'closed',
      openTime: '09:30',
      closeTime: '16:00',
      timezone: US_MARKET.timezone,
      nextOpen: formatNextOpen(US_MARKET.timezone, US_MARKET.regularOpen),
    }
  }

  const h = now.getHours()
  const m = now.getMinutes()
  const totalMin = h * 60 + m

  const preOpenMin = US_MARKET.preOpen.h * 60 + US_MARKET.preOpen.m
  const regularOpenMin = US_MARKET.regularOpen.h * 60 + US_MARKET.regularOpen.m
  const regularCloseMin = US_MARKET.regularClose.h * 60 + US_MARKET.regularClose.m
  const afterCloseMin = US_MARKET.afterClose.h * 60 + US_MARKET.afterClose.m

  let session: MarketStatus['session'] = 'closed'
  let isOpen = false

  if (totalMin >= regularOpenMin && totalMin < regularCloseMin) {
    session = 'regular'
    isOpen = true
  } else if (totalMin >= preOpenMin && totalMin < regularOpenMin) {
    session = 'pre'
    isOpen = false
  } else if (totalMin >= regularCloseMin && totalMin < afterCloseMin) {
    session = 'after'
    isOpen = false
  }

  return {
    market: 'US',
    isOpen,
    session,
    openTime: `${US_MARKET.regularOpen.h}:${String(US_MARKET.regularOpen.m).padStart(2, '0')}`,
    closeTime: `${US_MARKET.regularClose.h}:${String(US_MARKET.regularClose.m).padStart(2, '0')}`,
    timezone: US_MARKET.timezone,
  }
}

export function getAllMarketStatus(): Record<Market, MarketStatus> {
  return {
    US: getUSMarketStatus(),
  }
}

export function isMarketOpen(market: Market): boolean {
  if (market === 'US') return getUSMarketStatus().isOpen
  return false
}

export function getMarketCurrentTime(market: Market): string {
  const tz = US_MARKET.timezone
  const now = getTimeInZone(tz)
  return formatTimeHHMM(now)
}
