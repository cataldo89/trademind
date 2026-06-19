import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequestBody {
  symbol: string
  market: string
  promptContext?: string
  originalSuggestion?: string
  messages: ChatMessage[]
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatRequestBody
    const symbol = body.symbol
    const market = body.market
    const promptContext = body.promptContext || ''
    const originalSuggestion = body.originalSuggestion || ''
    const messages = body.messages || []

    if (!symbol || !messages.length) {
      return NextResponse.json({ error: 'Symbol and messages are required' }, { status: 400 })
    }

    const systemInstruction = `Actúa como el Asesor Financiero IA en la nube de TradeMind.
Tu tarea es ayudar al usuario respondiendo preguntas y aclarando dudas sobre la recomendación de inversión que acabas de dar para el activo ${symbol} (${market}).

Esta es la recomendación inicial que diste al usuario:
---
${originalSuggestion}
---

Este es el contexto detallado de mercado (datos técnicos, quant, sentimiento) en el que se basó tu recomendación:
---
${promptContext}
---

Responde de manera amigable, profesional, clara y concisa en español. Resuelve las dudas del usuario directamente basadas en esta información. No uses tecnicismos de indicadores de forma directa (como MACD, RSI, HMM, FinBERT), sino explícalos de manera amigable e intuitiva si el usuario pregunta por ellos.`

    if (process.env.GEMINI_API_KEY) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        systemInstruction,
      })

      const contents = messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }))

      const result = await model.generateContent({ contents })
      const text = result.response.text()

      return NextResponse.json({ text })
    } else if (process.env.OPENAI_API_KEY) {
      const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: openaiModel,
          messages: [
            { role: 'system', content: systemInstruction },
            ...messages.map(msg => ({
              role: msg.role === 'assistant' ? 'assistant' : 'user',
              content: msg.content
            }))
          ],
          temperature: 0.5,
        })
      })

      if (!response.ok) {
        throw new Error('OpenAI API error')
      }

      const data = await response.json()
      const text = data.choices?.[0]?.message?.content || ''
      return NextResponse.json({ text })
    }

    return NextResponse.json({
      text: 'El servicio de chat con el Asesor IA no está disponible porque no hay claves de API configuradas.'
    }, { status: 503 })

  } catch (error) {
    console.error('[API/AI/Chat] Error:', error)
    return NextResponse.json({ error: 'Error interno al procesar el chat con el asesor' }, { status: 500 })
  }
}
