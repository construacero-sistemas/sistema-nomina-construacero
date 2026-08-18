import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const failures = []

function fail(message) {
  failures.push(message)
}

async function exists(path) {
  try {
    await stat(join(root, path))
    return true
  } catch {
    return false
  }
}

async function read(path) {
  return readFile(join(root, path), 'utf8')
}

async function walk(directory, output = []) {
  const absolute = join(root, directory)
  let entries
  try {
    entries = await readdir(absolute, { withFileTypes: true })
  } catch {
    return output
  }

  for (const entry of entries) {
    const relativePath = join(directory, entry.name)
    if (['node_modules', 'dist', 'coverage', '.git', '.freebuff', '.wrangler'].includes(entry.name)) continue
    if (entry.isDirectory()) await walk(relativePath, output)
    else output.push(relativePath)
  }
  return output
}

const requiredFiles = [
  'package.json',
  'package-lock.json',
  'worker.js',
  'wrangler.toml',
  '.env.example',
  '.dev.vars.example',
  'supabase/config.toml',
  'supabase/migrations/001_nomina_base_contract.sql',
  'supabase/migrations/208_nomina_config_empleado.sql',
  'supabase/migrations/219_nomina_rollout_flag.sql',
  'supabase/migrations/220_nomina_integrity_guardrails.sql',
]
for (const path of requiredFiles) {
  if (!await exists(path)) fail(`Falta archivo requerido: ${path}`)
}

const envExample = await read('.env.example')
const devVarsExample = await read('.dev.vars.example')
const supabaseConfig = await read('supabase/config.toml')
if (!/^project_id\s*=\s*"wlxcclidnwketrghqaxs"\s*$/m.test(supabaseConfig)) {
  fail('supabase/config.toml no apunta al proyecto Supabase entregado')
}
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_WORKER_ORIGIN']) {
  if (!new RegExp(`^${key}=`, 'm').test(envExample)) fail(`.env.example no documenta ${key}`)
}
for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'NOMINA_TIMEZONE', 'NOMINA_ALLOWED_ORIGINS']) {
  if (!new RegExp(`^${key}=`, 'm').test(devVarsExample)) fail(`.dev.vars.example no documenta ${key}`)
}
if (/^SUPABASE_(?:URL|ANON_KEY|SERVICE_KEY)=/m.test(envExample)) fail('.env.example no debe contener variables privadas del Worker')
if (envExample.includes('[TEMPLATE]') || devVarsExample.includes('[TEMPLATE]')) fail('Las plantillas de entorno contienen marcadores corruptos')
if (/SUPABASE_SERVICE_KEY\s*=\s*(?!tu-service-role-key\s*$)[^#\s]+/m.test(envExample)) fail('.env.example contiene una service key real')
if (/SUPABASE_SERVICE_KEY\s*=\s*(?!tu-service-role-key\s*$)[^#\s]+/m.test(devVarsExample)) fail('.dev.vars.example contiene una service key real')

const migrationFiles = (await walk('supabase/migrations'))
  .filter(path => path.endsWith('.sql'))
  .map(path => path.split(/[\\/]/).pop())
  .sort((a, b) => a.localeCompare(b, 'en'))
const expectedMigrations = [
  '001_nomina_base_contract.sql',
  '208_nomina_config_empleado.sql',
  '209_nomina_asistencia.sql',
  '210_nomina_periodos.sql',
  '211_nomina_lineas.sql',
  '212_nomina_config_rls.sql',
  '213_nomina_rls_tenant.sql',
  '214_nomina_marcaje_operativo.sql',
  '215_nomina_calendario_laboral.sql',
  '216_nomina_conceptos.sql',
  '217_nomina_reglas_legal.sql',
  '218_nomina_tasas_snapshot.sql',
  '219_nomina_rollout_flag.sql',
  '220_nomina_integrity_guardrails.sql',
]
for (const migration of expectedMigrations) {
  if (!migrationFiles.includes(migration)) fail(`Falta migración de contrato: ${migration}`)
}

const sourceFiles = (await walk('.')).filter(path => /\.(?:js|jsx|mjs|json|toml|sql)$/.test(path))
for (const path of sourceFiles) {
  // Este archivo contiene las expresiones del propio escáner; no lo uses como
  // entrada para detectar los patrones que implementa.
  if (path.split(/[\\/]/)[0] === 'scripts') continue
  const text = await read(path)
  // El paquete puede importar sus propios módulos internos, pero nunca debe
  // alcanzar el POS por rutas relativas al directorio padre.
  if (/from\s+['"](?:\.\.\/)+(?:src|api|supabase)(?:\/|['"])/.test(text) ||
      /import\(\s*['"](?:\.\.\/)+(?:src|api|supabase)(?:\/|['"])/.test(text)) {
    fail(`Import fuera del repositorio detectado en ${path}`)
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) ||
      /(?:sk_live_|sk_test_|eyJhbGciOiJIUzI1Ni[A-Za-z0-9_-]{20,})/.test(text)) {
    fail(`Posible secreto incrustado en ${path}`)
  }
}

const gitignore = await read('.gitignore')
for (const line of ['.env', '.dev.vars', 'node_modules/', 'dist/']) {
  if (!gitignore.split(/\r?\n/).includes(line)) fail(`.gitignore no protege ${line}`)
}

const packageJson = JSON.parse(await read('package.json'))
for (const script of ['lint', 'test', 'build', 'check:project']) {
  if (!packageJson.scripts?.[script]) fail(`Falta script npm: ${script}`)
}

if (failures.length > 0) {
  console.error('Guardrail de proyecto: FALLÓ')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('Guardrail de proyecto: OK')
  console.log(`- ${migrationFiles.length} migraciones SQL inspeccionadas`)
  console.log(`- ${sourceFiles.length} archivos de código/configuración inspeccionados`)
}
