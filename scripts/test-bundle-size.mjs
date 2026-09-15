// Usage: node scripts/test-bundle-size.mjs [build-directory] [--limit-kb 400] [--json]
// Requires the manifest and module graph emitted by the production Vite build.
import { readFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('..', import.meta.url))
const HEAVY_MODULE = /(?:^|\/)node_modules\/(?:jspdf|html2canvas)(?:\/|$)|(?:^|\/)services\/pdf\/.*\.impl\.[cm]?js$/i
const HEAVY_CHUNK = /(?:^|\/)(?:pdf|jspdf|html2canvas)[.-]/i

function localAsset(value) {
  if (!value || /^(?:[a-z]+:)?\/\//i.test(value) || /^[a-z]+:/i.test(value)) {
    throw new Error(`Expected a local build asset, received ${value}`)
  }
  const path = decodeURIComponent(value.split(/[?#]/, 1)[0]).replace(/^\.?\//, '')
  if (path.split('/').includes('..') || path.includes('\\')) throw new Error(`Unsafe build asset: ${value}`)
  return path
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
    .map(([, name, double, single, bare]) => [name.toLowerCase(), double ?? single ?? bare]))
}

export async function inspectBundle(directory = join(root, 'dist'), limitKiB = 400) {
  if (!Number.isFinite(limitKiB) || limitKiB <= 0) throw new Error('The index limit must be a positive number of KiB')
  const buildDir = resolve(basename(directory) === 'assets' ? join(directory, '..') : directory)
  let html, manifest, graph
  try {
    ;[html, manifest, graph] = await Promise.all([
      readFile(join(buildDir, 'index.html'), 'utf8'),
      readFile(join(buildDir, '.vite', 'manifest.json'), 'utf8').then(JSON.parse),
      readFile(join(buildDir, '.vite', 'bundle-graph.json'), 'utf8').then(JSON.parse),
    ])
  } catch (error) {
    throw new Error(`Missing or invalid build output at ${buildDir}; run npm run build first. ${error.message}`)
  }
  if (graph.version !== 1 || !graph.chunks) throw new Error('Unsupported or incomplete bundle graph')
  const manifestByFile = new Map(Object.values(manifest).filter(item => item.file).map(item => [item.file, item]))
  const initial = new Set()
  const styles = new Set()
  for (const [tag] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const attrs = attributes(tag)
    if (attrs.type === 'module' && attrs.src) initial.add(localAsset(attrs.src))
    if (attrs.rel?.split(/\s+/).includes('modulepreload')) initial.add(localAsset(attrs.href))
    if (attrs.rel?.split(/\s+/).includes('stylesheet')) styles.add(localAsset(attrs.href))
  }
  for (const item of Object.values(manifest)) {
    if (item.isEntry) initial.add(localAsset(item.file))
  }
  if (!initial.size) throw new Error('No initial JavaScript entry or modulepreload found')

  // Both graphs matter: HTML preloads are eager even without an import, while a
  // transitive static import stays eager even if its preload link is removed.
  for (const file of initial) {
    const chunk = graph.chunks[file]
    const item = manifestByFile.get(file)
    if (!chunk || !item || !Array.isArray(chunk.imports) || !Array.isArray(chunk.modules)) {
      throw new Error(`Missing chunk metadata for initial asset ${file}`)
    }
    for (const dependency of chunk.imports) initial.add(localAsset(dependency))
    for (const key of item.imports ?? []) {
      if (!manifest[key]?.file) throw new Error(`Missing manifest dependency ${key} from ${file}`)
      initial.add(localAsset(manifest[key].file))
    }
    for (const css of item.css ?? []) styles.add(localAsset(css))
    // Do not traverse dynamicImports: those remain demand-loaded.
  }

  async function measure(file) {
    const path = resolve(buildDir, file)
    if (!path.startsWith(`${buildDir}${sep}`)) throw new Error(`Asset escapes build directory: ${file}`)
    const content = await readFile(path)
    return { file, bytes: content.byteLength, gzipBytes: gzipSync(content).byteLength }
  }
  const javascript = await Promise.all([...initial].sort().map(measure))
  const css = await Promise.all([...styles].sort().map(measure))
  const indexFiles = [...manifestByFile.keys()].filter(file => /^index-.*\.js$/.test(basename(file)))
  if (!indexFiles.length) throw new Error('No index-*.js chunk found in the build manifest')
  const index = await Promise.all(indexFiles.sort().map(measure))
  const violations = index.filter(item => item.bytes > limitKiB * 1024)
    .map(item => `${item.file} exceeds the ${limitKiB} KiB index budget (${(item.bytes / 1024).toFixed(1)} KiB)`)
  for (const file of initial) {
    const heavy = graph.chunks[file].modules.filter(id => HEAVY_MODULE.test(id.replace(/\\/g, '/')))
    if (heavy.length || HEAVY_CHUNK.test(file)) {
      violations.push(`PDF/html2canvas must be demand-loaded, but ${file} is initial${heavy.length ? `: ${heavy.join(', ')}` : ''}`)
    }
  }
  const totals = items => items.reduce((sum, item) => ({ bytes: sum.bytes + item.bytes, gzipBytes: sum.gzipBytes + item.gzipBytes }), { bytes: 0, gzipBytes: 0 })
  return {
    buildDir, indexLimitKiB: limitKiB, index, javascript, css,
    initialJavaScript: totals(javascript), initialStyles: totals(css), initialTotal: totals([...javascript, ...css]),
    proposedGzipTargetKiB: 250, proposedGzipTargetEnforced: false,
    violations, passed: violations.length === 0,
  }
}

async function main() {
  const args = process.argv.slice(2)
  let directory, limit = 400, json = false
  while (args.length) {
    const arg = args.shift()
    if (arg === '--limit-kb') limit = Number(args.shift())
    else if (arg === '--json') json = true
    else if (arg.startsWith('-') || directory) throw new Error(`Unknown argument: ${arg}`)
    else directory = arg
  }
  const report = await inspectBundle(directory, limit)
  if (json) console.log(JSON.stringify(report, null, 2))
  else {
    for (const item of report.javascript) console.log(`  JS ${item.file}: ${(item.bytes / 1024).toFixed(1)} KiB raw / ${(item.gzipBytes / 1024).toFixed(1)} KiB gzip`)
    for (const item of report.index) console.log(`  Index budget: ${(item.bytes / 1024).toFixed(1)} / ${limit} KiB (${item.file})`)
    console.log(`[test-bundle-size] Initial JS: ${(report.initialJavaScript.bytes / 1024).toFixed(1)} KiB raw / ${(report.initialJavaScript.gzipBytes / 1024).toFixed(1)} KiB gzip`)
    console.log(`[test-bundle-size] Initial JS + CSS: ${(report.initialTotal.bytes / 1024).toFixed(1)} KiB raw / ${(report.initialTotal.gzipBytes / 1024).toFixed(1)} KiB gzip`)
    console.log('[test-bundle-size] Proposed 250 KiB gzip target: reporting only; not an approved gate. Gzip totals sum separately compressed assets.')
    for (const violation of report.violations) console.error(`[test-bundle-size] FAIL: ${violation}`)
    console.log(`[test-bundle-size] ${report.passed ? 'PASS' : 'FAIL'}: index budget and no initial PDF/html2canvas`)
  }
  if (!report.passed) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[test-bundle-size] FAIL: ${error.message}`)
    process.exitCode = 1
  })
}
