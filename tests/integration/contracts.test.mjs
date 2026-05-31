import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('/api/trading persists only valid markets and reports persistence failures', () => {
  const route = read('src/app/api/trading/route.ts')

  assert.match(route, /parseMarketOrLegacy\(body\?\.market, symbol\)/)
  assert.doesNotMatch(route, /market:\s*['"]EQUITY['"]/) 
  assert.match(route, /persisted:\s*true/)
  assert.match(route, /persisted:\s*false/)
  assert.match(route, /persistence_failed/)
})

test('Supabase migration defines atomic virtual trading RPCs', () => {
  const migration = read('supabase/migrations/000_initial_schema.sql')

  assert.match(migration, /CREATE OR REPLACE FUNCTION execute_virtual_trade/)
  assert.match(migration, /FOR UPDATE/)
  assert.match(migration, /INSUFFICIENT_BALANCE/)
  assert.match(migration, /INSERT INTO positions/)
  assert.match(migration, /INSERT INTO transactions/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION close_virtual_position/)
})

test('Alerts cron requires a secret and batches quote requests', () => {
  const route = read('src/app/api/alerts/check/route.ts')

  assert.match(route, /CRON_SECRET|ALERTS_CRON_SECRET/)
  assert.match(route, /x-cron-secret/)
  assert.match(route, /symbols\.join\(','\)/)
  assert.match(route, /durationMs/)
})

test('Quant client does not use localhost in production', () => {
  const client = read('src/lib/ai/quant-client.ts')

  assert.match(client, /NODE_ENV === 'production'/)
  assert.match(client, /QUANT_ENGINE_URL is required in production/)
  assert.match(client, /QUANT_ENGINE_SECRET is required/)
  assert.match(client, /X-TradeMind-Quant-Secret/)
})

test('Quant jobs define durable async workflow contract', () => {
  const migration = read('supabase/migrations/002_quant_jobs_and_market_cache.sql')
  const route = read('src/app/api/quant/jobs/route.ts')

  assert.match(migration, /CREATE TABLE IF NOT EXISTS quant_jobs/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS quant_job_events/)
  assert.match(migration, /CREATE TABLE IF NOT EXISTS market_data_cache/)
  assert.match(migration, /claim_next_quant_job/)
  assert.match(migration, /complete_quant_job/)
  assert.match(migration, /FOR UPDATE SKIP LOCKED/)
  assert.match(route, /NextResponse\.json\(\{ success: true, job: data, deduped: false \}, \{ status: 202 \}\)/)
  assert.match(route, /getAuthenticatedContext/)
  assert.match(route, /idempotencyKey/)
})

test('Candles route uses durable market-data cache before Yahoo fallback', () => {
  const candlesRoute = read('src/app/api/market/candles/route.ts')
  const cache = read('src/lib/api/market-data-cache.ts')

  assert.match(cache, /market_data_cache/)
  assert.match(cache, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(cache, /expires_at/)
  assert.match(cache, /upsert/)
  assert.match(cache, /stale/)
  assert.match(candlesRoute, /getDurableMarketData/)
  assert.match(candlesRoute, /range:\s*`range:\$\{requestedRange\}`/)
  assert.match(candlesRoute, /range:\s*`timeframe:\$\{timeframe\}`/)
})
