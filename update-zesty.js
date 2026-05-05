/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

const zestyPath = path.join(__dirname, '..', 'Antecedentes', 'Zesty', 'Inversiones', 'zesty_all.txt')
const marketDataPath = path.join(__dirname, 'src', 'lib', 'market-data.ts')

const ZESTY_LINE_REGEX = /^\d+\.\s+(.+?)\s+\(([^)]+)\)\s*$/
const ZESTY_BLOCK_REGEX = /export const ZESTY_SYMBOLS = \[(.|\r|\n)*?\]\n?/m

function parseZestySymbols(rawText) {
  const entries = []
  const seen = new Set()

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = line.match(ZESTY_LINE_REGEX)
    if (!match) continue

    const name = match[1].trim()
    const symbol = match[2].trim().toUpperCase()
    if (!symbol || seen.has(symbol)) continue

    seen.add(symbol)
    entries.push({ symbol, name })
  }

  return entries
}

function formatZestyBlock(entries) {
  const rows = entries.map(({ symbol, name }) => {
    const safeName = name.replace(/'/g, "\\'")
    return `  { symbol: '${symbol}', name: '${safeName}' },`
  })

  return `export const ZESTY_SYMBOLS = [\n${rows.join('\n')}\n]\n`
}

function parseCurrentZestySymbols(marketDataText) {
  const match = marketDataText.match(/export const ZESTY_SYMBOLS = \[(.|\r|\n)*?\]/m)
  if (!match) return new Set()

  const symbols = new Set()
  const regex = /symbol:\s*'([^']+)'/g
  let m
  while ((m = regex.exec(match[0])) !== null) {
    symbols.add(m[1].trim().toUpperCase())
  }
  return symbols
}

function main() {
  const zestyText = fs.readFileSync(zestyPath, 'utf-8')
  const marketDataText = fs.readFileSync(marketDataPath, 'utf-8')

  const parsed = parseZestySymbols(zestyText)
  if (parsed.length === 0) {
    throw new Error('No se pudieron parsear símbolos desde zesty_all.txt')
  }

  const txtSet = new Set(parsed.map((x) => x.symbol))
  const currentSet = parseCurrentZestySymbols(marketDataText)

  const missingInCode = [...txtSet].filter((s) => !currentSet.has(s))
  const extraInCode = [...currentSet].filter((s) => !txtSet.has(s))

  const newBlock = formatZestyBlock(parsed)

  if (!ZESTY_BLOCK_REGEX.test(marketDataText)) {
    throw new Error('No se encontró el bloque export const ZESTY_SYMBOLS en market-data.ts')
  }

  const updated = marketDataText.replace(ZESTY_BLOCK_REGEX, `${newBlock}\n`)
  fs.writeFileSync(marketDataPath, updated, 'utf-8')

  console.log('[ZESTY] Sincronización completada')
  console.log(`[ZESTY] Total en TXT parseable: ${parsed.length}`)
  console.log(`[ZESTY] Faltantes en código (antes de sync): ${missingInCode.length}`)
  console.log(`[ZESTY] Sobrantes en código (eliminados): ${extraInCode.length}`)
  if (extraInCode.length) {
    console.log(`[ZESTY] Ejemplo sobrantes: ${extraInCode.slice(0, 10).join(', ')}`)
  }
}

main()
