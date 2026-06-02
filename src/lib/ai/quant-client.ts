export interface QuantToolResponse<T = unknown> {
  success: boolean
  data: T | null
  error?: string
  status?: 'ok' | 'configuration_error' | 'timeout' | 'request_failed'
}

export type QuantWorkflowResponse = {
  workflow_result?: Record<string, unknown>
}

export type ProviderFallbackResponse = {
  symbol: string
  selected_provider: string | null
  selected_dataset: Record<string, unknown>[]
  selected_quality: Record<string, unknown> | null
  providers_attempted: string[]
  provider_statuses: Record<string, unknown>[]
  fallback_used: boolean
  usable_for_chart: boolean
  usable_for_ta: boolean
  usable_for_ml: boolean
  usable_for_backtest: boolean
  final_status: 'OK' | 'WARNING' | 'FAILED'
  reason: string
  errors: Record<string, unknown>[]
}

type QuantClientOptions = {
  serverUrl?: string
  secret?: string
  authDisabled?: boolean
}

export class QuantClient {
  private serverUrl: string | null
  private secret: string | null
  private authDisabled: boolean
  private configurationError: string | null

  constructor(options: QuantClientOptions = {}) {
    const envUrl = process.env.QUANT_ENGINE_URL?.trim()
    const isProduction = process.env.NODE_ENV === 'production'
    const authDisabled = options.authDisabled ?? process.env.QUANT_ENGINE_AUTH_DISABLED === 'true'

    this.serverUrl = options.serverUrl || envUrl || (isProduction ? null : 'http://127.0.0.1:8000')
    this.secret = options.secret || process.env.QUANT_ENGINE_SECRET || null
    this.authDisabled = authDisabled && !isProduction
    this.configurationError = null

    if (!this.serverUrl) {
      this.configurationError = 'QUANT_ENGINE_URL is required in production.'
    } else if (!this.secret && !this.authDisabled) {
      this.configurationError = 'QUANT_ENGINE_SECRET is required.'
    } else if (isProduction && authDisabled) {
      this.configurationError = 'QUANT_ENGINE_AUTH_DISABLED cannot be true in production.'
    }
  }

  async callEndpoint<T = unknown>(endpointPath: string, parameters: Record<string, unknown>, timeoutMs = 8000): Promise<QuantToolResponse<T>> {
    if (this.configurationError || !this.serverUrl) {
      console.error('[QuantClient] Configuration error:', this.configurationError)
      return { success: false, data: null, status: 'configuration_error', error: this.configurationError || 'Quant engine is not configured.' }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (this.secret) {
      headers['X-TradeMind-Quant-Secret'] = this.secret
    }

    try {
      const response = await fetch(`${this.serverUrl}${endpointPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(parameters),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        const detail = typeof body?.detail === 'string'
          ? body.detail
          : typeof body?.error === 'string'
            ? body.error
            : null
        return {
          success: false,
          data: null,
          status: 'request_failed',
          error: detail || `Quant endpoint ${endpointPath} failed with status ${response.status}`,
        }
      }

      const data = await response.json() as T
      return { success: true, data, status: 'ok' }
    } catch (error: unknown) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`[QuantClient] Timeout calling ${endpointPath}`)
        return { success: false, data: null, status: 'timeout', error: 'Connection to quant-engine timed out' }
      }
      console.error(`[QuantClient] Error calling ${endpointPath}:`, error)
      return { success: false, data: null, status: 'request_failed', error: 'Quant engine request failed' }
    }
  }

  async callTool(toolName: string, parameters: Record<string, unknown>) {
    return this.callEndpoint(`/mcp/tools/${toolName}`, parameters)
  }

  async getMarketRegime(symbol: string) {
    return this.callTool('get_market_regime', { symbol })
  }

  async calculateVaR(symbol: string, timeframe: string) {
    return this.callTool('calculate_var', { symbol, timeframe })
  }

  async checkGrahamFilters(symbol: string) {
    return this.callTool('check_graham_filters', { symbol })
  }

  async checkMarketDataQuality(parameters: {
    symbol: string
    provider?: string
    timeframe?: string
    start_date?: string
    end_date?: string
    dataset?: Record<string, unknown>[]
    metadata?: Record<string, unknown>
  }) {
    return this.callTool('market_data_quality', {
      provider: 'yahoo-chart',
      timeframe: '1d',
      dataset: [],
      metadata: {},
      ...parameters,
    })
  }

  async normalizeHistoricalData(parameters: {
    symbol: string
    provider: string
    market?: string
    timeframe?: string
    raw_dataset?: Record<string, unknown>[]
    metadata?: Record<string, unknown>
  }) {
    return this.callTool('historical_data_normalizer', {
      market: 'US',
      timeframe: '1d',
      raw_dataset: [],
      metadata: {},
      ...parameters,
    })
  }

  async evaluateSignalQuality(parameters: Record<string, unknown>) {
    return this.callTool('signal_quality', parameters)
  }

  async runRobustBacktest(parameters: Record<string, unknown>) {
    return this.callTool('robust_backtest', parameters)
  }

  async evaluatePortfolioRisk(parameters: Record<string, unknown>) {
    return this.callTool('portfolio_risk_manager', parameters)
  }

  async evaluateTradeExecutionGuard(parameters: Record<string, unknown>) {
    return this.callTool('trade_execution_guard', parameters)
  }

  async resolveProviderFallback(parameters: {
    symbol: string
    market?: string
    timeframe?: string
    range?: string
    start_date?: string
    end_date?: string
    required_use?: 'chart' | 'ta' | 'ml' | 'backtest'
  }) {
    return this.callTool('provider_fallback', {
      market: 'US',
      timeframe: '1d',
      range: '2y',
      required_use: 'ml',
      ...parameters,
    }) as Promise<QuantToolResponse<ProviderFallbackResponse>>
  }

  async runWorkflow(symbol: string) {
    return this.callEndpoint<QuantWorkflowResponse>('/workflow/analyze', { symbol }, 15000)
  }

  async triggerSentimentScan(symbols: string[]) {
    return this.callEndpoint<{
      status: string
      requested?: number
      processed: number
      truncated?: boolean
      limit?: number
    }>('/ml/trigger_sentiment_scan', { symbols }, 120000) // 2 min timeout
  }

  async getSentimentCache(timeoutMs = 5000) {
    if (this.configurationError || !this.serverUrl) {
      return { success: false, data: null, error: this.configurationError }
    }
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.secret) headers['X-TradeMind-Quant-Secret'] = this.secret
    try {
      const res = await fetch(`${this.serverUrl}/ml/sentiment_cache`, { headers, signal: controller.signal })
      clearTimeout(timeoutId)
      if (!res.ok) return { success: false, data: null }
      const data = await res.json()
      return { success: true, data }
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('[QuantClient] Timeout calling /ml/sentiment_cache')
      }
      return { success: false, data: null }
    }
  }
}

export const quantClient = new QuantClient()
