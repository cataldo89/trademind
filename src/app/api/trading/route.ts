import { NextRequest, NextResponse } from 'next/server';
import { mcpClient } from '@/lib/ai/mcp-client';
import { createAdminClient, createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { symbol, currentPrice } = body;

    if (!symbol) {
      return NextResponse.json({ success: false, error: 'Symbol is required' }, { status: 400 });
    }

    // Auth validation
    const userClient = await createClient();
    let user = null;
    
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    if (token) {
      const { data } = await userClient.auth.getUser(token);
      user = data?.user;
    }
    if (!user) {
      const { data } = await userClient.auth.getUser();
      user = data?.user;
    }

    // 1. Llamar al workflow del quant-engine
    const response = await mcpClient.runWorkflow(symbol);

    if (!response.success || !response.data) {
      return NextResponse.json(
        { 
          success: false, 
          status: "quant_engine_unavailable", 
          message: "Quant engine is unavailable or not configured."
        }, 
        { status: 503 }
      );
    }

    const responseData = response.data as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workflowResult = (responseData.workflow_result as Record<string, any>) || {};
    const action = workflowResult.action || 'HOLD';
    const confidence = workflowResult.confidence || 50;
    const label = workflowResult.label || 'MANTENER';
    const reasoning = workflowResult.xai_explanation || `Análisis procesado en quant-engine para ${symbol}.`;

    const signalResponse = {
      symbol,
      action,
      label,
      confidence,
      price: currentPrice || null,
      reasoning,
      models: {
        graham: {
          passed: workflowResult.graham_passed,
          reason: workflowResult.graham_reason
        },
        hmm: {
          regime: workflowResult.market_regime
        },
        garch: {
          var_95: workflowResult.var_95
        },
        arima: {
          expected_return: workflowResult.ml_prediction
        },
        sarima: {},
        quantconnect: {}
      }
    };

    // 3. Inserción en BD (Supabase)
    if (user) {
      try {
        let supabase = userClient;
        if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
          supabase = await createAdminClient();
        }
        
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 1); // 1D timeframe default for trading

        await supabase.from('signals').insert({
          user_id: user.id,
          symbol: symbol.toUpperCase(),
          market: 'EQUITY',
          type: action,
          strength: confidence,
          reason: reasoning,
          price: currentPrice || null,
          timeframe: '1D',
          status: 'active',
          expires_at: expiresAt.toISOString()
        });
      } catch (err) {
        console.error('[api/trading] Failed to save signal to db', err);
      }
    }

    return NextResponse.json({ success: true, signal: signalResponse });
  } catch (error) {
    console.error('[api/trading fatal]', error);
    return NextResponse.json({ 
      success: false, 
      status: "quant_engine_unavailable", 
      message: "Quant engine is unavailable or not configured." 
    }, { status: 503 });
  }
}