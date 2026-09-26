import fs from 'node:fs'

const EXPECTED_REF = 'wishglzpmcshyvlgpjxj'
const EXPECTED_URL = `https://${EXPECTED_REF}.supabase.co`

function readEnv(path) {
  if (!fs.existsSync(path)) return null
  const values = {}
  for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index < 0) continue
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return values
}

const frontend = readEnv('.env.staging.local')
const worker = readEnv('.dev.vars.staging')
const production = readEnv('.env')
const errors = []

if (!frontend) errors.push('Falta .env.staging.local.')
if (!worker) errors.push('Falta .dev.vars.staging.')
if (frontend) {
  if (frontend.VITE_SUPABASE_URL !== EXPECTED_URL) errors.push('La URL del frontend no es el staging esperado.')
  if (!frontend.VITE_SUPABASE_ANON_KEY?.startsWith('sb_publishable_')) errors.push('La clave pública del frontend no es publishable staging.')
  if (!frontend.STAGING_TEST_EMAIL || !frontend.STAGING_TEST_PASSWORD || !/^\d{6}$/.test(frontend.STAGING_TEST_PIN || '')) {
    errors.push('Faltan las credenciales sintéticas del login y operador de prueba.')
  }
}
if (worker) {
  if (worker.SUPABASE_URL !== EXPECTED_URL) errors.push('La URL del Worker no es el staging esperado.')
  if (!worker.SUPABASE_ANON_KEY?.startsWith('sb_publishable_')) errors.push('La clave pública del Worker no es publishable staging.')
  if (!worker.SUPABASE_SERVICE_KEY?.startsWith('sb_secret_')) errors.push('La clave privada del Worker no es secret staging.')
  if (worker.ENABLE_DEV_MASTER_PIN === 'true') errors.push('No habilites PIN maestro en este staging persistente.')
}
if (production && (production.VITE_SUPABASE_URL || '').includes(EXPECTED_REF)) {
  errors.push('El .env principal fue cambiado para apuntar a staging; se detiene para prevenir errores de destino.')
}
if (production && (production.SUPABASE_URL || '').includes(EXPECTED_REF)) {
  errors.push('El SUPABASE_URL principal fue cambiado para apuntar a staging; se detiene para prevenir errores de destino.')
}

if (errors.length) {
  console.error('Configuración staging: FALLÓ')
  errors.forEach(error => console.error(`- ${error}`))
  process.exitCode = 1
} else {
  console.log('Configuración staging: OK (front y Worker usan credenciales nuevas aisladas; no se imprimen secretos).')
}
