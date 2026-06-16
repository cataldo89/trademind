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
    decisionSource: optionalString(candidate.decisionSource),
    decisionStatus: optionalString(candidate.decisionStatus),
    decisionReason: optionalString(candidate.decisionReason),
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
    - Regimen HMM en screener: ${screenerContext.regime || 'No disponible'}
    - Origen de decision screener: ${screenerContext.decisionSource || 'No disponible'}${screenerContext.decisionStatus ? ` (${screenerContext.decisionStatus})` : ''}
    - Motivo de decision screener: ${screenerContext.decisionReason || 'No disponible'}`
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

  const isInsufficientCandles = technicalSignal?.reasons?.some((r) =>
    r.toLowerCase().includes('insuficiente') ||
    r.toLowerCase().includes('velas') ||
    r.toLowerCase().includes('historial')
  ) || false

  if (isInsufficientCandles) {
    prompt += `\n\nATENCIÓN - DATOS HISTÓRICOS INSUFICIENTES PARA INDICADORES LOCALES:
    La señal técnica local es HOLD debido a la falta de suficientes velas en el gráfico (mínimo 50 velas).
    En este caso de datos insuficientes, debes IGNORAR el HOLD técnico local y PRIORIZAR el análisis y lógica del motor Quant/ML local (LightGBM) que se muestra en el contexto del Screener (por ejemplo, si el ML/Screener sugiere BUY/COMPRAR, tu sugerencia principal debe ser COMPRAR CON CAUTELA, no MANTENER). Explica de forma clara y directa al usuario que aunque falten velas para indicadores tradicionales, el motor cuantitativo ML proporciona una señal válida basada en su lógica de clasificación (como IPO reciente, cambio positivo inmediato, volumen válido, etc.).`
  }

  prompt += `\n\nUsa estos datos cuantitativos, técnicos y de sentimiento para justificar tu respuesta. Si el ML dice HOLD con confianza baja o neutral, no lo trates como veto automático contra una señal técnica BUY; en ese caso prefiere COMPRAR CON CAUTELA si no hay riesgos claros. Empieza la respuesta con la recomendación principal en negrita.`
  prompt += `\n\nSi el contexto del Screener muestra BUY o BUY (Tech), FinBERT positivo y momentum alcista, no respondas MANTENER salvo que exista una contradiccion explicita en precio, noticias o tecnica.`
  if (screenerContext?.displayAction?.toUpperCase().includes('HOLD') && (screenerContext.decisionScore ?? 100) < 50) {
    prompt += `\n\nIMPORTANTE: el screener llego a HOLD con decision baja. No conviertas esto en COMPRAR CON CAUTELA salvo que expliques una contradiccion nueva y fuerte contra el motivo del screener. Prioriza MANTENER si el motivo fue datos parciales, baja confianza, bloqueo, conflicto o riesgo.`
  }
  prompt += `\n\nFormato obligatorio: responde entre 120 y 220 palabras, con una recomendacion en negrita y exactamente 3 bullets utiles. Explica la razon principal del screener si existe. Tono sereno, practico y proporcional: no uses lenguaje alarmista como "prudencia extrema", "alto riesgo" o "socavar rapidamente" salvo que haya una senal SELL clara. Si el regimen HMM es Bear o Unknown, mencionarlo como condicion a vigilar, no como veto automatico. Cierra con una accion concreta: entrada gradual, mantener observacion o esperar confirmacion.`
  prompt += `\n\nREGLA CRÍTICA DE LEGIBILIDAD: No utilices tecnicismos complejos o siglas de indicadores de forma directa (como MACD, RSI, FinBERT, HMM, o términos como 'decisión 35') en tus viñetas. Explica la información de forma simple y amigable en español cotidiano para que cualquier inversor retail pueda entenderla de un vistazo (por ejemplo: en lugar de 'RSI 63.9 alcista', di 'la fuerza del mercado es saludable'; en lugar de 'FinBERT neutral', di 'el sentimiento en las noticias es estable').`
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
            content: 'Eres un asesor financiero equilibrado y sereno. Das confianza mediante claridad, escenarios y acciones concretas en español sencillo y amigable. No prometes resultados, evitas el lenguaje alarmista y NO utilizas tecnicismos de indicadores de forma directa (como MACD, RSI, FinBERT o puntuaciones numéricas de decisión) en tu respuesta, explicándolos de forma intuitiva.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 450,
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
      systemInstruction: 'Eres un asesor financiero equilibrado y sereno. Das confianza mediante claridad, escenarios y acciones concretas en español sencillo y amigable. No prometes resultados, evitas el lenguaje alarmista y NO utilizas tecnicismos de indicadores de forma directa (como MACD, RSI, FinBERT o puntuaciones numéricas de decisión) en tu respuesta, explicándolos de forma intuitiva.',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 520,
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

function buildGroundedSuggestion(
  symbol: string,
  market: Market,
  quote: YahooQuote,
  technicalSignal?: { type: 'BUY' | 'SELL' | 'HOLD'; strength?: number; reasons?: string[] },
  context?: AdvisorScreenerContext
) {
  const contextAction = (context?.displayAction || technicalSignal?.type || 'HOLD').toUpperCase()
  const decisionScore = typeof context?.decisionScore === 'number' ? context.decisionScore : undefined
  const recommendation = contextAction.includes('BUY') && (decisionScore ?? 75) >= 60
    ? 'COMPRAR CON CAUTELA'
    : contextAction.includes('SELL')
      ? 'EVITAR / VENDER'
      : 'MANTENER'
  const change = formatPercent(quote.regularMarketChangePercent)
  const screenerReason = context?.decisionReason || technicalSignal?.reasons?.[0] || 'no hay ventaja clara suficiente para tomar mas riesgo.'

  const reasonSpanish = screenerReason
    .replace(/recent_ipo_short_history/g, 'historial corto por salida reciente a bolsa (IPO)')
    .replace(/long_term_indicators_disabled/g, 'indicadores de largo plazo desactivados por falta de historial')
    .replace(/positive_immediate_change/g, 'variación positiva reciente en el precio')
    .replace(/valid_day_volume/g, 'volumen de negociación diario saludable')

  return `**${recommendation}**

- El análisis del screener sugiere considerar esta acción debido a: ${reasonSpanish}.
- La variación de precio actual es de ${change} cotizando a ${formatCurrency(quote.regularMarketPrice)}, con condiciones que invitan a la prudencia.
- Acción sugerida: mantener bajo observación activa y esperar señales claras de volumen y precio antes de tomar decisiones operativas.`
}

function hasBullishScreenerContext(
  context: AdvisorScreenerContext | undefined,
  technicalSignal?: { type: 'BUY' | 'SELL' | 'HOLD'; strength?: number; reasons?: string[] }
) {
  if (!context) return false
  const action = `${context.displayAction || ''} ${context.quantAction || ''}`.toUpperCase()
  const sentiment = (context.sentiment || '').toUpperCase()
  const macd = (context.macd || '').toLowerCase()

  const isInsufficientCandles = technicalSignal?.reasons?.some((r) =>
    r.toLowerCase().includes('insuficiente') ||
    r.toLowerCase().includes('velas') ||
    r.toLowerCase().includes('historial')
  ) || false

  if (action.includes('BUY') && sentiment !== 'NEGATIVE') {
    if (isInsufficientCandles) {
      // Si faltan velas pero el quant es alcista, confiamos en el quant
      return true
    }
    return (technicalSignal?.type === 'BUY' || macd.includes('alcista') || macd.includes('positivo')) &&
      (context.finalScore ?? 0) >= 70 &&
      (context.decisionScore ?? 0) >= 75 &&
      (context.changePercent ?? 0) >= 0
  }
  return false
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
  return `**COMPRAR CON CAUTELA**

- El activo ${symbol} (${market}) muestra un rendimiento diario de ${formatPercent(quote.regularMarketChangePercent)}, y nuestro motor cuantitativo ha detectado condiciones favorables para considerar compras graduales.
- El momentum de precios y el volumen de transacciones apoyan la idea de acumulación de posiciones de forma controlada.
- Se recomienda una entrada pausada, evitando compras apresuradas y esperando confirmación de estabilidad en la sesión actual.`
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

function normalizeSuggestion(
  suggestion: string,
  symbol: string,
  market: Market,
  quote: YahooQuote,
  context: AdvisorScreenerContext | undefined,
  technicalSignal?: { type: 'BUY' | 'SELL' | 'HOLD'; strength?: number; reasons?: string[] }
) {
  const aligned = alignSuggestionWithScreener(suggestion, symbol, market, quote, context, technicalSignal)
  if (isIncompleteSuggestion(aligned)) {
    return buildGroundedSuggestion(symbol, market, quote, technicalSignal, context)
  }
  return aligned
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

    // Generar un screenerContext de fallback basado en quantData si no viene de la UI
    let finalScreenerContext = screenerContext
    if (!finalScreenerContext && quantData) {
      finalScreenerContext = {
        source: 'screener',
        symbol,
        market,
        displayAction: quantData.action,
        quantAction: quantData.action,
        confidence: quantData.confidence,
        decisionScore: quantData.confidence,
        regime: quantData.market_regime,
        decisionSource: 'quant_engine',
        decisionReason: `Análisis cuantitativo de Machine Learning (LightGBM). Régimen de mercado: ${quantData.market_regime || 'Desconocido'}`
      }
    }

    const sentRes = await quantClient.getSentimentCache()
    const sentimentData = sentRes.success && sentRes.data
      ? lookupSentiment(sentRes.data as UnknownRecord, symbol, yahooSymbol)
      : null

    const prompt = buildPrompt(symbol, market, quote, newsHeadlines, quantData, sentimentData, technicalSignal, range, finalScreenerContext)
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

    if (process.env.GEMINI_API_KEY) {
      const geminiModelStr = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
      const suggestion = await generateGeminiSuggestion(prompt, geminiModelStr)

      if (suggestion) {
        const alignedSuggestion = normalizeSuggestion(suggestion, symbol, market, quote, finalScreenerContext, technicalSignal)
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
        const alignedSuggestion = normalizeSuggestion(suggestion, symbol, market, quote, finalScreenerContext, technicalSignal)
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
    const alignedSuggestion = normalizeSuggestion(suggestion, symbol, market, quote, finalScreenerContext, technicalSignal)

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

