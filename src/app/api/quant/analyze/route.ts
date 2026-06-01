import { NextRequest, NextResponse } from 'next/server'
import { QuantClient } from '@/lib/ai/quant-client'
import { getYahooSymbol, getZestySymbolMarket } from '@/lib/market-data'
import { parseMarketOrLegacy } from '@/lib/domain/market'

function classifyWorkflowResult(workflowResult: Record<string, unknown> | undefined) {
  if (!workflowResult) {
    return {
      usable: false,
      status: 'failed',
      reason: 'Quant engine did not return workflow_result',
    }
  }

  const action = String(workflowResult.action || '').toUpperCase()
  const confidence = Number(workflowResult.confidence ?? 0)
  const regime = String(workflowResult.market_regime || '').toLowerCase()
  const explanation = String(workflowResult.xai_explanation || workflowResult.error_reason || '')
  const dataStatus = String(workflowResult.data_status || '').toLowerCase()
  const marketDataQuality = workflowResult.market_data_quality as { usable_for_ml?: boolean; recommendation?: string } | undefined
  const hasDataFetchError = /error fetching data|fallo al obtener datos|datos insuficientes|incompleto/i.test(explanation)
  const unknownRegime = !regime || regime === 'unknown' || regime.includes('desconocido')

  if (dataStatus === 'insufficient' || marketDataQuality?.usable_for_ml === false) {
    return {
      usable: false,
      status: 'failed',
      reason: marketDataQuality?.recommendation || explanation || 'Market data quality blocked ML analysis',
    }
  }

  if (hasDataFetchError) {
    return { usable: false, status: 'failed', reason: explanation || 'Quant engine reported incomplete data' }
  }

  if (action === 'HOLD' && confidence === 0 && unknownRegime) {
    return { usable: false, status: 'partial', reason: 'Python returned HOLD with 0 confidence and unknown regime' }
  }

  if (unknownRegime || confidence === 0) {
    return { usable: false, status: 'partial', reason: 'Python returned partial quant data' }
  }

  return { usable: true, status: 'ok', reason: 'Python workflow completed with usable quant data' }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { symbol } = body

    if (!symbol) {
      return NextResponse.json({ error: 'Symbol is required' }, { status: 400 })
    }

    const market = parseMarketOrLegacy(body.market, symbol) || getZestySymbolMarket(symbol)
    const quantSymbol = getYahooSymbol(symbol, market)

    console.log(`[API Quant Analyze] Running workflow for symbol: ${symbol} (${quantSymbol})`)
    const client = new QuantClient()
    const result = await client.runWorkflow(quantSymbol)

    if (!result.success) {
      console.error(`[API Quant Analyze] QuantClient returned failure:`, result.error)
      const statusCode =
        result.status === 'configuration_error' ? 503 :
        result.status === 'timeout' ? 504 :
        result.status === 'request_failed' ? 503 :
        500

      return NextResponse.json({ 
        error: result.error || 'Quant workflow failed', 
        status: result.status 
      }, { status: statusCode })
    }

    const data = result.data
    const workflowResult = data?.workflow_result
    const diagnostic = classifyWorkflowResult(workflowResult)

    if (workflowResult && data) {
      data.workflow_result = {
        ...workflowResult,
        engine_status: diagnostic.status,
        data_quality: diagnostic.usable ? 'complete' : diagnostic.status === 'partial' ? 'partial' : 'insufficient',
        engine_reason: diagnostic.reason,
        quant_symbol: quantSymbol,
      }
    }

    return NextResponse.json({ success: true, data, symbol, quantSymbol, diagnostic })
  } catch (error: unknown) {
    console.error('[API Quant Analyze] Exception:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
