import { NextRequest, NextResponse } from 'next/server'
import { quantClient } from '@/lib/ai/quant-client'

const MAX_SENTIMENT_SCAN_SYMBOLS = Number(process.env.SENTIMENT_SCAN_MAX_SYMBOLS || 30)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const symbolsInput: unknown[] = Array.isArray(body.symbols) ? body.symbols : []
    const normalizedSymbols = symbolsInput.reduce<string[]>((acc, symbol) => {
      if (typeof symbol !== 'string') return acc
      const normalized = symbol.trim().toUpperCase()
      if (normalized) acc.push(normalized)
      return acc
    }, [])
    const symbols = Array.from(new Set(normalizedSymbols))
    
    if (!symbols.length) {
      return NextResponse.json({ error: 'No symbols provided' }, { status: 400 })
    }

    const limitedSymbols = symbols.slice(0, MAX_SENTIMENT_SCAN_SYMBOLS)
    const res = await quantClient.triggerSentimentScan(limitedSymbols)
    
    if (!res.success) {
      return NextResponse.json({ error: res.error || 'Quant engine error' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      requested: symbols.length,
      processed: res.data?.processed ?? limitedSymbols.length,
      truncated: symbols.length > limitedSymbols.length,
      limit: MAX_SENTIMENT_SCAN_SYMBOLS,
    })
  } catch (error: unknown) {
    console.error('[API/Quant/Sentiment] Error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
