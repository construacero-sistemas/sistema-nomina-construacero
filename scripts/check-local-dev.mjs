import { existsSync, readFileSync } from 'node:fs'

function readEnvFile(path) {
  if (!existsSync(path)) return null
  const values = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    values[key] = value
  }
  return values
}

const frontend = readEnvFile('.env')
const devVars = readEnvFile('.dev.vars')
// Wrangler también carga variables desde .env en desarrollo. .dev.vars tiene
// prioridad cuando existe; así se puede trabajar sin duplicar una clave local.
const worker = { ...(frontend || {}), ...(devVars || {}) }
const errors = []

if (!frontend) errors.push('Falta .env para la interfaz.')
if (frontend && !frontend.VITE_SUPABASE_URL) errors.push('Falta VITE_SUPABASE_URL en .env.')
if (frontend && !frontend.VITE_SUPABASE_ANON_KEY) errors.push('Falta VITE_SUPABASE_ANON_KEY en .env.')
if (!worker.SUPABASE_URL && !frontend?.VITE_SUPABASE_URL) errors.push('Falta SUPABASE_URL o VITE_SUPABASE_URL.')
if (!worker.SUPABASE_SERVICE_KEY) errors.push('Falta SUPABASE_SERVICE_KEY. Ponla en .dev.vars o en .env sin prefijo VITE_.')

const frontendUrl = frontend?.VITE_SUPABASE_URL
const workerUrl = worker.SUPABASE_URL || frontendUrl
if (frontendUrl && workerUrl && frontendUrl !== workerUrl) {
  errors.push('La URL de Supabase de .env y la del Worker no pertenece al mismo proyecto.')
}

for (const [name, value] of Object.entries({
  VITE_SUPABASE_ANON_KEY: frontend?.VITE_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_KEY: worker.SUPABASE_SERVICE_KEY,
})) {
  if (value && /^(tu-|your-|replace-|changeme)/i.test(value)) {
    errors.push(`${name} todavía usa el valor de ejemplo.`)
  }
}

const allowedOrigins = String(worker.NOMINA_ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:4173')
if (!allowedOrigins.split(',').map(value => value.trim()).includes('http://localhost:5173')) {
  errors.push('Agrega http://localhost:5173 a NOMINA_ALLOWED_ORIGINS.')
}

if (errors.length > 0) {
  console.error('Configuración local: FALLÓ')
  for (const error of errors) console.error(`- ${error}`)
  console.error('')
  console.error('Completa las claves del mismo proyecto en .dev.vars o .env y vuelve a ejecutar npm run dev.')
  process.exitCode = 1
} else {
  const fuenteWorker = devVars ? '.dev.vars' : '.env'
  console.log(`Configuración local: OK (Worker desde ${fuenteWorker}; claves presentes; no se muestran secretos)`)
}
