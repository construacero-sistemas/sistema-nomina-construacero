// scripts/test-bundle-size.mjs
// Deterministic bundle-size guard: fails if the initial index chunk exceeds budget.
// Usage: node scripts/test-bundle-size.mjs [build-output-dir] [--limit-kb 400]
// Intended to run after `vite build`; parses dist/assets for index-*.js sizes.

import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distDir = process.argv[2] ? resolve(process.argv[2]) : join(root, 'dist', 'assets')

const limitArg = process.argv.indexOf('--limit-kb')
const LIMIT_KB = limitArg !== -1 ? Number(process.argv[limitArg + 1]) || 400 : 400

function fail(message) {
  console.error(`[test-bundle-size] FAIL: ${message}`)
  process.exit(1)
}

let entries
try {
  entries = await readdir(distDir)
} catch {
  fail(`build output not found at ${distDir} — run "npm run build" first`)
}

const indexChunks = entries.filter(name => /^index-.*\.js$/.test(name))
if (indexChunks.length === 0) fail(`no index-*.js chunk found in ${distDir}`)

let worst = 0
for (const name of indexChunks) {
  const { size } = await stat(join(distDir, name))
  const kb = size / 1024
  worst = Math.max(worst, kb)
  const status = kb > LIMIT_KB ? 'FAIL' : 'PASS'
  console.log(`  [${status}] ${name}: ${kb.toFixed(1)} kB (limit ${LIMIT_KB} kB)`)
  if (kb > LIMIT_KB) {
    fail(`index chunk ${name} is ${kb.toFixed(1)} kB, over the ${LIMIT_KB} kB budget — check for accidental static imports of heavy views/services`)
  }
}

console.log(`[test-bundle-size] PASS: largest index chunk ${worst.toFixed(1)} kB within ${LIMIT_KB} kB budget`)
