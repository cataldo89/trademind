import { NextRequest, NextResponse } from 'next/server'
import { ZESTY_SYMBOLS } from '@/lib/market-data'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const expectedSecret = process.env.QUANT_ENGINE_SECRET || 'local-dev-secret'

    if (authHeader !== `Bearer ${expectedSecret}` && process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const batchSize = Number(body.batchSize) || 20
    const delayMs = Number(body.delayMs) || 5000

    const symbols = ZESTY_SYMBOLS.map((s) => s.symbol)
    const total = symbols.length

    // Respond immediately, continue in background
    // (In Vercel edge/serverless, background execution after response is limited unless configured,
    // but Next.js 14 `waitUntil` or simply firing fetch requests can work if timeout is enough.
    // For a robust system, this could just trigger chunks)
    
    console.log(`[Pre-warm] Starting background pre-warm for ${total} symbols...`)

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const triggerBackground = async () => {
      for (let i = 0; i < total; i += batchSize) {
        const chunk = symbols.slice(i, i + batchSize)
        console.log(`[Pre-warm] Processing batch ${i / batchSize + 1}: ${chunk.length} symbols`)
        
        try {
          // We call the scan endpoint internally to leverage the exact same logic
          // and let it write to quant_results_cache
          await fetch(`${baseUrl}/api/quant/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              symbols: chunk,
              category: 'prewarm',
              market: 'US'
            }),
          })
          
          if (i + batchSize < total) {
            await new Promise(resolve => setTimeout(resolve, delayMs))
          }
        } catch (e) {
          console.error(`[Pre-warm] Batch error:`, e)
        }
      }
      console.log(`[Pre-warm] Finished background pre-warm.`)
    }

    // Fire and forget (may get killed by Vercel timeout if not careful, 
    // but perfect for local development or long-running containers)
    triggerBackground()

    return NextResponse.json({ 
      success: true, 
      message: `Pre-warm started for ${total} symbols. Batch size: ${batchSize}. Delay: ${delayMs}ms.`,
      status: 'processing_in_background'
    })

  } catch (error) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
