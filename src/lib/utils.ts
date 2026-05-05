import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Format currency
export function formatCurrency(
  value: number,
  currency = 'USD',
  locale = 'en-US'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

// Format percentage
export function formatPercent(value: number, decimals = 2): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

// Format large numbers (volume, market cap)
export function formatLargeNumber(value: number): string {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`
  return value.toFixed(2)
}

// Format price with dynamic decimals
export function formatPrice(price: number, currency = 'USD'): string {
  const decimals = price < 1 ? 4 : price < 10 ? 3 : 2
  const symbol = currency === 'CLP' ? '$' : '$'
  return `${symbol}${price.toFixed(decimals)}`
}

// Get color for positive/negative values
export function getPnLColor(value: number): string {
  if (value > 0) return 'text-emerald-400'
  if (value < 0) return 'text-red-400'
  return 'text-gray-400'
}

export function getPnLBg(value: number): string {
  if (value > 0) return 'bg-emerald-400/10 text-emerald-400'
  if (value < 0) return 'bg-red-400/10 text-red-400'
  return 'bg-gray-400/10 text-gray-400'
}

// Calculate percentage change
export function calcChangePercent(current: number, previous: number): number {
  if (previous === 0) return 0
  return ((current - previous) / previous) * 100
}

// Debounce
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

// Sleep utility
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Round to N decimals
export function roundTo(num: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(num * factor) / factor
}

# bumped: 2026-05-05T04:21:00