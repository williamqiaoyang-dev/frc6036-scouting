/**
 * Publish dist/ to the gh-pages branch.
 *
 * Run `npm run deploy` after editing public/config.json or any source.
 * The site is served from that branch at:
 *   https://williamqiaoyang-dev.github.io/frc6036-scouting/
 */
import { execSync } from 'node:child_process'
import { cpSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REMOTE = 'https://github.com/williamqiaoyang-dev/frc6036-scouting.git'

if (!existsSync('dist')) {
  console.error('No dist/ — run `npm run build` first.')
  process.exit(1)
}

const staging = mkdtempSync(join(tmpdir(), 'ghp-'))
cpSync('dist', staging, { recursive: true })
writeFileSync(join(staging, '.nojekyll'), '')

const run = (cmd) => execSync(cmd, { cwd: staging, stdio: 'inherit' })
run('git init -q')
run('git checkout -q -b gh-pages')
run('git add -A')
run('git -c user.email=deploy@local -c user.name=deploy commit -q -m "Deploy"')
run(`git remote add origin ${REMOTE}`)
run('git push -q -f origin gh-pages')

console.log('\nDeployed → https://williamqiaoyang-dev.github.io/frc6036-scouting/')
console.log('GitHub Pages takes ~30s to serve the new version.')
