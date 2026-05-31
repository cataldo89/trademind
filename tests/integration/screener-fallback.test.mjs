import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('Screener handles BRK.B / BRK-B and BF.B / BF-B in route normalizations', () => {
  const quoteRoute = read('src/app/api/market/quote/route.ts')
  const candlesRoute = read('src/app/api/market/candles/route.ts')
  const analyzeRoute = read('src/app/api/ai/analyze/route.ts')
  const marketData = read('src/lib/market-data.ts')

  // Dot to hyphen replacement lives in the shared symbol helper.
  assert.match(marketData, /\.replace\(['"]\.['"],\s*['"]-['"]\)/)
  assert.match(quoteRoute, /getYahooSymbol\(s,\s*market\)/)
  assert.match(candlesRoute, /getYahooSymbol\(/)
  assert.match(analyzeRoute, /getYahooSymbol\(/)
})

test('Yahoo Finance calls use validateResult: false and log failures', () => {
  const quoteRoute = read('src/app/api/market/quote/route.ts')
  const analyzeRoute = read('src/app/api/ai/analyze/route.ts')

  // validateResult: false
  assert.match(quoteRoute, /validateResult:\s*false/)
  assert.match(analyzeRoute, /validateResult:\s*false/)

  // Try catch logging
  assert.match(quoteRoute, /console\.error\(`\[Yahoo Finance\] Error fetching single quote for/)
  assert.match(quoteRoute, /console\.error\(`\[Yahoo Finance\] Error fetching batch quotes for/)
  assert.match(quoteRoute, /console\.error\(`\[Yahoo Finance\] Error fetching individual quote for/)
  assert.match(analyzeRoute, /console\.error\(`\[Yahoo Finance\] Error fetching quote for/)
})

test('Screener client implements candles fallback and noData handling', () => {
  const client = read('src/components/screener/screener-client.tsx')
  const scanRoute = read('src/app/api/quant/scan/route.ts')
  const ranking = read('src/lib/ranking.ts')

  // Current scan contract keeps nullable market data and fallback flags in shared ranking types.
  assert.match(ranking, /price:\s*number\s*\|\s*null/)
  assert.match(ranking, /changePercent:\s*number\s*\|\s*null/)
  assert.match(ranking, /noData:\s*boolean/)
  assert.match(ranking, /isFallback:\s*boolean/)

  // /api/quant/scan marks incomplete candles as noData through calculatePreliminaryScore.
  assert.match(scanRoute, /calculatePreliminaryScore\(/)
  assert.match(ranking, /!\s*candles\s*\|\|\s*candles\.length\s*<\s*10/)
  assert.match(ranking, /noData\s*=\s*true/)

  // Python failures are represented as structured diagnostics instead of breaking the whole screener.
  assert.match(scanRoute, /type PythonResultRecord/)
  assert.match(scanRoute, /classifyPythonResult/)
  assert.match(scanRoute, /engine_status:\s*classification\.status/)
  assert.match(scanRoute, /quant_usable:/)
  assert.match(scanRoute, /const isFallback = isTopCandidate \? \(!pythonRecord \|\| !pythonRecord\.ok\) : true/)
  assert.match(scanRoute, /calculateFinalQuantScore\(p,\s*quantData,\s*isFallback\)/)

  // Render Checks
  assert.match(client, /r\.noData\s*\|\|\s*r\.price\s*===\s*null/)
  assert.match(client, /r\.noData\s*\|\|\s*r\.changePercent\s*===\s*null/)
  assert.match(client, /r\.noData\s*\|\|\s*r\.rsi\s*===\s*null/)
})
