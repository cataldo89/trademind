const fs = require('fs')
const p = 'src/components/portfolio/portfolio-client.tsx'
let lines = fs.readFileSync(p, 'utf8').split('\r\n')
const line125 = lines[124]
const idx = line125.indexOf('false })')
if (idx > -1) {
  const afterIdx = idx + 7
  console.log('After false }):', JSON.stringify(line125.substring(afterIdx, afterIdx + 30)))
  // Replace the malformed closing
  const oldStr = ',\n  })  '
  const newStr = ',\n    },\n  })\n\n  '
  if (line125.indexOf(oldStr) > -1) {
    lines[124] = line125.replace(oldStr, newStr)
    fs.writeFileSync(p, lines.join('\r\n'))
    console.log('Fixed')
  } else {
    console.log('Pattern not found')
  }
}