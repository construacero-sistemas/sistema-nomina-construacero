import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// Windows may expose cwd as c:\ while ESM realpath uses C:\. Resolve both CLI
// and config from one canonical root to avoid two @vitest/runner singletons.
const root = realpathSync.native(join(dirname(fileURLToPath(import.meta.url)), '..'))
const require = createRequire(join(root, 'package.json'))
const cli = realpathSync.native(join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'))
const child = spawn(process.execPath, [cli, 'run', '--root', root, '--config', join(root, 'vitest.config.js'), ...process.argv.slice(2)], {
  cwd: root, env: process.env, stdio: 'inherit', windowsHide: true,
})
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
