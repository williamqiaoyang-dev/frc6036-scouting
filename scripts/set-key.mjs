/**
 * Write the TBA read key into public/config.json.
 *
 *   node scripts/set-key.mjs <your-tba-read-key>
 *   npm run deploy
 *
 * Kept as a separate step because the key is a credential: it belongs in a
 * command you run, not in a file an assistant edits for you.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const key = process.argv[2]?.trim()
if (!key) {
  console.error('Usage: node scripts/set-key.mjs <tba-read-key>')
  console.error('Get one at https://www.thebluealliance.com/account')
  process.exit(1)
}
if (key.length < 40) {
  console.error(`That does not look like a TBA read key (got ${key.length} characters, expected ~64).`)
  process.exit(1)
}

const path = 'public/config.json'
const raw = readFileSync(path, 'utf8')
const updated = raw.replace(/("tbaApiKey":\s*)"[^"]*"/, `$1"${key}"`)

if (updated === raw) {
  console.error('Could not find "tbaApiKey" in public/config.json.')
  process.exit(1)
}

JSON.parse(updated.replace(/"\$comment":\s*\[[\s\S]*?\],/, ''))  // sanity check
writeFileSync(path, updated)

console.log(`Key written to ${path} (${key.length} chars).`)
console.log('\nThis file is served publicly. It is a read-only TBA key —')
console.log('regenerate it any time at https://www.thebluealliance.com/account')
console.log('\nNext:  npm run deploy')
