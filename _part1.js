const fs = require('fs')
const path = 'src/components/portfolio/portfolio-client.tsx'
let c = fs.readFileSync(path, 'utf8')

// 1. Add Clock and Play imports
c = c.replace(
  /Plus, Loader2, Trash2, ArrowUpRight, Briefcase/,
  'Plus, Loader2, Trash2, ArrowUpRight, Briefcase, Clock, Play'
)
// 2. Add interfaces after Position interface
const posIdx = c.indexOf('interface Position {')
if (posIdx > -1) {
  const braceStart = c.indexOf('{', posIdx)
  let depth = 0
  let insertAfter = -1
  for (let i = braceStart; i < c.length; i++) {
    if (c[i] === '{') depth++
    else if (c[i] === '}') { depth--; if (depth === 0) { insertAfter = i + 1; break } }
  }
  if (insertAfter > -1) {
    const SQ = String.fromCharCode(39)
    const interfaces = '\n\ninterface PendingSignal {\n  id: string\n  symbol: string\n  market: Market\n  type: ' + SQ + 'BUY' + SQ + ' | ' + SQ + 'SELL' + SQ + ' | ' + SQ + 'HOLD' + SQ + '\n  strength: number\n  reason: string\n  price: number\n  timeframe: string\n  status: string\n  created_at: string\n  currentPrice?: number\n  performance?: number\n}\n\ninterface PendingSignalResult {\n  signalId: string\n  symbol: string\n  price: number\n  position: any\n}'
    c = c.slice(0, insertAfter) + interfaces + c.slice(insertAfter)
    console.log('Interfaces added at', insertAfter)
  }
}
// 3. Add functions before const addPositionSchema
const SQ = String.fromCharCode(39)
const BT = String.fromCharCode(96)
const DL = '$'
const LB = String.fromCharCode(123)
const RB = String.fromCharCode(125)

const fetchFunc = 'async function fetchPendingSignals(userId: string): Promise<PendingSignal[]> {\n  const supabase = createClient()\n  const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()\n  \n  const { data } = await supabase\n    .from(' + SQ + 'signals' + SQ + ')\n    .select('*')\n    .eq(' + SQ + 'user_id' + SQ + ', userId)\n    .eq(' + SQ + 'status' + SQ + ', ' + SQ + 'active' + SQ + ')\n    .eq(' + SQ + 'type' + SQ + ', ' + SQ + 'BUY' + SQ + ')\n    .lte(' + SQ + 'created_at' + SQ + ', cutoffDate)\n    .order(' + SQ + 'created_at' + SQ + ', { ascending: true })\n\n  if (!data || data.length === 0) return []\n\n  const symbols = Array.from(new Set(data.map((s: any) => s.symbol).filter(Boolean)))\n  const quoteBySymbol = new Map<string, { price?: number }>()\n\n  if (symbols.length > 0) {\n    try {\n      const market = data[0]?.market || ' + SQ + 'US' + SQ + '\n      const res = await fetch(' + BT + '/api/market/quote?symbols=&market=' + BT + ')\n      if (res.ok) {\n        const quoteData = await res.json()\n        const quotes = Array.isArray(quoteData.data) ? quoteData.data : [quoteData.data]\n        quotes.forEach((q: any) => {\n          if (q?.symbol) quoteBySymbol.set(String(q.symbol).toUpperCase(), q)\n        })\n      }\n    } catch {}\n  }\n\n  return data.map((signal: any) => {\n    const quote = quoteBySymbol.get(signal.symbol.toUpperCase())\n    const currentPrice = Number(quote?.price || signal.price)\n    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null\n    \n    const entryPrice = Number(signal.price)\n    const performance = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0\n    \n    return { ...signal, currentPrice, performance } as PendingSignal\n  }).filter(Boolean) as PendingSignal[]\n}'