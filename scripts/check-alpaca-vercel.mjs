const base = process.argv[2] || 'https://trademind-cv-ten.vercel.app'
const url = new URL('/api/alpaca/health', base)

const response = await fetch(url, { cache: 'no-store' })
const body = await response.json().catch(() => null)

console.log(`Alpaca Vercel health: ${response.status}`)
console.log(JSON.stringify(body, null, 2))

if (!response.ok || !body?.ok) {
  process.exitCode = 1
}
