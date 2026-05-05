import { NextResponse } from 'next/server';
import { mcpClient } from '@/lib/ai/mcp-client';

// FASE 3: Algoritmo IA Automático de Señales
// Separación estricta de responsabilidades. Aquí contactamos al quant-engine (Python).

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { symbol, currentPrice } = body;

    if (!symbol) {
      return NextResponse.json({ success: false, error: 'Symbol is required' }, { status: 400 });
    }

    // 1. Llamar al workflow del quant-engine
    const response = await mcpClient.runWorkflow(symbol);

    if (!response.success || !response.data) {
      return NextResponse.json(
        { 
          success: false, 
          status: "not_implemented", 
          message: "Trading engine is not connected to quant-engine yet or failed.",
          error: response.error 
        }, 
        { status: 503 }
      );
    }

    const responseData = response.data as Record<string, unknown>;
    const workflowResult = (responseData.workflow_result as Record<string, unknown>) || {};
    const action = workflowResult.action || 'HOLD';
    const confidence = workflowResult.confidence || 50;
    const label = workflowResult.label || 'MANTENER';
    const reasoning = workflowResult.xai_explanation || `Análisis procesado en quant-engine para ${symbol}.`;

    const signal = {
      id: crypto.randomUUID(),
      symbol,
      action,
      label,
      price: currentPrice || null,
      confidence,
      reasoning,
      timestamp: new Date().toISOString()
    };

    // 3. Inserción en BD (Supabase) que detonará el Realtime WebSocket al frontend
    // await supabase.from('ai_signals').insert(signal);

    return NextResponse.json({ success: true, signal });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to process AI signal' }, { status: 500 });
  }
}

