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
  'server/lib/egressCache.js',
  'api/index.js',
  'wrangler.toml',
  'vercel.json',
  '.env.example',
  '.dev.vars.example',
  'supabase/config.toml',
  'index.html',
  'compat/modules/auth/LoginPage.jsx',
  'compat/modules/auth/UserCard.jsx',
  'compat/modules/auth/PwaInstallButton.jsx',
  'src/NominaApp.jsx',
  'tailwind.config.js',
  'public/logo.png',
  'public/favicon.png',
  'supabase/migrations/001_nomina_base_contract.sql',
  'supabase/migrations/208_nomina_config_empleado.sql',
  'supabase/migrations/219_nomina_rollout_flag.sql',
  'supabase/migrations/220_nomina_integrity_guardrails.sql',
  'supabase/migrations/221_finanzas_movimientos.sql',
  'supabase/migrations/222_finanzas_admin_role_guard.sql',
  'supabase/migrations/223_finanzas_resumen_filtros.sql',
  'server/handlers/nomina.js',
  'server/handlers/nomina.lineas.js',
  'server/handlers/finanzas.js',
  'src/components/finanzas/FinanzasView.jsx',
  'src/components/nomina/TabConfiguracion.jsx',
]
for (const path of requiredFiles) {
  if (!await exists(path)) fail(`Falta archivo requerido: ${path}`)
}

const envExample = await read('.env.example')
const devVarsExample = await read('.dev.vars.example')
const indexHtml = await read('index.html')
const loginSource = await read('compat/modules/auth/LoginPage.jsx')
const userCardSource = await read('compat/modules/auth/UserCard.jsx')
const pwaSource = await read('compat/modules/auth/PwaInstallButton.jsx')
const authStoreSource = await read('compat/store/useAuthStore.js')
const authServerSource = await read('compat/api/lib/auth.js')
const pinModalSource = await read('compat/components/auth/LoginPinModal.jsx')
const employeeModalSource = await read('src/components/nomina/EmpleadoConfigModal.jsx')
const cssSource = await read('compat/index.css')
const vercelApiSource = await read('api/index.js')
const vercelConfig = await read('vercel.json')
const shellSource = await read('src/NominaApp.jsx')
const payrollHookSource = await read('src/hooks/useNomina.js')
const payrollViewSource = await read('src/views/NominaView.jsx')
const marcajeSource = await read('src/components/nomina/MarcajeLogisticaPanel.jsx')
const financeHandlerSource = await read('server/handlers/finanzas.js')
const financeViewSource = await read('src/components/finanzas/FinanzasView.jsx')
const financeMigrationSource = await read('supabase/migrations/221_finanzas_movimientos.sql')
const financeRoleMigrationSource = await read('supabase/migrations/222_finanzas_admin_role_guard.sql')
const nominaSharedSource = await read('server/handlers/nomina.shared.js')
const authOperatorsSource = await read('server/handlers/auth-operators.js')
const tailwindSource = await read('tailwind.config.js')
const supabaseConfig = await read('supabase/config.toml')

for (const [name, source, markers] of [
  ['index.html', indexHtml, ['Nómina y Finanzas · Construacero Carabobo', 'Nómina y finanzas de Construacero Carabobo C.A.']],
  ['compat/modules/auth/LoginPage.jsx', loginSource, ['¿Quién está operando?', 'Selecciona tu usuario e ingresa tu PIN', 'Nómina y Finanzas', 'LoginPinModal', 'switchOperator', 'listar_usuarios_login', "u.rol === 'administracion'", '/logo.png', 'login-stage', 'login-panel', 'login-empty', 'Actualizar operadores', 'login-field-control', 'login-field-icon', 'login-field-password-control', 'login-submit', 'submitReady', 'nomina-login-email', 'nomina-login-password', 'noValidate', 'Ingresa un correo válido.', 'login-form-error', 'operator-grid', 'operator-list-summary', 'await logout()']],
  ['server/handlers/nomina.shared.js', nominaSharedSource, ['ADMIN_ROLE', "ROLES_VER = [ADMIN_ROLE]", "ROLES_NOMINA = [ADMIN_ROLE]", "ROLES_ADMIN = [ADMIN_ROLE]"]],
  ['server/handlers/auth-operators.js', authOperatorsSource, ['const OPERATOR_ROLES = new Set([\'administracion\'])', 'rol=eq.administracion']],
  ['compat/modules/auth/UserCard.jsx', userCardSource, ['operator-card', 'operator-card-avatar-wrap', 'operator-card-role']],
  ['compat/modules/auth/PwaInstallButton.jsx', pwaSource, ['beforeinstallprompt', 'Instalar App']],
  ['src/components/nomina/EmpleadoConfigModal.jsx', employeeModalSource, ['tipo_cliente === \'personal\'', 'no crea fichas nuevas', 'Actualizar lista']],
  ['compat/store/useAuthStore.js', authStoreSource, ["signOut({ scope: 'local' })", 'finally {', 'isLocalApi', 'localSessionRejected', 'VITE_AUTH_DEBUG', 'Este sistema solo admite el rol administración.']],
  ['compat/components/auth/LoginPinModal.jsx', pinModalSource, ['pin-modal-backdrop', 'pin-modal-card', 'pin-modal-pad', 'pin-modal-input', 'aria-modal="true"', 'submitLockRef', 'if (pin.length !== PIN_LEN || working || submitLockRef.current) return']],
  ['compat/index.css', cssSource, ['.pin-modal-card', 'overflow-x: hidden', 'overflow-y: auto', 'overscroll-behavior: contain', '.operator-card-avatar-wrap', '.operator-card-role', 'text-wrap: balance']],
  ['api/index.js', vercelApiSource, ['__route__', 'new URL(req.url']],
  ['vercel.json', vercelConfig, ['"/api/:path*"', '"/api?__route__=:path*"', '"api/index.js"']],
  ['src/NominaApp.jsx', shellSource, ['Nómina y Finanzas', 'className="loader"', 'className="loader-square"', 'Array.from({ length: 7 }', 'md:hidden', 'translate-x-0', 'safe-area-inset-bottom', "perfil.rol !== 'administracion'"]],
  ['src/hooks/useNomina.js', payrollHookSource, ["const ADMIN_ROLE = 'administracion'", "enabled: perfil?.rol === ADMIN_ROLE"]],
  ['src/views/NominaView.jsx', payrollViewSource, ["perfil?.rol === 'administracion'", 'TabConfiguracion', 'configuracion']],
  ['src/components/nomina/MarcajeLogisticaPanel.jsx', marcajeSource, ["perfil?.rol === 'administracion'", 'Administración registra']],
  ['server/handlers/finanzas.js', financeHandlerSource, ['handleGetFinanzasMovimientos', 'handleCrearFinanzasMovimiento', 'handleAnularFinanzasMovimiento', 'handleGetFinanzasResumen', 'requireAdmin', 'idempotency_key']],
  ['server/handlers/nomina.js', await read('server/handlers/nomina.js'), ['./nomina.empleados.js', './nomina.asistencia.js', './nomina.lineas.js']],
  ['src/components/finanzas/FinanzasView.jsx', financeViewSource, ['useFinanzasMovimientos', 'useFinanzasResumen', 'Nuevo movimiento', 'Mostrar movimientos anulados']],
  ['supabase/migrations/221_finanzas_movimientos.sql', financeMigrationSource, ['finanzas_movimientos', 'finanzas_resumen', 'ENABLE ROW LEVEL SECURITY', 'monto_ves']],
  ['supabase/migrations/222_finanzas_admin_role_guard.sql', financeRoleMigrationSource, ['nomina_single_role_guard', 'usuarios_rol_administracion_check', 'UPDATE public.usuarios', 'rol = \'administracion\'', 'anulacion_idempotency_key']],
  ['tailwind.config.js', tailwindSource, ['./compat/**/*.{js,jsx}', "darkMode: 'class'", '.scrollbar-hide']],
]) {
  for (const marker of markers) {
    if (!source.includes(marker)) fail(`${name} perdió el contrato de identidad/login: ${marker}`)
  }
}
if (!authServerSource.includes("operador.rol !== ADMIN_ROLE") || authServerSource.includes('NOMINA_SINGLE_ADMIN_ONLY')) {
  fail('La autorización server-side debe fijar sin excepciones el rol único administración')
}
if (nominaSharedSource.includes("'jefe'") || nominaSharedSource.includes("'desarrollador'") || nominaSharedSource.includes("'logistica'")) {
  fail('Los handlers de nómina no deben conservar roles operativos heredados')
}
if (authOperatorsSource.includes('handleSuperAdmin') || authOperatorsSource.includes('/api/auth/super-admin') || authOperatorsSource.includes('DEV_SUPER_CODE')) {
  fail('No debe existir un bypass de desarrollador o Super Admin en el flujo de autenticación')
}
if (loginSource.includes('super-admin') || loginSource.includes('Acceso Desarrollador') || loginSource.includes('_isSuperAdmin')) {
  fail('El login no debe contener accesos secretos ni perfiles virtuales')
}
if (!financeHandlerSource.includes("const denied = requireAdmin")) {
  fail('Finanzas debe exigir administración antes de tocar Supabase')
}
if (payrollHookSource.includes("'logistica'") || payrollHookSource.includes("'jefe'") || payrollHookSource.includes("'desarrollador'")) {
  fail('El frontend de nómina no debe habilitar roles heredados')
}
if (loginSource.includes('Gestión de cotizaciones, inventario y clientes')) {
  fail('La pantalla de login no debe mostrar textos del POS')
}
if (loginSource.includes('supabase.auth.signOut')) {
  fail('El login debe cerrar sesión a través del store para limpiar cache y tolerar errores de Supabase')
}
if (!/^project_id\s*=\s*"wlxcclidnwketrghqaxs"\s*$/m.test(supabaseConfig)) {
  fail('supabase/config.toml no apunta al proyecto Supabase entregado')
}
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_WORKER_ORIGIN']) {
  if (!new RegExp(`^${key}=`, 'm').test(envExample)) fail(`.env.example no documenta ${key}`)
}
for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'NOMINA_TIMEZONE', 'NOMINA_ALLOWED_ORIGINS']) {
  if (!new RegExp(`^${key}=`, 'm').test(devVarsExample)) fail(`.dev.vars.example no documenta ${key}`)
}
if (/^SUPABASE_(?:URL|ANON_KEY|SERVICE_KEY)=/m.test(envExample) ||
    /^(?:SUPABASE_ACCESS_TOKEN|DB_PASSWORD|VERCEL_TOKEN|verceltoken)=/mi.test(envExample)) {
  fail('.env.example no debe contener secretos de Supabase, base de datos o Vercel')
}
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
  '221_finanzas_movimientos.sql',
  '222_finanzas_admin_role_guard.sql',
  '223_finanzas_resumen_filtros.sql',
]
for (const migration of expectedMigrations) {
  if (!migrationFiles.includes(migration)) fail(`Falta migración de contrato: ${migration}`)
}

const sourceFiles = (await walk('.')).filter(path => /\.(?:js|jsx|mjs|json|toml|sql|css)$/.test(path))
const boundedSourceFiles = sourceFiles.filter(path => /\.(?:js|jsx|mjs|sql|css)$/.test(path))
for (const path of sourceFiles) {
  // Este archivo contiene las expresiones del propio escáner; no lo uses como
  // entrada para detectar los patrones que implementa.
  if (path.split(/[\\/]/)[0] === 'scripts') continue
  const text = await read(path)
  if (boundedSourceFiles.includes(path) && text.split(/\r?\n/).length > 600) {
    fail(`Archivo sobrepasa el límite de 600 líneas: ${path}`)
  }
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
  if (path === 'server/handlers/nomina.js' && /select=\*/.test(text)) {
    fail('El handler de nómina no debe usar select=*; proyecta columnas para proteger egress')
  }
  if (path.startsWith('server/') && /limit=1000/.test(text)) {
    fail(`Límite de egress demasiado alto detectado en ${path}`)
  }
}
if (boundedSourceFiles.length === 0) fail('No se encontraron fuentes acotadas para el guardrail de tamaño')

const gitignore = await read('.gitignore')
for (const line of ['.env', '.dev.vars', 'node_modules/', 'dist/']) {
  if (!gitignore.split(/\r?\n/).includes(line)) fail(`.gitignore no protege ${line}`)
}

const workerSource = await read('worker.js')
const egressCacheSource = await read('server/lib/egressCache.js')
for (const marker of ['egressCacheTtl', 'clearEgressCache', 'cacheResponse']) {
  if (!workerSource.includes(marker)) fail(`worker.js no aplica guardrail de egress: ${marker}`)
}
for (const marker of ['MAX_ENTRY_BYTES', 'MAX_TOTAL_BYTES', 'egressRequestKey']) {
  if (!egressCacheSource.includes(marker)) fail(`Falta límite del caché de egress: ${marker}`)
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
