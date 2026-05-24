const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

const symbols = [
  'BITX', 'UVIX', 'SVIX', 'ZIVB', // some ETFs
  'AMOMX', 'BAMU', 'CSRSX', 'DFLVX', 'DFSVX', // some funds
  'FTEXX', 'FRESX', 'FRXIX', 'FSTMX' // some money market/real estate funds
];

async function run() {
  console.log('Fetching quotes from Yahoo Finance...');
  for (const symbol of symbols) {
    try {
      const quote = await yahooFinance.quote(symbol);
      console.log(`\n--- ${symbol} ---`);
      console.log(`regularMarketPrice: ${quote.regularMarketPrice}`);
      console.log(`regularMarketPreviousClose: ${quote.regularMarketPreviousClose}`);
      console.log(`regularMarketOpen: ${quote.regularMarketOpen}`);
      console.log(`priceHint: ${quote.priceHint}`);
    } catch (err) {
      console.error(`Error fetching ${symbol}:`, err.message);
    }
  }
}

run();
