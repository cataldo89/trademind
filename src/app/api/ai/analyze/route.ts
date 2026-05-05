import { NextRequest, NextResponse } from 'next/server'
import { yahooFinance } from '@/lib/yahoo-finance'
import { GoogleGenerativeAI } from '@google/generative-ai'

interface AnalyzeRequestBody {
  symbol?: unknown
  market?: unknown
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

function buildPrompt(symbol: string, market: string | undefined, quote: YahooQuote, newsHeadlines: string) {
  return `Actúa como un analista financiero senior experto en mercados bursátiles.
Analiza el siguiente activo y entrega una sugerencia de inversión clara en español: COMPRAR CON CAUTELA, EVITAR / VENDER o MANTENER.
Usa datos de mercado, titulares recientes y contexto técnico simple. Sé conciso, profesional y evita encabezados grandes.

Símbolo: ${symbol}
Mercado: ${market || 'No especificado'}
Nombre: ${quote.longName || quote.shortName || 'No disponible'}
Precio actual: ${formatCurrency(quote.regularMarketPrice)}
Cambio del día: ${formatPercent(quote.regularMarketChangePercent)}
Rango del día: ${formatCurrency(quote.regularMarketDayLow)} - ${formatCurrency(quote.regularMarketDayHigh)}

Últimas noticias:
${newsHeadlines}

Empieza la respuesta con la recomendación principal en negrita.`
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
            content: 'Eres un asesor financiero prudente. No prometes resultados y explicas riesgos de forma clara.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
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
      systemInstruction: 'Eres un asesor financiero prudente. No prometes resultados y explicas riesgos de forma clara.',
      generationConfig: {
        temperature: 0.3,
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

function buildDeterministicSuggestion(symbol: string, market: string | undefined, quote: YahooQuote, newsHeadlines: string) {
  const change = quote.regularMarketChangePercent ?? 0
  const newsScore = scoreNews(newsHeadlines)
  const recommendation = change <= -3 || newsScore <= -2
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AnalyzeRequestBody
    const symbol = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : ''
    const market = typeof body.market === 'string' ? body.market : undefined

    if (!symbol) {
      return NextResponse.json({ error: 'Symbol is required' }, { status: 400 })
    }

    const quote = (await yahooFinance.quote(symbol)) as YahooQuote | null
    if (!quote) {
      return NextResponse.json({ error: 'Data not found for symbol' }, { status: 404 })
    }

    const searchRes = (await yahooFinance.search(symbol)) as YahooSearchResult
    const newsHeadlines = buildNewsHeadlines(searchRes)
    const prompt = buildPrompt(symbol, market, quote, newsHeadlines)
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

    if (process.env.GEMINI_API_KEY) {
      const geminiModelStr = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
      const suggestion = await generateGeminiSuggestion(prompt, geminiModelStr)

      if (suggestion) {
        return NextResponse.json({
          data: {
            suggestion,
            provider: 'Google Gemini',
            model: geminiModelStr,
          },
        })
      }
    } else if (process.env.OPENAI_API_KEY) {
      const suggestion = await generateOpenAISuggestion(prompt, model)

      if (suggestion) {
        return NextResponse.json({
          data: {
            suggestion,
            provider: 'OpenAI',
            model,
          },
        })
      }
    }

    const suggestion = buildDeterministicSuggestion(symbol, market, quote, newsHeadlines)

    return NextResponse.json({
      data: {
        suggestion,
        provider: 'TradeMind Cloud',
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
