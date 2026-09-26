import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { inspectBundle } from './test-bundle-size.mjs'
import { findExternalImports, hasMinimumTouchHeight, infraccionesEgress, inspectResponsiveJsx, rutaPosix } from './qa-responsive-rules.mjs'

async function buildFixture(t, configure = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'construacero-qa-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fixture = {
    html: '<script type="module" src="/assets/index-entry.js"></script>',
    manifest: {
      'index.html': { file: 'assets/index-entry.js', isEntry: true, imports: [], css: ['assets/style.css'] },
    },
    graph: {
      version: 1,
      chunks: {
        'assets/index-entry.js': { imports: [], dynamicImports: [], modules: ['src/main.jsx'] },
      },
    },
    assets: { 'assets/index-entry.js': 'export const ready = true;', 'assets/style.css': 'body{margin:0}' },
  }
  configure(fixture)
  await mkdir(join(directory, '.vite'))
  await mkdir(join(directory, 'assets'))
  await Promise.all([
    writeFile(join(directory, 'index.html'), fixture.html),
    writeFile(join(directory, '.vite', 'manifest.json'), JSON.stringify(fixture.manifest)),
    writeFile(join(directory, '.vite', 'bundle-graph.json'), JSON.stringify(fixture.graph)),
    ...Object.entries(fixture.assets).map(([path, content]) => writeFile(join(directory, path), content)),
  ])
  return { directory, fixture }
}

function addChunk(fixture, key, file, modules = ['src/shared.js']) {
  fixture.manifest[key] = { file, imports: [] }
  fixture.graph.chunks[file] = { imports: [], dynamicImports: [], modules }
  fixture.assets[file] = `export const name = ${JSON.stringify(key)};`
}

test('bundle counts the entry, preloads, static transitive imports, and styles once', async t => {
  const { directory, fixture } = await buildFixture(t, f => {
    addChunk(f, '_vendor.js', 'assets/vendor-a.js')
    addChunk(f, '_shared.js', 'assets/shared-a.js')
    f.html += '<link rel="modulepreload" href="/assets/vendor-a.js"><link rel="stylesheet" href="/assets/style.css">'
    f.manifest['index.html'].imports = ['_vendor.js']
    f.manifest['_vendor.js'].imports = ['_shared.js']
    f.graph.chunks['assets/index-entry.js'].imports = ['assets/vendor-a.js']
    f.graph.chunks['assets/vendor-a.js'].imports = ['assets/shared-a.js']
    f.graph.chunks['assets/shared-a.js'].imports = ['assets/vendor-a.js']
  })
  const report = await inspectBundle(directory)
  assert.equal(report.passed, true)
  assert.deepEqual(report.javascript.map(item => item.file), ['assets/index-entry.js', 'assets/shared-a.js', 'assets/vendor-a.js'])
  assert.equal(report.css.length, 1)
  assert.equal(report.initialTotal.bytes, Object.values(fixture.assets).reduce((sum, content) => sum + Buffer.byteLength(content), 0))
  assert.equal(report.initialTotal.gzipBytes, Object.values(fixture.assets).reduce((sum, content) => sum + gzipSync(content).byteLength, 0))
  assert.equal((await inspectBundle(join(directory, 'assets'))).initialTotal.bytes, report.initialTotal.bytes)
})

test('bundle detects transitive PDF even without an HTML preload or a PDF chunk name', async t => {
  const { directory } = await buildFixture(t, f => {
    addChunk(f, '_shared.js', 'assets/shared-a.js')
    addChunk(f, '_hidden.js', 'assets/helper-a.js', ['node_modules/jspdf/dist/jspdf.es.min.js'])
    f.manifest['index.html'].imports = ['_shared.js']
    f.manifest['_shared.js'].imports = ['_hidden.js']
  })
  const report = await inspectBundle(directory)
  assert.equal(report.passed, false)
  assert.match(report.violations.join('\n'), /helper-a\.js.*jspdf/)
})

test('bundle detects chunk-graph static html2canvas imports not listed in manifest imports', async t => {
  const { directory } = await buildFixture(t, f => {
    addChunk(f, '_hidden.js', 'assets/shared-a.js', ['node_modules/html2canvas/dist/html2canvas.esm.js'])
    f.graph.chunks['assets/index-entry.js'].imports = ['assets/shared-a.js']
  })
  const report = await inspectBundle(directory)
  assert.equal(report.passed, false)
  assert.match(report.violations.join('\n'), /html2canvas/)
})

test('bundle treats explicit preload-only PDF as initial', async t => {
  const { directory } = await buildFixture(t, f => {
    addChunk(f, '_pdf.js', 'assets/pdf-a.js')
    f.html += "<link href='/assets/pdf-a.js' rel='modulepreload'>"
  })
  const report = await inspectBundle(directory)
  assert.equal(report.passed, false)
  assert.match(report.violations.join('\n'), /pdf-a\.js/)
})

test('bundle keeps PDF and html2canvas allowed behind dynamic imports', async t => {
  const { directory } = await buildFixture(t, f => {
    addChunk(f, '_pdf.js', 'assets/pdf-a.js', ['node_modules/jspdf/dist/jspdf.es.min.js', 'node_modules/html2canvas/dist/html2canvas.esm.js'])
    f.manifest['index.html'].dynamicImports = ['_pdf.js']
    f.graph.chunks['assets/index-entry.js'].dynamicImports = ['assets/pdf-a.js']
    f.html += '<!-- <link rel="modulepreload" href="/assets/pdf-a.js"> -->'
  })
  const report = await inspectBundle(directory)
  assert.equal(report.passed, true)
  assert.deepEqual(report.javascript.map(item => item.file), ['assets/index-entry.js'])
})

test('bundle enforces the approved 400 KiB index boundary exactly', async t => {
  const { directory } = await buildFixture(t, f => { f.assets['assets/index-entry.js'] = 'x'.repeat(400 * 1024) })
  assert.equal((await inspectBundle(directory)).passed, true)
  await writeFile(join(directory, 'assets/index-entry.js'), 'x'.repeat(400 * 1024 + 1))
  const report = await inspectBundle(directory)
  assert.equal(report.passed, false)
  assert.match(report.violations.join('\n'), /400 KiB index budget/)
})

test('bundle reports but does not enforce the proposed 250 KiB aggregate gzip target', async t => {
  const { directory } = await buildFixture(t, f => {
    addChunk(f, '_vendor.js', 'assets/vendor-a.js')
    f.manifest['index.html'].imports = ['_vendor.js']
    const bytes = Buffer.alloc(1024 * 1024)
    let state = 0x12345678
    for (let i = 0; i < bytes.length; i++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      bytes[i] = state & 255
    }
    f.assets['assets/vendor-a.js'] = bytes
  })
  const report = await inspectBundle(directory)
  assert.ok(report.initialTotal.gzipBytes > 250 * 1024)
  assert.equal(report.proposedGzipTargetEnforced, false)
  assert.equal(report.passed, true)
})

test('bundle rejects missing metadata instead of accepting an old assets-only build', async t => {
  const { directory } = await buildFixture(t)
  await rm(join(directory, '.vite', 'bundle-graph.json'))
  await assert.rejects(inspectBundle(directory), /run npm run build first/)
})

test('bundle rejects unresolved initial dependencies and invalid budgets', async t => {
  const { directory } = await buildFixture(t, f => { f.manifest['index.html'].imports = ['missing'] })
  await assert.rejects(inspectBundle(directory), /Missing manifest dependency/)
  for (const limit of [0, -1, NaN, Infinity]) await assert.rejects(inspectBundle(directory, limit), /positive number/)
})

test('bundle rejects path traversal in HTML preloads', async t => {
  const { directory } = await buildFixture(t, f => { f.html += '<link rel="modulepreload" href="/%2e%2e/private.js">' })
  await assert.rejects(inspectBundle(directory), /Unsafe build asset/)
})

test('responsive guard catches global, qualified, computed, and optional native dialogs', () => {
  const report = inspectResponsiveJsx('confirm("x");\nwindow.alert("x");\nglobalThis["prompt"]("x");\nself.confirm?.("x");')
  assert.deepEqual(report.nativeDialogs, [1, 2, 3, 4])
})

test('responsive guard ignores comments, examples in strings, and locally bound dialog names', () => {
  const report = inspectResponsiveJsx(`
    // window.confirm('comment')
    /* alert('comment') */
    const example = "window.prompt('example')";
    function custom(confirm, window) { confirm(); window.alert(); }
    const service = { prompt() {} }; service.prompt();
  `)
  assert.deepEqual(report.nativeDialogs, [])
})

test('responsive guard reads multiline className without inspecting child icon sizes', () => {
  assert.deepEqual(inspectResponsiveJsx('<button\n type="button"\n aria-label="Action"\n className="h-9" />').undersizedControls, [1])
  assert.deepEqual(inspectResponsiveJsx('<button className="h-11"><svg className="h-9" /></button>').undersizedControls, [])
  assert.deepEqual(inspectResponsiveJsx('<input className={active ? "h-10" : "h-11"} />').undersizedControls, [1])
})

test('responsive guard accepts real minimum touch height but not breakpoint-only fixes', () => {
  assert.deepEqual(inspectResponsiveJsx('<button className="h-9 min-h-11" />').undersizedControls, [])
  assert.deepEqual(inspectResponsiveJsx('<button className="h-9 sm:min-h-11" />').undersizedControls, [1])
  assert.deepEqual(inspectResponsiveJsx('<button className="h-11 sm:h-10" />').undersizedControls, [1])
  assert.equal(hasMinimumTouchHeight({ classes: ['min-h-[44px]'] }), true)
  assert.equal(hasMinimumTouchHeight({ classes: ['h-[2.75rem]'] }), true)
  assert.equal(hasMinimumTouchHeight({ classes: ['p-2', 'rounded-xl'] }), false)
  assert.equal(hasMinimumTouchHeight({ classes: ['sm:min-h-11'] }), false)
})

test('checkbox hit area may be provided by its own large label, not a sibling', () => {
  assert.deepEqual(inspectResponsiveJsx('<input type="checkbox" className="h-4 w-4" />').undersizedControls, [1])
  assert.deepEqual(inspectResponsiveJsx('<label className="min-h-11"><span><input type="checkbox" className="h-4 w-4" /></span>Choice</label>').undersizedControls, [])
  assert.deepEqual(inspectResponsiveJsx('<><label className="min-h-11">Unrelated</label><input type="checkbox" className="h-4 w-4" /></>').undersizedControls, [1])
  assert.deepEqual(inspectResponsiveJsx('<label className="sm:min-h-11"><input type="checkbox" className="h-4 w-4" /></label>').undersizedControls, [1])
  assert.deepEqual(inspectResponsiveJsx('<label className="min-h-11"><input type="text" className="h-4" /></label>').undersizedControls, [1])
})

test('responsive guard requires local fixed-width containment, not an unrelated sibling', () => {
  assert.deepEqual(inspectResponsiveJsx('<><div className="max-w-full" /><div className="w-[800px]" /></>').fixedWidths, [1])
  assert.deepEqual(inspectResponsiveJsx('<div className="overflow-x-auto"><table className="w-[800px]" /></div>').fixedWidths, [])
  assert.deepEqual(inspectResponsiveJsx('<HorizontalScroll><table className="w-[800px]" /></HorizontalScroll>').fixedWidths, [])
  assert.deepEqual(inspectResponsiveJsx('<div className="md:w-[800px]" />').fixedWidths, [])
})

test('responsive guard catches UI glyphs but ignores commented examples', () => {
  const glyph = '\u2728'
  assert.deepEqual(inspectResponsiveJsx(`<button>${glyph}</button>`).glyphs, [1])
  assert.deepEqual(inspectResponsiveJsx(`/* ${glyph} */\n<button>Action</button>`).glyphs, [])
})

test('responsive guard rejects invalid JSX rather than silently passing a source file', () => {
  assert.throws(() => inspectResponsiveJsx('<button className="h-9">'), /Unexpected|Unterminated/)
})

test('egress guard fires for Windows and POSIX server paths and never for client code', () => {
  // F-2: walk() compone las rutas con path.join, que en Windows usa `\`. Las reglas
  // que comparaban contra `server/...` no disparaban en local y sí rompían el build
  // en CI: el comparador normalizado es el mismo que usa check-project.
  assert.equal(rutaPosix('server\\lib\\nominaHorarios.js'), 'server/lib/nominaHorarios.js')
  for (const ruta of ['server\\lib\\nominaHorarios.js', 'server/lib/nominaHorarios.js']) {
    assert.equal(infraccionesEgress(ruta, 'const url = `${base}&limit=1000`').length, 1)
    assert.deepEqual(infraccionesEgress(ruta, 'const url = `${base}&limit=500`'), [])
  }
  assert.deepEqual(infraccionesEgress('src\\lib\\nominaHorarios.js', 'limit=1000'), [])
  assert.deepEqual(infraccionesEgress('scripts\\test-x.mjs', 'limit=1000'), [])
  // select=* solo se prohíbe en el handler de nómina, con ruta nativa o normalizada.
  assert.equal(infraccionesEgress('server\\handlers\\nomina.js', 'select=*').length, 1)
  assert.equal(infraccionesEgress('server/handlers/nomina.js', 'select=*').length, 1)
  assert.deepEqual(infraccionesEgress('server\\handlers\\nomina.empleados.js', 'select=*'), [])
})

test('import guard accepts internal Supabase and cross-folder imports', () => {
  const root = join(tmpdir(), 'qa-repository')
  assert.deepEqual(findExternalImports("import('../supabase/client.js');", 'compat/services/__tests__/auth.test.jsx', root), [])
  assert.deepEqual(findExternalImports("export * from '../../server/lib/helper.js'", 'src/utils/helper.js', root), [])
})

test('import guard rejects parent traversal while ignoring comments and sample strings', () => {
  const root = join(tmpdir(), 'qa-repository')
  const source = `// import('../../../../src/outside.js')
    const example = "import('../../../../src/outside.js')";
    import x from '../../../../src/outside.js';
    export * from '../../../../api/outside.js';
    import('../../../../supabase/outside.js');`
  assert.deepEqual(findExternalImports(source, 'compat/services/__tests__/auth.test.jsx', root),
    ['../../../../src/outside.js', '../../../../api/outside.js', '../../../../supabase/outside.js'])
})

test('each inline Vitest project explicitly uses isolated threads rather than default forks', async () => {
  const { default: config } = await import('../vitest.config.js')
  assert.equal(config.test.maxWorkers, 1)
  assert.deepEqual(config.test.projects.map(project => project.test.name).sort(), ['client', 'server'])
  for (const project of config.test.projects) {
    assert.equal(project.test.pool, 'threads', `${project.test.name} must not fall back to forks`)
    assert.equal(project.test.isolate, true)
  }
})

test('verify checks a fresh build once and CI runs the full verification contract', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const steps = packageJson.scripts.verify.split(' && ')
  assert.equal(steps.filter(step => step === 'npm run test:bundle-size').length, 1)
  assert.ok(steps.indexOf('npm run build') >= 0)
  assert.ok(steps.indexOf('npm run build') < steps.indexOf('npm run test:bundle-size'))
  for (const command of ['npm run check:project', 'npm run test:qa', 'npm run test:responsive', 'npm run lint', 'npm run test:deterministic', 'npm test']) {
    assert.ok(steps.includes(command), `Missing verify step: ${command}`)
  }
  assert.equal(packageJson.scripts['test:qa'], 'node --test scripts/qa-guards.test.mjs')
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  assert.match(ci, /run: npm run verify(?:\r?\n|$)/)
  assert.match(ci, /node-version: 22\.22\.2(?:\r?\n|$)/)
})
