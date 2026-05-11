const fs = require('fs')
const path = 'src/components/portfolio/portfolio-client.tsx'
let c = fs.readFileSync(path, 'utf8')

// 1. Add Clock and Play imports
c = c.replace(
  /Plus, Loader2, TrendingUp, TrendingDown, Trash2, ArrowUpRight, Briefcase/,
  'Plus, Loader2, TrendingUp, TrendingDown, Trash2, ArrowUpRight, Briefcase, Clock, Play'
)

// 2. Add interfaces after Position interface closing brace
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
    const iface = '\n\ninterface PendingSignal {\n  id: string\n  symbol: string\n  market: Market\n  type: ' + SQ + 'BUY' + SQ + ' | ' + SQ + 'SELL' + SQ + ' | ' + SQ + 'HOLD' + SQ + '\n  strength: number\n  reason: string\n  price: number\n  timeframe: string\n  status: string\n  created_at: string\n  currentPrice?: number\n  performance?: number\n}\n\ninterface PendingSignalResult {\n  signalId: string\n  symbol: string\n  price: number\n  position: any\n}'
    c = c.slice(0, insertAfter) + iface + c.slice(insertAfter)
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

const execFunc = '\n\nasync function executePendingSignals(userId: string): Promise<PendingSignalResult[]> {\n  const supabase = createClient()\n  const { data: { session } } = await supabase.auth.getSession()\n  \n  const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()\n  const { data: pendingSignals } = await supabase\n    .from(' + SQ + 'signals' + SQ + ')\n    .select('*')\n    .eq(' + SQ + 'user_id' + SQ + ', userId)\n    .eq(' + SQ + 'status' + SQ + ', ' + SQ + 'active' + SQ + ')\n    .eq(' + SQ + 'type' + SQ + ', ' + SQ + 'BUY' + SQ + ')\n    .lte(' + SQ + 'created_at' + SQ + ', cutoffDate)\n\n  if (!pendingSignals || pendingSignals.length === 0) return []\n\n  const results: PendingSignalResult[] = []\n\n  for (const signal of pendingSignals) {\n    try {\n      const res = await fetch(' + SQ + '/api/cron/pending-signals/execute' + SQ + ', {\n        method: ' + SQ + 'POST' + SQ + ',\n        headers: {\n          ' + SQ + 'Content-Type' + SQ + ': ' + SQ + 'application/json' + SQ + ',\n          ...(session?.access_token ? { Authorization: ' + BT + 'Bearer ' + BT + ' } : {}),\n        },\n        body: JSON.stringify({ signalId: signal.id, symbol: signal.symbol, market: signal.market, price: signal.price }),\n      })\n\n      if (res.ok) {\n        const body = await res.json().catch(() => null)\n        results.push({\n          signalId: signal.id,\n          symbol: signal.symbol,\n          price: signal.price,\n          position: body?.data?.position || null,\n        })\n      }\n    } catch (err) {\n      console.warn('[execute pending signal]', err)\n    }\n  }\n\n  return results\n}'

const schemaIdx = c.indexOf('const addPositionSchema')
if (schemaIdx > -1) {
  c = c.slice(0, schemaIdx) + fetchFunc + execFunc + '\n' + c.slice(schemaIdx)
  console.log('Functions added at', schemaIdx)
}

// 4. Add hooks after signals useQuery closes
const hooks = '\n\n  const [pendingExecuting, setPendingExecuting] = useState(false)\n  const [executedResults, setExecutedResults] = useState<PendingSignalResult[]>([])\n\n  const { data: pendingSignals = [] } = useQuery({\n    queryKey: [' + SQ + 'pending-signals' + SQ + ', user?.id],\n    queryFn: () => fetchPendingSignals(user!.id),\n    enabled: !!user,\n    refetchInterval: 60 * 60 * 1000,\n  })\n\n  const handleExecutePending = async () => {\n    if (!user || pendingExecuting) return\n    setPendingExecuting(true)\n    try {\n      const results = await executePendingSignals(user.id)\n      setExecutedResults(results)\n      if (results.length > 0) {\n        toast.success(' + BT + ' posicion(es) ejecutada(s exitosamente)' + BT + ')\n        queryClient.invalidateQueries({ queryKey: [' + SQ + 'positions' + SQ + '] })\n        queryClient.invalidateQueries({ queryKey: [' + SQ + 'profile' + SQ + '] })\n        queryClient.invalidateQueries({ queryKey: [' + SQ + 'portfolio-summary' + SQ + '] })\n        queryClient.invalidateQueries({ queryKey: [' + SQ + 'pending-signals' + SQ + ', user.id] })\n      } else {\n        toast.info(' + SQ + 'No hay senales pendientes de ejecucion' + SQ + ')\n      }\n    } catch (err) {\n      console.warn('[execute pending signals]', err)\n      toast.error(' + SQ + 'Error al ejecutar senales pendientes' + SQ + ')\n    } finally {\n      setPendingExecuting(false)\n    }\n  }'

// Find the closing of signals useQuery - look for }) after queryKey: ['signals', user?.id]
const sigQueryMarker = 'queryKey: [' + SQ + 'signals' + SQ + ', user?.id]'
const sigIdx = c.indexOf(sigQueryMarker)
if (sigIdx > -1) {
  // Find the }) that closes this useQuery block
  let closeIdx = -1
  for (let i = sigIdx; i < Math.min(sigIdx + 500, c.length); i++) {
    if (c[i] === '}' && c[i + 1] === ')') {
      // Check if next non-whitespace is a newline followed by const or another variable
      let j = i + 2
      while (j < c.length && (c[j] === '\n' || c[j] === '\r' || c[j] === ' ')) j++
      if (j < c.length && c[j] === 'c') { // const
        closeIdx = i + 2
        break
      }
    }
  }
  if (closeIdx > -1) {
    c = c.slice(0, closeIdx) + hooks + c.slice(closeIdx)
    console.log('Hooks added at', closeIdx)
  } else {
    console.log('Could not find signals useQuery closing')
  }
}

// 5. Add JSX section after summary cards grid
const jsxSection = '\n\n      {/* Pending Signals Section - Weekend/Holiday signals waiting for market open */}\n      {pendingSignals.length > 0 && (\n        <div className="glass rounded-xl p-5 border border-blue-500/20 bg-blue-500/5">\n          <div className="flex items-center justify-between mb-4">\n            <div className="flex items-center gap-2">\n              <Clock className="w-4 h-4 text-blue-400" />\n              <h3 className="text-sm font-semibold text-white">Señales Pendientes ({pendingSignals.length})</h3>\n            </div>\n            <button\n              onClick={handleExecutePending}\n              disabled={pendingExecuting}\n              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"\n            >\n              {pendingExecuting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}\n              Ejecutar Todas\n            </button>\n          </div>\n\n          {executedResults.length > 0 && (\n            <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">\n              <p className="text-xs text-emerald-300 font-semibold">\n                {executedResults.length} posicion(es) ejecutada(s exitosamente:\n              </p>\n              <div className="mt-1 space-y-0.5">\n                {executedResults.map((r, i) => (\n                  <p key={i} className="text-[10px] text-emerald-400/80 font-mono">\n                    {r.symbol} @ r.price.toFixed(2)\n                  </p>\n                ))}\n              </div>\n            </div>\n          )}\n\n          <div className="space-y-2">\n            {pendingSignals.map((sig) => (\n              <div key={sig.id} className="flex items-center justify-between p-3 bg-gray-800/40 rounded-lg border border-gray-700">\n                <div className="flex items-center gap-3">\n                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />\n                  <div>\n                    <Link href={BT}/analysis?symbol=sig.symbol&market=sig.market{BT} className="text-xs font-mono font-bold text-white hover:text-emerald-400 transition-colors">\n                      {sig.symbol}\n                    </Link>\n                    <p className="text-[10px] text-gray-500">{sig.timeframe} · Guardada hace {(Date.now() - new Date(sig.created_at).getTime()) / (1000 * 60 * 60).toFixed(0)}h</p>\n                  </div>\n                </div>\n                <div className="text-right">\n                  <p className="text-xs font-mono text-white">sig.price.toFixed(2)</p>\n                  {sig.currentPrice && sig.performance !== undefined && (\n                    <p className={BT + 'text-[10px] font-semibold ' + SQ + 'text-emerald-400' + SQ + ' ? ' + SQ + 'text-red-400' + SQ + ' : ' + DL + RB + BT}>\n                      {sig.performance >= 0 ? '+' : ''}{sig.performance.toFixed(2)}%\n                    </p>\n                  )}\n                </div>\n              </div>\n            ))}\n          </div>\n\n          <p className="mt-3 text-[10px] text-gray-500">\n            Señales guardadas fuera de horario de mercado. Se ejecutaran al abrir con el precio actual del mercado.\n          </p>\n        </div>\n      )}\n'

// Find the summary cards grid closing div
const posCardIdx = c.indexOf('Posiciones')
if (posCardIdx > -1) {
  let insertAfter = -1
  for (let i = posCardIdx; i < Math.min(posCardIdx + 200, c.length); i++) {
    if (c.slice(i, i + 6) === '</div>') {
      // Check if this is the grid closing div (followed by empty line and then {/* Add form */})
      let j = i + 6
      while (j < c.length && c[j] !== '\n') j++
      j++ // skip newline
      const nextLine = c.substring(j, j + 30)
      if (nextLine.includes('Add form') || nextLine.includes('showAddForm')) {
        insertAfter = i + 6
        break
      }
    }
  }
  if (insertAfter > -1) {
    c = c.slice(0, insertAfter) + jsxSection + c.slice(insertAfter)
    console.log('JSX section added at', insertAfter)
  } else {
    console.log('Could not find insertion point for JSX')
  }
}

fs.writeFileSync(path, c)
console.log('All updates complete!')