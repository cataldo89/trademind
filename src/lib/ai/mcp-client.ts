// src/lib/ai/mcp-client.ts

/**
 * Cliente MCP (Model Context Protocol)
 * Este cliente se conectará al microservicio Python (quant-engine) que expone herramientas
 * vía el protocolo MCP para que el Edge Runtime las utilice.
 */

export interface MCPToolResponse {
  success: boolean;
  data: any;
  error?: string;
}

export class MCPClient {
  private serverUrl: string;

  constructor(serverUrl: string = process.env.QUANT_ENGINE_URL || 'http://127.0.0.1:8000') {
    this.serverUrl = serverUrl;
  }

  /**
   * Ejecuta una herramienta remota expuesta por el servidor MCP
   */
  async callTool(toolName: string, parameters: Record<string, any>): Promise<MCPToolResponse> {
    try {
      const response = await fetch(`${this.serverUrl}/mcp/tools/${toolName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 'Authorization': `Bearer ${process.env.QUANT_ENGINE_SECRET}`
        },
        body: JSON.stringify(parameters),
      });

      if (!response.ok) {
        throw new Error(`MCP Tool ${toolName} failed with status ${response.status}`);
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      console.error(`[MCPClient] Error calling tool ${toolName}:`, error);
      return { success: false, data: null, error: String(error) };
    }
  }

  // Wrappers para herramientas específicas (ejemplos)

  async getMarketRegime(symbol: string) {
    return this.callTool('get_market_regime', { symbol });
  }

  async calculateVaR(symbol: string, timeframe: string) {
    return this.callTool('calculate_var', { symbol, timeframe });
  }

  async checkGrahamFilters(symbol: string) {
    return this.callTool('check_graham_filters', { symbol });
  }
}

export const mcpClient = new MCPClient();
