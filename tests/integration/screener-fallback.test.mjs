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
  const dataQuality = read('src/lib/market-data-quality.ts')
  const historicalNormalizer = read('src/lib/historical-data-normalizer.ts')
  const signalQuality = read('src/lib/signal-quality.ts')
  const robustBacktest = read('src/lib/robust-backtest.ts')
  const portfolioRisk = read('src/lib/portfolio-risk-manager.ts')
  const quantClient = read('src/lib/ai/quant-client.ts')

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
  assert.match(dataQuality, /export function assessMarketDataQuality/)
  assert.match(historicalNormalizer, /export function normalizeHistoricalData/)
  assert.match(signalQuality, /export function assessSignalQuality/)
  assert.match(robustBacktest, /RobustBacktestResult/)
  assert.match(portfolioRisk, /PortfolioRiskResult/)
  assert.match(quantClient, /historical_data_normalizer/)
  assert.match(quantClient, /signal_quality/)
  assert.match(quantClient, /robust_backtest/)
  assert.match(quantClient, /portfolio_risk_manager/)
  assert.match(ranking, /marketDataQuality\?:\s*MarketDataQualityResult/)
  assert.match(scanRoute, /assessMarketDataQuality\(/)
  assert.match(scanRoute, /normalizeHistoricalData\(/)
  assert.match(scanRoute, /resolveProviderFallback\(/)
  assert.match(scanRoute, /fallbackDatasetToCandles/)
  assert.match(scanRoute, /selected_provider/)
  assert.match(scanRoute, /provider_statuses/)
  assert.match(scanRoute, /prelim\.suggestions = prelim\.suggestions\.filter\(\(suggestion\) => suggestion\.type !== 'opportunity'\)/)
  assert.match(scanRoute, /quality\.usable_for_ml && sent\.sentiment === 'POSITIVE'/)
  assert.match(scanRoute, /\.filter\(candidate => candidate\.marketDataQuality\?\.usable_for_ml && candidate\.marketDataQuality\.quality_score >= 60\)/)
  assert.match(scanRoute, /if \(topCandidates\.length > 0\)/)
  assert.match(scanRoute, /market_data_quality:/)
  assert.match(ranking, /preliminary\.marketDataQuality\?\.status === 'FAILED' \|\| preliminary\.noData/)
  assert.match(ranking, /finalScore:\s*0/)
  assert.match(ranking, /preliminary\.marketDataQuality\?\.usable_for_ml === false/)
  assert.match(ranking, /providerFallback\?:\s*Record<string, unknown>/)
  assert.match(ranking, /return blockedA \? 1 : -1/)
  assert.doesNotMatch(client, /verifyState/)
  assert.doesNotMatch(client, /runVerification/)
  assert.doesNotMatch(client, /Estado de conex/)
  assert.doesNotMatch(client, /ltima consulta realizada/)
  assert.doesNotMatch(client, /Resultado Python/)
  assert.match(client, /const isMarketDataBlocked = \(r: FinalQuantScore\)/)
  assert.match(client, /const topCards = scanResults\.filter\(r => !isMarketDataBlocked\(r\)\)\.slice\(0, 9\)/)
  assert.match(client, /DATA: \{r\.marketDataQuality\.provider\}/)
  assert.match(client, /r\.signalQuality\.signal_status === 'OK'/)
  assert.match(client, /r\.signalQuality\.final_action === 'BUY'/)
  assert.match(client, /r\.signalQuality\.final_confidence >= 70/)
  assert.match(client, /r\.robustBacktest\?\.usable_for_decision !== false/)
  assert.match(client, /r\.robustBacktest\?\.backtest_status !== 'BLOCKED'/)
  assert.match(client, /r\.robustBacktest\?\.backtest_status !== 'FAILED'/)
  assert.match(client, /r\.portfolioRisk\?\.portfolio_risk_status !== 'BLOCKED'/)
  assert.match(client, /r\.portfolioRisk\?\.action_allowed !== false/)
  assert.match(client, /r\.signalQuality\.signal_status/)
  assert.match(client, /if \(isMarketDataBlocked\(r\)\) return 'HOLD'/)
  assert.match(client, /if \(isMarketDataBlocked\(r\)\) return 0/)

  // Render Checks
  assert.match(client, /r\.noData\s*\|\|\s*r\.price\s*===\s*null/)
  assert.match(client, /r\.noData\s*\|\|\s*r\.changePercent\s*===\s*null/)
  assert.match(client, /r\.noData\s*\|\|\s*r\.rsi\s*===\s*null/)
})

test('Screener blocks LightGBM ready state when asset ranking is fallback', () => {
  const client = read('src/components/screener/screener-client.tsx')
  const assetRankRoute = read('src/app/api/quant/asset-rank/route.ts')

  assert.match(client, /function isPythonLightGbmReady/)
  assert.match(client, /body\?\.model_status === 'loaded'/)
  assert.match(client, /body\?\.python_execution\?\.quant_engine_ready === true/)
  assert.match(client, /body\?\.python_execution\?\.lightgbm_ready === true/)
  assert.match(client, /setMlRankings\(\[\]\)/)
  assert.match(client, /Ranking tecnico fallback/)
  assert.match(client, /Top Ranking tecnico \(fallback\)/)
  assert.match(client, /formatQuantEngineWarning/)
  assert.match(client, /Modo fallback tecnico/)
  assert.match(client, /mlRankings\.length > 0/)
  assert.match(client, /enabled:\s*lightgbmUiReady && forceQuantRefreshNonce > 0/)
  assert.doesNotMatch(client, /Ranking ML completado/)
  assert.doesNotMatch(client, /LightGBM listo/)

  assert.match(assetRankRoute, /model_status:\s*'local_fallback_quant_unavailable'/)
  assert.match(assetRankRoute, /status:\s*503/)
  assert.match(assetRankRoute, /status:\s*424/)
  assert.match(assetRankRoute, /rankAssetsLocally/)
  assert.match(assetRankRoute, /using local technical fallback ranking/)
})

test('Sentiment scan degrades instead of failing the screener when quant engine is unavailable', () => {
  const client = read('src/components/screener/screener-client.tsx')
  const sentimentRoute = read('src/app/api/quant/sentiment/route.ts')

  assert.match(sentimentRoute, /degraded:\s*true/)
  assert.match(sentimentRoute, /refreshedRanking:\s*false/)
  assert.match(sentimentRoute, /Quant engine unavailable; sentiment scan skipped/)
  assert.match(client, /body\?\.degraded/)
  assert.match(client, /Noticias no actualizadas/)
})
