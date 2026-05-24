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

  // Dot to hyphen replacement
  assert.match(quoteRoute, /\.replace\(['"]\.['"],\s*['"]-['"]\)/)
  assert.match(candlesRoute, /\.replace\(['"]\.['"],\s*['"]-['"]\)/)
  assert.match(analyzeRoute, /\.replace\(['"]\.['"],\s*['"]-['"]\)/)
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

  // ScanResult interface update
  assert.match(client, /price:\s*number\s*\|\s*null/)
  assert.match(client, /changePercent:\s*number\s*\|\s*null/)
  assert.match(client, /noData\?:/)
  assert.match(client, /isFallback\?:/)

  // analyzeSymbol fallback and noData check
  assert.match(client, /function analyzeSymbol\(/)
  assert.match(client, /noData\s*\|\|\s*!candles\s*\|\|\s*candles\.length\s*===\s*0/)
  assert.match(client, /suggestions:\s*\[\]/)

  // scanResults candles fallback checks
  assert.match(client, /price\s*===\s*null\s*\|\|\s*price\s*===\s*0/)
  assert.match(client, /isFallback\s*=\s*true/)
  assert.match(client, /noData\s*=\s*true/)

  // Render Checks
  assert.match(client, /r\.noData\s*\|\|\s*r\.price\s*===\s*null/)
  assert.match(client, /r\.noData\s*\|\|\s*r\.changePercent\s*===\s*null/)
  assert.match(client, /r\.noData\s*\|\|\s*r\.rsi\s*===\s*null/)
})
