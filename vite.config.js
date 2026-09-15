import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

function getVersion() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return 'local'
  }
}

export default defineConfig({
  root,
  plugins: [
    react(),
    {
      name: 'versioned-offline-shell',
      apply: 'build',
      generateBundle(_options, bundle) {
        const assets = new Set()
        const visit = name => {
          if (assets.has(name) || !bundle[name]) return
          assets.add(name)
          const item = bundle[name]
          if (item.type === 'chunk') {
            item.imports.forEach(visit)
            item.viteMetadata?.importedCss?.forEach(css => assets.add(css))
          }
        }
        Object.values(bundle).filter(item => item.type === 'chunk' && item.isEntry).forEach(item => visit(item.fileName))
        const template = readFileSync(resolve(root, 'public/sw.js'), 'utf8')
        const hash = createHash('sha256').update(template)
        Object.values(bundle).sort((a, b) => a.fileName.localeCompare(b.fileName)).forEach(item => hash.update(item.type === 'chunk' ? item.code : String(item.source)))
        const version = hash.digest('hex').slice(0, 16)
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: template.replace('__BUILD_ID__', version)
          .replace(' /* BUILD_ASSETS */', [...assets].sort().map(name => `, ${JSON.stringify('/' + name)}`).join('')) })
      },
    },
    {
      name: 'quality-bundle-graph',
      apply: 'build',
      generateBundle(_options, bundle) {
        const chunks = Object.fromEntries(Object.values(bundle)
          .filter(item => item.type === 'chunk')
          .map(chunk => [chunk.fileName, {
            imports: chunk.imports,
            dynamicImports: chunk.dynamicImports,
            modules: Object.keys(chunk.modules).map(id =>
              relative(root, id.replace(/^\0/, '')).replace(/\\/g, '/')),
          }]))
        this.emitFile({
          type: 'asset',
          fileName: '.vite/bundle-graph.json',
          source: JSON.stringify({ version: 1, chunks }, null, 2),
        })
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(getVersion()),
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router-dom'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      output: {
        // Object-form chunks absorb dependencies, including Vite's shared preload
        // helper. When PDF owns that helper, the entry must eagerly import PDF.
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          const moduleId = id.replace(/\\/g, '/')
          if (moduleId.includes('vite/preload-helper') || moduleId.includes('commonjsHelpers')) return 'runtime'
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(moduleId)) return 'vendor'
          if (moduleId.includes('/node_modules/lucide-react/')) return 'icons'
          if (moduleId.includes('/node_modules/jspdf/')) return 'pdf'
          if (moduleId.includes('/node_modules/@supabase/')) return 'cloud'
          if (moduleId.includes('/node_modules/@tanstack/')) return 'query'
        },
      },
    },
  },
})
