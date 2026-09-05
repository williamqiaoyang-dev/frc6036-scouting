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

// This branch holds compiled output only — no package.json, no source. If a
// host (Vercel, Netlify) is pointed at it, it must serve these files as-is
// rather than try to build them; otherwise it looks for `vite` and finds
// nothing. Prefer pointing such a host at `main`, where the real build lives.
writeFileSync(
  join(staging, 'vercel.json'),
  JSON.stringify({
    framework: null,
    buildCommand: "echo 'Pre-built output. Nothing to build on this branch.'",
    installCommand: "echo 'No dependencies on this branch.'",
    outputDirectory: '.',
  }, null, 2) + '\n',
)

const run = (cmd) => execSync(cmd, { cwd: staging, stdio: 'inherit' })
run('git init -q')
run('git checkout -q -b gh-pages')
run('git add -A')
run('git -c user.email=deploy@local -c user.name=deploy commit -q -m "Deploy"')
run(`git remote add origin ${REMOTE}`)
run('git push -q -f origin gh-pages')

console.log('\nDeployed → https://williamqiaoyang-dev.github.io/frc6036-scouting/')
console.log('GitHub Pages takes ~30s to serve the new version.')
