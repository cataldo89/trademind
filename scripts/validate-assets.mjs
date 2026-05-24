import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

const CONCURRENCY = 5
const DELAY_MS = 200

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function readZestySymbols(projectRoot) {
  const marketDataPath = path.join(projectRoot, 'src', 'lib', 'market-data.ts')
  const source = await readFile(marketDataPath, 'utf8')
  
  // Parse ZESTY_SYMBOLS
  const arrayMatch = source.match(/export\s+const\s+ZESTY_SYMBOLS\s*=\s*\[([\s\S]*?)\]\s*(?:\n|$)/)
  if (!arrayMatch) {
    throw new Error(`Could not find ZESTY_SYMBOLS in ${marketDataPath}`)
  }

  const symbols = []
  const objectRegex = /\{[\s\S]*?symbol\s*:\s*(['"])((?:\\.|(?!\1)[\s\S])*?)\1\s*,\s*name\s*:\s*(['"])((?:\\.|(?!\3)[\s\S])*?)\3[\s\S]*?\}/g
  let match

  while ((match = objectRegex.exec(arrayMatch[1])) !== null) {
    symbols.push({
      symbol: match[2].trim(),
      name: match[4].trim(),
    })
  }

  // Parse SYMBOL_CATEGORY_MAP
  const mapMatch = source.match(/export\s+const\s+SYMBOL_CATEGORY_MAP\s*:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\}/)
  const categoryMap = {}
  if (mapMatch) {
    const entryRegex = /(['"]?)([a-zA-Z0-9.\-]+)\1\s*:\s*(['"])([a-zA-Z0-9.\-]+)\3/g
    let entryMatch
    while ((entryMatch = entryRegex.exec(mapMatch[1])) !== null) {
      categoryMap[entryMatch[2]] = entryMatch[4]
    }
  }

  return { symbols, categoryMap }
}

function classifyAsset(symbol, name, category) {
  const nameUpper = name.toUpperCase()
  const symUpper = symbol.toUpperCase()

  let type = 'Acción'
  let subtype = 'Ordinaria'

  if (symUpper.endsWith('-USD') || symUpper === 'BTC' || symUpper === 'ETH') {
    type = 'Cripto'
    subtype = 'Criptomoneda'
  } else if (category === 'etf-apalancados' || nameUpper.includes('2X') || nameUpper.includes('3X') || nameUpper.includes('DOUBLE') || nameUpper.includes('TRIPLE') || nameUpper.includes('LEVERAGED')) {
    type = 'ETF'
    subtype = 'Apalancado'
  } else if (category === 'etf-inversos' || nameUpper.includes('SHORT') || nameUpper.includes('BEAR') || nameUpper.includes('INVERSE')) {
    type = 'ETF'
    subtype = 'Inverso'
  } else if (category && category.startsWith('etf-') || nameUpper.includes('ETF') || nameUpper.includes('FUND') || nameUpper.includes('TRUST') || nameUpper.includes('INDEX')) {
    type = 'ETF'
    subtype = 'Estándar'
  }

  return { type, subtype }
}

async function validateAsset(item, categoryMap) {
  const originalSymbol = item.symbol
  let yahooSymbol = originalSymbol
  let normalized = false

  // Check if normalization is needed (e.g. BRK.B -> BRK-B)
  if (originalSymbol.includes('.')) {
    yahooSymbol = originalSymbol.replace('.', '-')
    normalized = true
  }

  const category = categoryMap[originalSymbol] || 'otros'
  const { type, subtype } = classifyAsset(originalSymbol, item.name, category)

  let quoteOk = false
  let candlesOk = false
  let price = null
  let previousClose = null
  let errorMessage = null
  let candleCount = 0

  // 1. Fetch Quote
  try {
    const quote = await yahooFinance.quote(yahooSymbol, {}, { validateResult: false })
    if (quote) {
      price = quote.regularMarketPrice || quote.currentPrice || quote.regularMarketPreviousClose || null
      previousClose = quote.regularMarketPreviousClose || null
      
      if (price !== null && Number.isFinite(price)) {
        quoteOk = true
      }
    }
  } catch (err) {
    errorMessage = err.message || String(err)
  }

  // 2. Fetch candles to check history sufficiency
  if (quoteOk) {
    try {
      const now = new Date()
      const oneMonthAgo = new Date()
      oneMonthAgo.setDate(now.getDate() - 30)

      const chart = await yahooFinance.chart(yahooSymbol, {
        period1: Math.floor(oneMonthAgo.getTime() / 1000),
        period2: Math.floor(now.getTime() / 1000),
        interval: '1d'
      })

      if (chart && chart.quotes && chart.quotes.length > 0) {
        candleCount = chart.quotes.filter(q => q && q.close !== null && q.close !== undefined).length
        if (candleCount >= 10) {
          candlesOk = true
        }
      }
    } catch (err) {
      // Just flag candlesOk as false
    }
  }

  return {
    symbol: originalSymbol,
    yahooSymbol,
    name: item.name,
    category,
    type,
    subtype,
    normalized,
    quoteOk,
    candlesOk,
    price,
    previousClose,
    candleCount,
    error: errorMessage
  }
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(scriptDir, '..')
  
  console.log('--- Iniciando Auditoría de Activos contra Yahoo Finance ---')
  const { symbols, categoryMap } = await readZestySymbols(projectRoot)
  console.log(`Total de activos declarados en ZESTY_SYMBOLS: ${symbols.length}`)

  const results = []
  const uniqueSymbols = new Set()
  const duplicates = []

  // Check duplicates in ZESTY_SYMBOLS
  for (const item of symbols) {
    if (uniqueSymbols.has(item.symbol)) {
      duplicates.push(item.symbol)
    } else {
      uniqueSymbols.add(item.symbol)
    }
  }

  // Execute validation with controlled concurrency
  let completed = 0
  const chunks = []
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    chunks.push(symbols.slice(i, i + CONCURRENCY))
  }

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map(async (item) => {
        const res = await validateAsset(item, categoryMap)
        completed++
        if (completed % 50 === 0 || completed === symbols.length) {
          console.log(`Progreso: [${completed}/${symbols.length}] activos validados...`)
        }
        await sleep(DELAY_MS)
        return res
      })
    )
    results.push(...chunkResults)
  }

  // Compute metrics
  const totalDeclared = symbols.length
  const totalUnique = uniqueSymbols.size
  const totalDuplicates = duplicates.length
  
  const validAssets = results.filter(r => r.quoteOk && r.candlesOk)
  const withoutQuote = results.filter(r => !r.quoteOk)
  const withoutCandles = results.filter(r => r.quoteOk && !r.candlesOk)
  const normalizedAssets = results.filter(r => r.normalized)
  
  const totalValid = validAssets.length
  const totalWithoutQuote = withoutQuote.length
  const totalWithoutCandles = withoutCandles.length
  const totalNormalized = normalizedAssets.length
  const totalInsufficientData = withoutQuote.length + withoutCandles.length

  const problematicSymbols = results.filter(r => !r.quoteOk || !r.candlesOk)

  // Generate Markdown report
  let md = `# Reporte de Cobertura y Salud de Activos (Screener)

Generado el: ${new Date().toLocaleString('es-ES', { timeZone: 'America/New_York' })} (Eastern Time)
Fuente: Yahoo Finance (Llamadas en vivo a API)

## Resumen Ejecutivo

| Métrica | Valor | Descripción |
|---|---|---|
| **Total Activos Declarados** | ${totalDeclared} | Cantidad total en el arreglo \`ZESTY_SYMBOLS\` |
| **Total Activos Únicos** | ${totalUnique} | Excluyendo duplicados |
| **Total Activos Válidos** | ${totalValid} | Tienen Quote y Candles de 1M suficientes (>=10) |
| **Total Activos Normalizados** | ${totalNormalized} | Requieren sustitución de punto por guión (ej. \`BRK.B\` -> \`BRK-B\`) |
| **Total Activos Sin Quote** | ${totalWithoutQuote} | Yahoo no los reconoce o no tienen cotización |
| **Total Activos Sin Velas Suficientes** | ${totalWithoutCandles} | Tienen Quote pero no historial de velas (>10) |
| **Total Activos Duplicados** | ${totalDuplicates} | Declarados múltiples veces |

---

## Duplicados Detectados
${totalDuplicates > 0 
  ? duplicates.map(s => `- \`${s}\``).join('\n')
  : 'No se detectaron símbolos duplicados.'}

---

## Activos Normalizados (Puntos a Guiones)
Los siguientes activos requieren ser mapeados a formato de guión en Yahoo Finance:
${normalizedAssets.map(r => `- \`${r.symbol}\` -> normalizado como \`${r.yahooSymbol}\` en Yahoo`).join('\n')}

---

## Listado de Símbolos Problemáticos (Inválidos o Datos Insuficientes)
Estos símbolos causarán fallas o se saltarán en el motor cuántico, por lo que deberían limpiarse o revisarse:

| Símbolo | Nombre | Categoría | Tipo | Subtipo | Razón de Falla |
|---|---|---|---|---|---|
${problematicSymbols.map(r => {
  const reason = !r.quoteOk 
    ? `Sin Quote (Error: ${r.error || 'Desconocido'})` 
    : `Velas insuficientes (Contadas: ${r.candleCount})`;
  return `| \`${r.symbol}\` | ${r.name} | \`${r.category}\` | ${r.type} | ${r.subtype} | ${reason} |`;
}).join('\n')}

---

## Recomendaciones para la Limpieza del Universo

1. **Eliminar Duplicados**: Limpiar los símbolos duplicados del archivo \`market-data.ts\`.
2. **Normalización por Defecto**: Asegurarse de que el backend de Next.js y el motor de Python siempre reemplacen \`.\` por \`-\` para todas las llamadas a Yahoo Finance de forma automática (esto ya está implementado en las funciones de normalización pero debe asegurarse en el flujo completo).
3. **Remover Símbolos Inexistentes**: Eliminar del archivo \`src/lib/market-data.ts\` los símbolos listados arriba que devuelven error de Quote, ya que corresponden a activos deslistados o mal escritos en las fuentes originales.
4. **Pestañas del Screener**: Utilizar solo la lista de símbolos válidos para evitar llamadas innecesarias a Yahoo Finance.
`

  const reportsDir = path.join(projectRoot, 'reports')
  await mkdir(reportsDir, { recursive: true })
  
  const reportPath = path.join(reportsDir, 'zesty-symbol-health-report.md')
  const jsonPath = path.join(reportsDir, 'zesty-symbol-health.json')
  
  await writeFile(reportPath, md, 'utf8')
  await writeFile(jsonPath, JSON.stringify(results, null, 2), 'utf8')
  
  console.log(`\nAuditoría finalizada con éxito!`)
  console.log(`Reporte Markdown escrito en: ${reportPath}`)
  console.log(`Reporte JSON escrito en: ${jsonPath}`)
}

main().catch((err) => {
  console.error('Error en ejecución del script de auditoría:', err)
  process.exitCode = 1
})
