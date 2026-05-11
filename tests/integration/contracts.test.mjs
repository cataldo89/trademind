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