const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

async function run() {
  console.log('Testing yahooFinance.chart for BRK.B...');
  try {
    const chartBRKB = await yahooFinance.chart('BRK.B', { interval: '1d', period1: '2026-01-01' });
    console.log('BRK.B chart fetched successfully, candles count:', chartBRKB.quotes.length);
  } catch (err) {
    console.error('BRK.B chart failed:', err.message);
  }

  console.log('\nTesting yahooFinance.chart for BRK-B...');
  try {
    const chartBRKBHyphen = await yahooFinance.chart('BRK-B', { interval: '1d', period1: '2026-01-01' });
    console.log('BRK-B chart fetched successfully, candles count:', chartBRKBHyphen.quotes.length);
  } catch (err) {
    console.error('BRK-B chart failed:', err.message);
  }
}

run();
