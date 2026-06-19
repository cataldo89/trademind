import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('Final decision gate implements comprehensive veto rules and price reconciliation', () => {
  const gate = read('src/lib/final-decision-gate.ts')

  // Exported functions
  assert.match(gate, /export function evaluateFinalDecisionGate/)
  assert.match(gate, /export function isCryptoSymbol/)

  // 1. Data Quality Checks
  assert.match(gate, /usable_for_ml !== true/)
  assert.match(gate, /quality_score.*<.*60/)
  assert.match(gate, /crypto_market_provider_invalid.*mandatory Alpaca/)

  // 2. Data Freshness Policy
  assert.match(gate, /stale_crypto_data.*max 15 mins allowed/)
  assert.match(gate, /stale_stock_data.*during regular market hours/)

  // 3. Price Reconciliation (USD vs CLP)
  assert.match(gate, /price_mismatch.*USD model price converted to CLP.*differs from display price/)
  assert.match(gate, /diffPct\s*>\s*2\.0/)

  // 4. Signal Quality Checks
  assert.match(gate, /final_action.*!==.*BUY/)
  assert.match(gate, /final_confidence.*<.*70/)

  // 5. Robust Backtest Checks
  assert.match(gate, /backtest_status === 'BLOCKED' \|\|.*backtest_status === 'FAILED'/)

  // 6. Portfolio Risk Checks
  assert.match(gate, /portfolio_risk_status === 'BLOCKED'/)

  // 7. Trade Execution Guard Checks
  assert.match(gate, /trade_execution_guard blocked/)
})

test('Detailed Scan route calls decision gate and enforces Alpaca-only crypto candles', () => {
  const scanRoute = read('src/app/api/quant/scan/route.ts')

  // Gate invocation and return payload
  assert.match(scanRoute, /evaluateFinalDecisionGate\(/)
  assert.match(scanRoute, /final_decision_audit/)
  assert.match(scanRoute, /provider_statuses/)

  // Alpaca-only enforcement
  assert.match(scanRoute, /if \(cryptoOnly\)/)
  assert.match(scanRoute, /scanCandleProviders\.set\(symbol\.toUpperCase\(\),\s*['"]alpaca['"]\)/)
})

test('Fast ranking route restricts output to candidate metrics and maps signals to candidate_signal', () => {
  const assetRankRoute = read('src/app/api/quant/asset-rank/route.ts')

  assert.match(assetRankRoute, /candidate_rank:\s*r\.rank/)
  assert.match(assetRankRoute, /candidate_score:\s*r\.score/)
  assert.match(assetRankRoute, /candidate_signal:\s*r\.signal === 'BUY' \? 'CANDIDATE' :/)
})

test('Screener client component maps candidates and displays decision gate audits', () => {
  const client = read('src/components/screener/screener-client.tsx')

  // Map ML rankings using candidate fields
  assert.match(client, /r\.candidate_rank !== undefined \? r\.candidate_rank : r\.rank/)
  assert.match(client, /r\.candidate_score !== undefined \? r\.candidate_score : r\.score/)
  assert.match(client, /r\.candidate_signal !== undefined \? r\.candidate_signal : r\.signal/)
  assert.match(client, /Candidato #/)

  // Display audit details
  assert.match(client, /getDisplayDecision\(r\)/)
  assert.match(client, /getWhatIsMissingToBuy\(/)
  assert.match(client, /Hora actualización:/)
  assert.match(client, /Precio modelo:/)
  assert.match(client, /Precio display:/)
  assert.match(client, /Tasa cambio \(USD\/CLP\):/)
})
