import { NextRequest, NextResponse } from 'next/server'
import { QuantClient } from '@/lib/ai/quant-client'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { symbol } = body

    if (!symbol) {
      return NextResponse.json({ error: 'Symbol is required' }, { status: 400 })
    }

    console.log(`[API Quant Analyze] Running workflow for symbol: ${symbol}`)
    const client = new QuantClient()
    const result = await client.runWorkflow(symbol)

    if (!result.success) {
      console.error(`[API Quant Analyze] QuantClient returned failure:`, result.error)
      return NextResponse.json({ 
        error: result.error || 'Quant workflow failed', 
        status: result.status 
      }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: result.data })
  } catch (error: any) {
    console.error('[API Quant Analyze] Exception:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
