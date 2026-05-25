import { NextRequest, NextResponse } from 'next/server'
import { quantClient } from '@/lib/ai/quant-client'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const symbols = body.symbols || []
    
    if (!symbols.length) {
      return NextResponse.json({ error: 'No symbols provided' }, { status: 400 })
    }

    const res = await quantClient.triggerSentimentScan(symbols)
    
    if (!res.success) {
      return NextResponse.json({ error: res.error || 'Quant engine error' }, { status: 500 })
    }

    return NextResponse.json({ success: true, processed: res.data?.processed })
  } catch (error: any) {
    console.error('[API/Quant/Sentiment] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
