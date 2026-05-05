// src/lib/ai/mcp-client.ts

/**
 * Cliente MCP (Model Context Protocol)
 * Este cliente se conectará al microservicio Python (quant-engine) que expone herramientas
 * vía el protocolo MCP para que el backend las utilice.
 */

export interface MCPToolResponse {
  success: boolean;
  data: unknown;
  error?: string;
}

export class MCPClient {
  private serverUrl: string;

  constructor(serverUrl: string = process.env.QUANT_ENGINE_URL || 'http://127.0.0.1:8000') {
    this.serverUrl = serverUrl;
  }

  /**
   * Ejecuta un endpoint genérico en el quant-engine
   */
  async callEndpoint(endpointPath: string, parameters: Record<string, unknown>, timeoutMs = 8000): Promise<MCPToolResponse> {
    const secret = process.env.QUANT_ENGINE_SECRET;
    const authDisabled = process.env.QUANT_ENGINE_AUTH_DISABLED === 'true';
    
    if (!secret && !authDisabled) {
       console.error("[MCPClient] Fatal: QUANT_ENGINE_SECRET is not set.");
       return { success: false, data: null, error: "System configuration error: Quant Engine Auth Secret missing." };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.serverUrl}${endpointPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TradeMind-Quant-Secret': secret || ''
        },
        body: JSON.stringify(parameters),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`MCP Endpoint ${endpointPath} failed with status ${response.status}`);
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`[MCPClient] Timeout calling ${endpointPath}`);
        return { success: false, data: null, error: 'Connection to quant-engine timed out' };
      }
      console.error(`[MCPClient] Error calling ${endpointPath}:`, error);
      return { success: false, data: null, error: String(error) };
    }
  }

  /**
   * Ejecuta una herramienta remota expuesta por el servidor MCP
   */
  async callTool(toolName: string, parameters: Record<string, unknown>): Promise<MCPToolResponse> {
    return this.callEndpoint(`/mcp/tools/${toolName}`, parameters);
  }

  // Wrappers para herramientas específicas

  async getMarketRegime(symbol: string) {
    return this.callTool('get_market_regime', { symbol });
  }

  async calculateVaR(symbol: string, timeframe: string) {
    return this.callTool('calculate_var', { symbol, timeframe });
  }

  async checkGrahamFilters(symbol: string) {
    return this.callTool('check_graham_filters', { symbol });
  }

  async runWorkflow(symbol: string) {
    return this.callEndpoint('/workflow/analyze', { symbol }, 15000); // 15s timeout
  }
}

export const mcpClient = new MCPClient();


# bumped: 2026-05-05T04:21:00