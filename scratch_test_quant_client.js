import assert from 'node:assert/strict'

const url = 'https://seat-implications-fixed-operating.trycloudflare.com/workflow/analyze'
const secret = 'local-dev-secret'

console.log('Testing quant-engine connection directly via Cloudflare Tunnel...')
console.log('Endpoint URL:', url)

async function testConnection() {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TradeMind-Quant-Secret': secret
      },
      body: JSON.stringify({ symbol: 'AAPL' })
    })

    console.log('HTTP Status:', res.status)
    if (!res.ok) {
      console.error('Request failed:', await res.text())
      process.exit(1)
    }

    const result = await res.json()
    console.log('API Result:', JSON.stringify(result, null, 2))
    
    const data = result.workflow_result
    assert.ok(data, 'workflow_result should be defined')
    assert.ok(data.action, 'Action should be defined')
    assert.ok(data.label, 'Label should be defined')
    assert.ok(data.xai_explanation, 'Explanation should be defined')
    console.log('\n✔ direct TryCloudflare test passed successfully!')
  } catch (error) {
    console.error('Exception during test:', error)
    process.exit(1)
  }
}

testConnection()
