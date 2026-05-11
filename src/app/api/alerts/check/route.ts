// alerts check API route - protected cron job for active alerts.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

type AlertRow = {
  id: string
  symbol: string
  market: string
  condition: string
  value: number
}

type QuoteRow = {
  symbol: string
  price?: number
  changePercent?: number
  volume?: number
}

function isAuthorizedCron(request: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.ALERTS_CRON_SECRET
  if (!secret) return { ok: false, status: 500, error: 'CRON_SECRET is not configured' }

  const bearer = request.headers.get('Authorization')?.replace('Bearer ', '').trim()
  const headerSecret = request.headers.get('x-cron-secret')?.trim()
  const provided = bearer || headerSecret

  if (provided !== secret) return { ok: false, status: 401, error: 'Unauthorized' }
  return { ok: true, status: 200, error: null }
}

function shouldTriggerAlert(alert: AlertRow, quote: QuoteRow) {
  let shouldTrigger = false
  let currentValue = 0

  switch (alert.condition) {
    case 'price_above':
      currentValue = Number(quote.price || 0)
      shouldTrigger = currentValue > Number(alert.value)
      break
    case 'price_below':
      currentValue = Number(quote.price || 0)
      shouldTrigger = currentValue < Number(alert.value)
      break
    case 'change_percent_above':
      currentValue = Number(quote.changePercent || 0)
      shouldTrigger = currentValue > Number(alert.value)
      break
    case 'change_percent_below':
      currentValue = Number(quote.changePercent || 0)
      shouldTrigger = currentValue < Number(alert.value)
      break
    case 'volume_above':
      currentValue = Number(quote.volume || 0)
      shouldTrigger = currentValue > Number(alert.value)
      break
    default:
      return null
  }

  return { shouldTrigger, currentValue }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const auth = isAuthorizedCron(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const supabase = await createAdminClient()
  const { data: alertsData, error } = await supabase
    .from('alerts')
    .select('*')
    .eq('status', 'active')
    .limit(500)

  if (error || !alertsData) {
    console.error('[Alert Check] Failed to fetch alerts', error)
    return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 })
  }

  const alerts = alertsData as AlertRow[]
  const triggered: string[] = []
  let failed = 0

  const alertsByMarket = new Map<string, AlertRow[]>()
  alerts.forEach((alert) => {
    const key = alert.market || 'US'
    const group = alertsByMarket.get(key) || []
    group.push(alert)
    alertsByMarket.set(key, group)
  })

  const quoteBySymbol = new Map<string, QuoteRow>()

  for (const [market, marketAlerts] of alertsByMarket.entries()) {
    const symbols = Array.from(new Set(marketAlerts.map((alert) => alert.symbol).filter(Boolean)))
    if (symbols.length === 0) continue

    try {
      const quoteUrl = new URL('/api/market/quote', request.url)
      quoteUrl.searchParams.set('symbols', symbols.join(','))
      quoteUrl.searchParams.set('market', market)

      const res = await fetch(quoteUrl)
      if (!res.ok) {
        failed += marketAlerts.length
        continue
      }

      const payload = await res.json()
      const quotes = Array.isArray(payload.data) ? payload.data : [payload.data]
      quotes.forEach((quote: QuoteRow) => {
        if (quote?.symbol) quoteBySymbol.set(quote.symbol.toUpperCase(), quote)
      })
    } catch (err) {
      failed += marketAlerts.length
      console.error('[Alert Check] Batch quote error', market, err)
    }
  }

  for (const alert of alerts) {
    try {
      const quote = quoteBySymbol.get(alert.symbol.toUpperCase())
      if (!quote) {
        failed += 1
        continue
      }

      const result = shouldTriggerAlert(alert, quote)
      if (!result) continue

      if (result.shouldTrigger) {
        const { error: updateError } = await supabase
          .from('alerts')
          .update({
            status: 'triggered',
            triggered_at: new Date().toISOString(),
            current_value: result.currentValue,
          })
          .eq('id', alert.id)

        if (updateError) throw updateError
        triggered.push(alert.id)
      } else {
        const { error: updateError } = await supabase
          .from('alerts')
          .update({ current_value: result.currentValue })
          .eq('id', alert.id)

        if (updateError) throw updateError
      }
    } catch (err) {
      failed += 1
      console.error('[Alert Check] Error for alert', alert.id, err)
    }
  }

  const durationMs = Date.now() - startedAt

  return NextResponse.json({
    checked: alerts.length,
    triggered: triggered.length,
    failed,
    durationMs,
    triggeredIds: triggered,
  })
}