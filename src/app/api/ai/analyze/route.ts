import { NextRequest, NextResponse } from 'next/server'
import { yahooFinance } from '@/lib/yahoo-finance'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { quantClient } from '@/lib/ai/quant-client'
import { getYahooSymbol, getZestySymbolMarket } from '@/lib/market-data'
import type { Market } from '@/types'
import type { AdvisorScreenerContext } from '@/lib/ai-advisor-context'

interface AnalyzeRequestBody {
  symbol?: unknown
  market?: unknown
  range?: unknown
  technicalSignal?: unknown
  screenerContext?: unknown
}

interface YahooQuote {
  regularMarketPrice?: number
  regularMarketChangePercent?: number
  regularMarketDayLow?: number
  regularMarketDayHigh?: number
  shortName?: string
  longName?: string
}

interface YahooNewsItem {
  title?: string
}

interface YahooSearchResult {
  news?: YahooNewsItem[]
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

type UnknownRecord = Record<string, unknown>
type QuantPromptData = {
  action?: string
  confidence?: number
  market_regime?: string
}
type SentimentPromptData = {
  sentiment?: string
  score?: number
}

const OPENAI_TIMEOUT_MS = 20_000

function formatCurrency(value?: number) {
  return typeof value === 'number' ? `$${value.toFixed(2)}` : 'No disponible'
}

function formatPercent(value?: number) {
  return typeof value === 'number' ? `${value.toFixed(2)}%` : 'No disponible'
}

function buildNewsHeadlines(searchRes: YahooSearchResult) {
  const news = searchRes.news?.filter((item) => item.title).slice(0, 10) ?? []

  return news.length > 0
    ? news.map((item) => `- ${item.title}`).join('\n')
    : 'Sin noticias recientes.'
}

function isTechnicalSignal(value: unknown): value is { type: 'BUY' | 'SELL' | 'HOLD'; strength?: number; reasons?: string[] } {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { type?: unknown }
  return candidate.type === 'BUY' || candidate.type === 'SELL' || candidate.type === 'HOLD'
}

function finiteNumber(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) ? number : undefined
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeMarket(value: unknown, fallback: Market): Market {
  return value === 'CL' || value === 'US' ? value : fallback
}

function sanitizeScreenerContext(value: unknown, symbol: string, market: Market): AdvisorScreenerContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.source !== 'screener') return undefined

  const contextSymbol = optionalString(candidate.symbol)?.toUpperCase() || symbol
  if (contextSymbol !== symbol) return undefined

  return {
    source: 'screener',
    symbol,
    market: normalizeMarket(candidate.market, market),
    displayAction: optionalString(candidate.displayAction),
    finalScore: finiteNumber(candidate.finalScore),
    decisionScore: finiteNumber(candidate.decisionScore),
    sentiment: optionalString(candidate.sentiment),
    sentimentScore: finiteNumber(candidate.sentimentScore),
    regime: optionalString(candidate.regime),
    quantAction: optionalString(candidate.quantAction),
    confidence: finiteNumber(candidate.confidence),
    macd: optionalString(candidate.macd),
    rsi: finiteNumber(candidate.rsi),
    changePercent: finiteNumber(candidate.changePercent),
  }
}

function lookupSentiment(cache: Record<string, unknown>, symbol: string, yahooSymbol: string): SentimentPromptData | null {
  const keys = [
    symbol,
    symbol.toUpperCase(),
    yahooSymbol,
    yahooSymbol.toUpperCase(),
    yahooSymbol.replace(/\.SN$/i, ''),
    yahooSymbol.replace(/-/g, '.'),
  ]

  for (const key of keys) {
    const value = cache[key]
    if (value) return value as SentimentPromptData
  }

  return null
}

function buildPrompt(
  symbol: string,
  market: string | undefined,
  quote: YahooQuote,
  newsHeadlines: string,
  quantData?: QuantPromptData | null,
  sentimentData?: SentimentPromptData | null,
  technicalSignal?: { type: 'BUY' | 'SELL' | 'HOLD'; strength?: number; reasons?: string[] },
  range?: string,
  screenerContext?: AdvisorScreenerContext
) {
  let prompt = `Actúa como un analista financiero senior experto en mercados bursátiles.
Analiza el siguiente activo y entrega una sugerencia de inversión clara en español: COMPRAR CON CAUTELA, EVITAR / VENDER o MANTENER.
Usa datos de mercado, titulares recientes y contexto técnico simple. Sé conciso, profesional y evita encabezados grandes.

Símbolo: ${symbol}
Mercado: ${market || 'No especificado'}
Nombre: ${quote.longName || quote.shortName || 'No disponible'}
Precio actual: ${formatCurrency(quote.regularMarketPrice)}
Cambio del día: ${formatPercent(quote.regularMarketChangePercent)}
Rango del día: ${formatCurrency(quote.regularMarketDayLow)} - ${formatCurrency(quote.regularMarketDayHigh)}

Últimas noticias:
${newsHeadlines}`

  if (screenerContext) {
    prompt += `\n\nContexto recibido desde Screener TradeMind:
    - Accion visible en screener: ${screenerContext.displayAction || 'No disponible'}
    - Score tecnico: ${typeof screenerContext.finalScore === 'number' ? `${screenerContext.finalScore}/100` : 'No disponible'}
    - Score de decision ajustado por riesgo: ${typeof screenerContext.decisionScore === 'number' ? screenerContext.decisionScore : 'No disponible'}
    - Cambio diario visto por screener: ${typeof screenerContext.changePercent === 'number' ? `${screenerContext.changePercent.toFixed(2)}%` : 'No disponible'}
    - RSI visto por screener: ${typeof screenerContext.rsi === 'number' ? screenerContext.rsi.toFixed(1) : 'No disponible'}
    - MACD visto por screener: ${screenerContext.macd || 'No disponible'}
    - FinBERT visto por screener: ${screenerContext.sentiment || 'No disponible'}${typeof screenerContext.sentimentScore === 'number' ? ` (score ${screenerContext.sentimentScore})` : ''}
    - Quant local en screener: ${screenerContext.quantAction || 'No disponible'}${typeof screenerContext.confidence === 'number' ? ` con confianza ${screenerContext.confidence}%` : ''}
    - Regimen HMM en screener: ${screenerContext.regime || 'No disponible'}`
  }

  if (quantData) {
    prompt += `\n\nIMPORTANTE - Nuestro motor Quant Local analizó esto:
    - Acción sugerida por ML: ${quantData.action || 'HOLD'}
    - Confianza del modelo: ${quantData.confidence || 0}%
    - Régimen de Mercado (HMM): ${quantData.market_regime || 'Desconocido'}`
  }

  if (technicalSignal) {
    const reasons = Array.isArray(technicalSignal.reasons) && technicalSignal.reasons.length
      ? technicalSignal.reasons.slice(0, 4).map((reason) => `      - ${reason}`).join('\n')
      : '      - Sin razones técnicas disponibles'

    prompt += `\n\nSeñal técnica de TradeMind en la pantalla de análisis:
    - Señal operativa: ${technicalSignal.type}
    - Fuerza: ${technicalSignal.strength ?? 50}%
    - Ventana seleccionada: ${range || 'No especificada'}
    - Razones:
${reasons}`
  }

  if (sentimentData) {
    prompt += `\n\n- Análisis de Sentimiento Local (FinBERT): El sentimiento general de las noticias en la base de datos es ${sentimentData.sentiment} (Score: ${sentimentData.score}).`
  }

  prompt += `\n\nUsa estos datos cuantitativos, técnicos y de sentimiento para justificar tu respuesta. Si el ML dice HOLD con confianza baja o neutral, no lo trates como veto automático contra una señal técnica BUY; en ese caso prefiere COMPRAR CON CAUTELA si no hay riesgos claros. Empieza la respuesta con la recomendación principal en negrita.`
  prompt += `\n\nSi el contexto del Screener muestra BUY o BUY (Tech), FinBERT positivo y momentum alcista, no respondas MANTENER salvo que exista una contradiccion explicita en precio, noticias o tecnica.`
  prompt += `\n\nFormato obligatorio: responde en maximo 120 palabras, con una recomendacion en negrita y 3 bullets cortos. Tono sereno, practico y proporcional: no uses lenguaje alarmista como "prudencia extrema", "alto riesgo" o "socavar rapidamente" salvo que haya una senal SELL clara. Si el regimen HMM es Bear o Unknown, mencionarlo como condicion a vigilar, no como veto automatico. Cierra con una accion concreta: entrada gradual, mantener observacion o esperar confirmacion.`
  return prompt
}



async function generateOpenAISuggestion(prompt: string, model: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS)

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'Eres un asesor financiero equilibrado y sereno. Das confianza mediante claridad, escenarios y acciones concretas. No prometes resultados, pero evitas lenguaje alarmista si los datos no lo justifican.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 220,
      }),
    })

    if (!response.ok) {
      console.error('[API/AI/Analyze] OpenAI error:', await response.text())
      return null
    }

    const data = (await response.json()) as OpenAIChatCompletionResponse
    return data.choices?.[0]?.message?.content?.trim() || null
  } catch (error: unknown) {
    console.error('[API/AI/Analyze] OpenAI fallback:', error)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function generateGeminiSuggestion(prompt: string, model: string) {
  try {
    if (!process.env.GEMINI_API_KEY) return null;
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const geminiModel = genAI.getGenerativeModel({
      model,
      systemInstruction: 'Eres un asesor financiero equilibrado y sereno. Das confianza mediante claridad, escenarios y acciones concretas. No prometes resultados, pero evitas lenguaje alarmista si los datos no lo justifican.',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 260,
      }
    });

    const result = await geminiModel.generateContent(prompt);
    return result.response.text();
  } catch (error: unknown) {
    console.error('[API/AI/Analyze] Gemini fallback:', error);
    return null;
  }
}

function scoreNews(newsHeadlines: string) {
  const text = newsHeadlines.toLowerCase()
  const positiveWords = ['beat', 'sube', 'subida', 'crece', 'crecimiento', 'upgrade', 'acuerdo', 'ganancias', 'profit', 'rally']
  const negativeWords = ['cae', 'caída', 'recorte', 'demanda', 'investigación', 'pérdida', 'fraude', 'downgrade', 'lawsuit', 'miss']

  const positiveScore = positiveWords.filter((word) => text.includes(word)).length
  const negativeScore = negativeWords.filter((word) => text.includes(word)).length

  return positiveScore - negativeScore
}

function buildDeterministicSuggestion(
  symbol: string,
  market: string | undefined,
  quote: YahooQuote,
  newsHeadlines: string,
  technicalSignal?: { type: 'BUY' | 'SELL' | 'HOLD'; strength?: number; reasons?: string[] }
) {
  const change = quote.regularMarketChangePercent ?? 0
  const newsScore = scoreNews(newsHeadlines)
  const recommendation = technicalSignal?.type === 'BUY' && change >= 0 && newsScore >= -1
    ? 'COMPRAR CON CAUTELA'
    : technicalSignal?.type === 'SELL'
      ? 'EVITAR / VENDER'
      : change <= -3 || newsScore <= -2
        ? 'EVITAR / VENDER'
        : change >= 1 && newsScore >= 0
          ? 'COMPRAR CON CAUTELA'
          : 'MANTENER'

  const context = recommendation === 'COMPRAR CON CAUTELA'
    ? 'El impulso diario es positivo, aunque conviene controlar tamaño de posición y confirmar continuidad antes de aumentar exposición.'
    : recommendation === 'EVITAR / VENDER'
      ? 'El contexto muestra presión negativa suficiente para priorizar preservación de capital hasta ver estabilización.'
      : 'El balance entre precio, variación diaria y titulares no ofrece una ventaja clara para tomar riesgo adicional ahora.'

  return `**${recommendation}**

${symbol}${market ? ` (${market})` : ''} cotiza en ${formatCurrency(quote.regularMarketPrice)} con un cambio diario de ${formatPercent(quote.regularMarketChangePercent)}. El rango intradía informado es ${formatCurrency(quote.regularMarketDayLow)} - ${formatCurrency(quote.regularMarketDayHigh)}.

${context}

Titulares recientes considerados:
${newsHeadlines}`
}

function hasBullishScreenerContext(
  context: AdvisorScreenerContext | undefined,
  technicalSignal?: { type: 'BUY' | 'SELL' | 'HOLD'; strength?: number; reasons?: string[] }
) {
  if (!context) return false
  const action = `${context.displayAction || ''} ${context.quantAction || ''}`.toUpperCase()
  const sentiment = (context.sentiment || '').toUpperCase()
  const macd = (context.macd || '').toLowerCase()

  return action.includes('BUY') &&
    (technicalSignal?.type === 'BUY' || macd.includes('alcista') || macd.includes('positivo')) &&
    sentiment !== 'NEGATIVE' &&
    (context.finalScore ?? 0) >= 70 &&
    (context.decisionScore ?? 0) >= 75 &&
    (context.changePercent ?? 0) >= 0
}

function startsWithHoldRecommendation(text: string) {
  return text.trim().replace(/^\*\*/, '').toUpperCase().startsWith('MANTENER')
}

function isIncompleteSuggestion(text: string) {
  const normalized = text.replace(/\*\*/g, '').trim()
  const words = normalized.split(/\s+/).filter(Boolean)
  const bulletCount = (text.match(/\n\s*-/g) || []).length
  return words.length < 24 || bulletCount < 2
}

function buildAlignedScreenerSuggestion(
  symbol: string,
  market: string,
  quote: YahooQuote,
  context: AdvisorScreenerContext
) {
  const action = context.displayAction || 'BUY'
  const decision = typeof context.decisionScore === 'number' ? context.decisionScore.toFixed(0) : 'N/A'
  const rsi = typeof context.rsi === 'number' ? context.rsi.toFixed(1) : 'N/A'
  const sentiment = context.sentiment ? context.sentiment.toLowerCase() : 'sin dato fresco'

  return `**COMPRAR CON CAUTELA**

- ${symbol} (${market}) sube ${formatPercent(quote.regularMarketChangePercent)} y el screener lo marco ${action} con decision ${decision}.
- La lectura integrada mantiene momentum: MACD ${context.macd || 'sin dato'}, RSI ${rsi} y FinBERT ${sentiment}.
- Entrada gradual; confirmar continuidad intradia y evitar aumentar si pierde soporte/VWAP.`
}

function alignSuggestionWithScreener(
  suggestion: string,
  symbol: string,
  market: Market,
  quote: YahooQuote,
  context: AdvisorScreenerContext | undefined,
  technicalSignal?: { type: 'BUY' | 'SELL' | 'HOLD'; strength?: number; reasons?: string[] }
) {
  if (!context) return suggestion
  if (!hasBullishScreenerContext(context, technicalSignal)) return suggestion
  if (!startsWithHoldRecommendation(suggestion) && !isIncompleteSuggestion(suggestion)) return suggestion
  return buildAlignedScreenerSuggestion(symbol, market, quote, context)
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AnalyzeRequestBody
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
    const market: Market = body.market === 'CL' || body.market === 'US' ? body.market : getZestySymbolMarket(symbol)
    const range = typeof body.range === 'string' ? body.range : undefined
    const technicalSignal = isTechnicalSignal(body.technicalSignal) ? body.technicalSignal : undefined
    const screenerContext = sanitizeScreenerContext(body.screenerContext, symbol, market)

    if (!symbol) {
      return NextResponse.json({ error: 'Symbol is required' }, { status: 400 })
    }

    const yahooSymbol = getYahooSymbol(symbol, market)
    let quote: YahooQuote | null = null
    try {
      quote = (await yahooFinance.quote(yahooSymbol, {}, { validateResult: false })) as YahooQuote | null
    } catch (error) {
      console.error(`[Yahoo Finance] Error fetching quote for ${yahooSymbol} in AI analyze route:`, error)
    }

    if (!quote) {
      return NextResponse.json({ error: 'Data not found for symbol' }, { status: 404 })
    }

    const searchRes = (await yahooFinance.search(yahooSymbol)) as YahooSearchResult
    const newsHeadlines = buildNewsHeadlines(searchRes)

    // Fetch Quant & Sentiment data from local engine
    const quantRes = await quantClient.runWorkflow(yahooSymbol)
    const quantData = quantRes.success ? quantRes.data?.workflow_result as QuantPromptData | undefined : null

    const sentRes = await quantClient.getSentimentCache()
    const sentimentData = sentRes.success && sentRes.data
      ? lookupSentiment(sentRes.data as UnknownRecord, symbol, yahooSymbol)
      : null

    const prompt = buildPrompt(symbol, market, quote, newsHeadlines, quantData, sentimentData, technicalSignal, range, screenerContext)
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

    if (process.env.GEMINI_API_KEY) {
      const geminiModelStr = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
      const suggestion = await generateGeminiSuggestion(prompt, geminiModelStr)

      if (suggestion) {
        const alignedSuggestion = alignSuggestionWithScreener(suggestion, symbol, market, quote, screenerContext, technicalSignal)
        return NextResponse.json({
          data: {
            suggestion: alignedSuggestion,
            provider: alignedSuggestion === suggestion ? 'Google Gemini' : 'Google Gemini + TradeMind guardrail',
            model: geminiModelStr,
            promptContext: prompt, // <-- Devuelve el prompt exacto
          },
        })
      }
    } else if (process.env.OPENAI_API_KEY) {
      const suggestion = await generateOpenAISuggestion(prompt, model)

      if (suggestion) {
        const alignedSuggestion = alignSuggestionWithScreener(suggestion, symbol, market, quote, screenerContext, technicalSignal)
        return NextResponse.json({
          data: {
            suggestion: alignedSuggestion,
            provider: alignedSuggestion === suggestion ? 'OpenAI' : 'OpenAI + TradeMind guardrail',
            model,
            promptContext: prompt, // <-- Devuelve el prompt exacto
          },
        })
      }
    }

    const suggestion = buildDeterministicSuggestion(symbol, market, quote, newsHeadlines, technicalSignal)
    const alignedSuggestion = alignSuggestionWithScreener(suggestion, symbol, market, quote, screenerContext, technicalSignal)

    return NextResponse.json({
      data: {
        suggestion: alignedSuggestion,
        provider: alignedSuggestion === suggestion ? 'TradeMind Cloud' : 'TradeMind Cloud + guardrail',
        model: 'rules-yahoo-v1',
      },
    })
  } catch (error: unknown) {
    console.error('[API/AI/Analyze] Error:', error)
    return NextResponse.json(
      { error: 'No se pudo generar el análisis con datos de mercado', details: String(error) },
      { status: 500 }
    )
  }
}

