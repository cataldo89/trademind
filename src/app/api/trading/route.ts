import { NextRequest, NextResponse } from 'next/server'
import { mcpClient } from '@/lib/ai/mcp-client'
import { createClient, createClientForAuthToken } from '@/lib/supabase/server'
import { parseMarketOrLegacy, normalizeSignalType, normalizeStrength, normalizeSymbol } from '@/lib/domain/market'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const symbol = normalizeSymbol(body?.symbol)

    if (!symbol) {
      return NextResponse.json({ success: false, error: 'Valid symbol is required' }, { status: 400 })
    }

    const market = parseMarketOrLegacy(body?.market, symbol)
    if (!market) {
      return NextResponse.json({ success: false, persisted: false, error: 'Invalid market. Use US or CL.' }, { status: 400 })
    }
    const currentPrice = Number(body?.currentPrice)
    const price = Number.isFinite(currentPrice) && currentPrice > 0 ? currentPrice : null

    const userClient = await createClient()
    let dbClient: typeof userClient | ReturnType<typeof createClientForAuthToken> = userClient
    let user: { id: string } | null = null

    const authHeader = req.headers.get('Authorization')
    const token = authHeader?.replace('Bearer ', '').trim()

    if (token) {
      const { data } = await userClient.auth.getUser(token)
      if (data?.user) {
        user = { id: data.user.id }
        dbClient = createClientForAuthToken(token)
      }
    }

    if (!user) {
      const { data } = await userClient.auth.getUser()
      if (data?.user) {
        user = { id: data.user.id }
        dbClient = userClient
      }
    }

    const response = await mcpClient.runWorkflow(symbol)

    if (!response.success || !response.data) {
      return NextResponse.json(
        {
          success: false,
          persisted: false,
          status: 'quant_engine_unavailable',
          message: response.error || 'Quant engine is unavailable or not configured.',
        },
        { status: 503 }
      )
    }

    const responseData = response.data as Record<string, unknown>
    const workflowResult = (responseData.workflow_result as Record<string, unknown>) || {}
    const action = normalizeSignalType(workflowResult.action)
    const confidence = normalizeStrength(workflowResult.confidence)
    const label = String(workflowResult.label || (action === 'BUY' ? 'COMPRAR' : action === 'SELL' ? 'VENDER' : 'MANTENER'))
    const reasoning = String(workflowResult.xai_explanation || `Analisis procesado en quant-engine para ${symbol}.`)

    const signalResponse = {
      symbol,
      market,
      action,
      label,
      confidence,
      price,
      reasoning,
      models: {
        graham: {
          passed: workflowResult.graham_passed,
          reason: workflowResult.graham_reason,
        },
        hmm: {
          regime: workflowResult.market_regime,
        },
        garch: {
          var_95: workflowResult.var_95,
        },
        arima: {
          expected_return: workflowResult.ml_prediction,
        },
        sarima: {},
        quantconnect: {},
      },
    }

    if (!user) {
      return NextResponse.json({ success: true, persisted: false, signal: signalResponse })
    }

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 1)

    const { data: savedSignal, error } = await dbClient
      .from('signals')
      .insert({
        user_id: user.id,
        symbol,
        market,
        type: action,
        strength: confidence,
        reason: reasoning,
        price,
        timeframe: '1D',
        status: 'active',
        expires_at: expiresAt.toISOString(),
      })
      .select('id')
      .single()

    if (error) {
      console.error('[api/trading] Failed to save signal to db', error)
      return NextResponse.json(
        {
          success: false,
          persisted: false,
          status: 'persistence_failed',
          message: 'The signal was generated but could not be saved.',
          signal: signalResponse,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      persisted: true,
      signal: {
        ...signalResponse,
        id: savedSignal?.id,
      },
    })
  } catch (error) {
    console.error('[api/trading fatal]', error)
    return NextResponse.json(
      {
        success: false,
        persisted: false,
        status: 'trading_request_failed',
        message: 'Trading analysis could not be completed.',
      },
      { status: 500 }
    )
  }
}