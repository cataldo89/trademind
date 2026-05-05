// alerts check API route — checks active alerts against current prices
// Can be called via cron job or on-demand

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // Get all active alerts
  const { data: alerts, error } = await supabase
    .from('alerts')
    .select('*')
    .eq('status', 'active')

  if (error || !alerts) {
    return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 })
  }

  const triggered: string[] = []

  for (const alert of alerts) {
    try {
      // Fetch current price
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/market/quote?symbol=${alert.symbol}&market=${alert.market}`,
        { next: { revalidate: 0 } }
      )
      if (!res.ok) continue

      const data = await res.json()
      const quote = data.data
      if (!quote) continue

      let shouldTrigger = false
      let currentValue = 0

      switch (alert.condition) {
        case 'price_above':
          currentValue = quote.price
          shouldTrigger = quote.price > alert.value
          break
        case 'price_below':
          currentValue = quote.price
          shouldTrigger = quote.price < alert.value
          break
        case 'change_percent_above':
          currentValue = quote.changePercent
          shouldTrigger = quote.changePercent > alert.value
          break
        case 'change_percent_below':
          currentValue = quote.changePercent
          shouldTrigger = quote.changePercent < alert.value
          break
        case 'volume_above':
          currentValue = quote.volume
          shouldTrigger = quote.volume > alert.value
          break
        default:
          continue
      }

      if (shouldTrigger) {
        await supabase
          .from('alerts')
          .update({
            status: 'triggered',
            triggered_at: new Date().toISOString(),
            current_value: currentValue,
          })
          .eq('id', alert.id)

        triggered.push(alert.id)
      } else {
        // Update current_value for reference
        await supabase
          .from('alerts')
          .update({ current_value: currentValue })
          .eq('id', alert.id)
      }
    } catch (err) {
      console.error('[Alert Check] Error for alert', alert.id, err)
    }
  }

  return NextResponse.json({
    checked: alerts.length,
    triggered: triggered.length,
    triggeredIds: triggered,
  })
}

# bumped: 2026-05-05T04:21:00