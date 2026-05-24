import assert from 'node:assert/strict'

// 1. Symbol replacement logic
function getYahooSymbol(symbol) {
  return symbol.replace('.', '-')
}

// Mock of frontend quote+candle analysis logic
function processSymbol(symbol, quote, candles) {
  let price = quote ? (quote.price || null) : null
  let changePercent = quote ? (quote.changePercent ?? null) : null
  let volume = quote ? (quote.volume ?? null) : null
  let isFallback = false
  let noData = false

  if (price === null || price === 0) {
    if (candles && candles.length > 0) {
      const lastCandle = candles[candles.length - 1]
      price = lastCandle.close
      if (candles.length > 1) {
        const prevCandle = candles[candles.length - 2]
        changePercent = ((price - prevCandle.close) / prevCandle.close) * 100
      } else {
        changePercent = 0
      }
      volume = lastCandle.volume || 0
      isFallback = true
    } else {
      noData = true
    }
  }

  return { symbol, price, changePercent, volume, isFallback, noData }
}

// CASE 1: BRK.B / BRK-B
const symbol1 = 'BRK.B'
assert.equal(getYahooSymbol(symbol1), 'BRK-B')
console.log('✔ Case 1: BRK.B mapped to BRK-B')

// CASE 2: BF.B / BF-B
const symbol2 = 'BF.B'
assert.equal(getYahooSymbol(symbol2), 'BF-B')
console.log('✔ Case 2: BF.B mapped to BF-B')

// CASE 3: Símbolo inválido (no quote, no candles)
const result3 = processSymbol('XYZABC', null, [])
assert.equal(result3.noData, true)
assert.equal(result3.isFallback, false)
assert.equal(result3.price, null)
console.log('✔ Case 3: Invalid symbol yields noData = true')

// CASE 4: Activo sin quote pero con candles (cierre fallback)
const candles4 = [{ time: 1, close: 150, volume: 1000 }, { time: 2, close: 155, volume: 1200 }]
const result4 = processSymbol('PARA', null, candles4)
assert.equal(result4.noData, false)
assert.equal(result4.isFallback, true)
assert.equal(result4.price, 155)
assert.equal(result4.changePercent, ((155 - 150) / 150) * 100)
console.log('✔ Case 4: Asset with only candles uses last close as fallback')

// CASE 5: Activo sin quote ni candles
const result5 = processSymbol('UNKNOWN', null, null)
assert.equal(result5.noData, true)
assert.equal(result5.isFallback, false)
assert.equal(result5.price, null)
console.log('✔ Case 5: Asset with no quote and no candles yields noData = true')

console.log('\n--- ALL TEST CASES RUN SUCCESSFULLY! ---')
