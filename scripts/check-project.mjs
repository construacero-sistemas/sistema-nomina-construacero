import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findExternalImports, infraccionesEgress } from './qa-responsive-rules.mjs'
import { CAPACIDADES, ROLES_VALIDOS, rolesConCapacidad } from '../server/lib/permissions.js'

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
    if (['node_modules', 'dist', 'coverage', '.git', '.freebuff', '.wrangler', 'outputs', '.workbuddy-ai', 'backups', 'local-backups'].includes(entry.name)) continue
    // Las rutas se acumulan normalizadas a `/`: con `path.join` en Windows usan
    // `\` y las reglas que comparan contra `server/...` o `src/...` nunca
    // disparaban (F-2 del plan de flujo de nómina). La recursión sigue usando la
    // ruta nativa porque la resuelve el sistema de archivos.
    if (entry.isDirectory()) await walk(relativePath, output)
    else output.push(relativePath.split('\\').join('/'))
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
  'src/views/SistemaView.jsx',
  'tailwind.config.js',
  'public/logo.png',
  'public/favicon.png',
  'public/manifest.webmanifest',
  'public/sw.js',
  'AGENT.md',
  'docs/BITACORA_PROYECTO.md',
  'supabase/migrations/001_nomina_base_contract.sql',
  'supabase/migrations/208_nomina_config_empleado.sql',
  'supabase/migrations/219_nomina_rollout_flag.sql',
  'supabase/migrations/220_nomina_integrity_guardrails.sql',
  'supabase/migrations/221_finanzas_movimientos.sql',
  'supabase/migrations/222_finanzas_admin_role_guard.sql',
  'supabase/migrations/223_finanzas_resumen_filtros.sql',
  'supabase/migrations/246_nomina_control_asistencia.sql',
  'supabase/migrations/248_nomina_comisiones_atomicas.sql',
  'supabase/migrations/250_mantenimiento_purga_registros.sql',
  'server/handlers/nomina.js',
  'server/handlers/nomina.lineas.js',
  'server/handlers/finanzas.js',
  'src/components/finanzas/FinanzasView.jsx',
  'src/components/nomina/TabConfiguracion.jsx',
  'server/handlers/rates.js',
  'docs/ACEPTACION_MANUAL_E2E.md',
  'scripts/check-local-dev.mjs',
  'scripts/test-responsiveness-deterministic.mjs',
  'src/components/nomina/ComisionPagoModal.jsx',
  'src/services/pdf/comisionReciboPDF.js',
  'compat/components/ui/DatePicker.jsx',
  'src/components/finanzas/SyncPosModal.jsx',
  'server/handlers/finanzas.sync.js',
  'src/constants/formasPago.js',
  'src/utils/carterasHelper.js',
  'server/lib/carterasHelper.js',
  'src/components/finanzas/CarterasHeader.jsx',
  'src/components/finanzas/TransferenciaCarterasModal.jsx',
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
const workerAuthSource = await read('server/handlers/auth-operators.js')
const employeeModalSource = await read('src/components/nomina/EmpleadoConfigModal.jsx')
const cssSource = await read('compat/index.css')
const vercelApiSource = await read('api/index.js')
const vercelConfig = await read('vercel.json')
const shellSource = await read('src/NominaApp.jsx')
const ratesHookSource = await read('src/hooks/useTasaCambioNomina.js')
const payrollHookSource = await read('src/hooks/useNomina.js')
const payrollViewSource = await read('src/views/NominaView.jsx')
const systemViewSource = await read('src/views/SistemaView.jsx')
const marcajeSource = await read('src/components/nomina/MarcajeLogisticaPanel.jsx')
const financeHandlerSource = await read('server/handlers/finanzas.js')
const financeViewSource = await read('src/components/finanzas/FinanzasView.jsx')
const financeMigrationSource = await read('supabase/migrations/221_finanzas_movimientos.sql')
const financeRoleMigrationSource = await read('supabase/migrations/222_finanzas_admin_role_guard.sql')
const nominaSharedSource = await read('server/handlers/nomina.shared.js')
const authOperatorsSource = await read('server/handlers/auth-operators.js')
const tailwindSource = await read('tailwind.config.js')
const supabaseConfig = await read('supabase/config.toml')
const permissionsGuardSource = await read('server/lib/permissions.js')
const acceptanceSource = await read('docs/ACEPTACION_MANUAL_E2E.md')
const serviceWorkerSource = await read('public/sw.js')
const workerSource = await read('worker.js')
const agentSource = await read('AGENT.md')
const bitacoraSource = await read('docs/BITACORA_PROYECTO.md')
const toastSource = await read('compat/components/ui/Toast.jsx')
const accesoModulosSource = await read('src/config/accesoModulos.js')

for (const [name, source, markers] of [
  ['index.html', indexHtml, ['Nómina y Finanzas · Construacero Carabobo', 'Nómina y finanzas de Construacero Carabobo C.A.']],
  ['compat/modules/auth/LoginPage.jsx', loginSource, ['Bienvenido', 'Acceso a la cuenta', 'El acceso quedará guardado en este dispositivo', '/logo.png', 'login-stage', 'login-panel', 'login-field-control', 'login-field-icon', 'login-field-password-control', 'login-submit', 'submitReady', 'nomina-login-email', 'nomina-login-password', 'noValidate', 'Ingresa un correo válido.', 'login-form-error']],
  ['server/handlers/nomina.shared.js', nominaSharedSource, ['rolesConCapacidad', "rolesConCapacidad('verNomina')", "rolesConCapacidad('gestionarUsuarios')", 'fetchConfigsConControl', 'controla_asistencia']],
  // El interruptor de Asistencia va con la migración 246; sin ella el servidor
  // sirve el listado anterior (respaldo en fetchConfigsConControl).
  ['supabase/migrations/246_nomina_control_asistencia.sql', await read('supabase/migrations/246_nomina_control_asistencia.sql'), ['ADD COLUMN IF NOT EXISTS controla_asistencia BOOLEAN NOT NULL DEFAULT true', 'COMMENT ON COLUMN']],
  ['src/components/nomina/TabEmpleados.jsx', await read('src/components/nomina/TabEmpleados.jsx'), ['puedeGestionarNomina', 'puedePagarComision']],
  ['server/handlers/auth-operators.js', authOperatorsSource, ['ROLES_OPERATIVOS', 'tieneCapacidad', 'OPERATOR_ROLES']],
  ['server/lib/permissions.js', await read('server/lib/permissions.js'), ["'finanzas'", "'nomina'", "'jefe'", 'verSaldos: false', 'MATRIZ', 'requireCapacidad', 'rolesConCapacidad', 'ROLES_OPERATIVOS', 'ROLES_ASIGNABLES', 'tieneAccesoOperativo', 'accesoUI']],
  ['compat/modules/auth/UserCard.jsx', userCardSource, ['operator-card', 'operator-card-avatar-wrap', 'operator-card-role']],
  ['compat/modules/auth/PwaInstallButton.jsx', pwaSource, ['beforeinstallprompt', 'Instalar App']],
  ['src/components/nomina/EmpleadoConfigModal.jsx', employeeModalSource, ['tipo_cliente === \'personal\'', 'Registra aquí al empleado', 'Nombre completo', 'O selecciona una persona ya registrada']],
  ['src/hooks/useTasaCambioNomina.js', ratesHookSource, ['api/rates', 'no-store', 'usdt']],
  ['compat/store/useAuthStore.js', authStoreSource, ["signOut({ scope: 'local' })", 'finally {', '/api/auth/me', 'VITE_AUTH_DEBUG', 'tieneAccesoOperativo']],
  ['server/handlers/auth-operators.js', workerAuthSource, ['handleGetCurrentProfile', 'pin_hash', 'ROLES_OPERATIVOS']],
  ['compat/index.css', cssSource, ['.operator-card-avatar-wrap', '.operator-card-role', 'text-wrap: balance']],
  ['api/index.js', vercelApiSource, ['__route__', 'new URL(req.url']],
  ['vercel.json', vercelConfig, ['"/api/:path*"', '"/api?__route__=:path*"', '"api/index.js"']],
  ['src/NominaApp.jsx', shellSource, ['Nómina y Finanzas', 'className="loader"', 'className="loader-square"', 'Array.from({ length: 7 }', 'md:hidden', 'translate-x-0', 'safe-area-inset-bottom', 'accesoUI']],
  ['src/hooks/useNomina.js', payrollHookSource, ['tieneCapacidad', "'verNomina'", "'administrarNomina'"]],
  // Las acciones de personal se gatean con la MISMA capacidad que exige el servidor
  // (`gestionarUsuarios`): el rol nomina tiene administrarNomina pero no esa llave.
  ['src/views/NominaView.jsx', payrollViewSource, ['administrarNomina', 'TabEmpleados', 'TabHistorial', "tieneCapacidad(perfil, 'gestionarUsuarios')", "tieneCapacidad(perfil, 'operarFinanzas')", 'puedeGestionarNomina', 'puedePagarNomina']],
  ['src/views/SistemaView.jsx', systemViewSource, ['Sistema', 'TabConfiguracion', 'Gestión de Personal Centralizada', '/nomina', 'tieneCapacidad', 'gestionarUsuarios']],
  // El contrato es que la interfaz advierta que la hora la pone el servidor; la
  // redacción del panel cambió al reescribirlo, así que el marcador sigue el texto vigente.
  ['src/components/nomina/MarcajeLogisticaPanel.jsx', marcajeSource, ['administrarNomina', 'El servidor registra la hora']],
  ['compat/components/auth/LoginPinModal.jsx', await read('compat/components/auth/LoginPinModal.jsx'), ['tieneCapacidad']],
  ['src/components/sistema/UsuariosPanel.jsx', await read('src/components/sistema/UsuariosPanel.jsx'), ['ROLES_CREABLES', 'etiquetaRol', 'longitudPin']],
  ['src/config/accesoModulos.js', accesoModulosSource, ["export * from '../../server/lib/permissions.js'"]],
  ['docs/ACEPTACION_MANUAL_E2E.md', acceptanceSource, ['Tareas de aceptación', 'Criterios de liberación', 'operación compartida']],
  ['server/handlers/finanzas.js', financeHandlerSource, ['handleGetFinanzasMovimientos', 'handleCrearFinanzasMovimiento', 'handleAnularFinanzasMovimiento', 'handleGetFinanzasResumen', 'requireCapacidad', 'idempotency_key']],
  ['server/handlers/nomina.js', await read('server/handlers/nomina.js'), ['./nomina.empleados.js', './nomina.asistencia.js', './nomina.lineas.js']],
  ['src/components/finanzas/FinanzasView.jsx', financeViewSource, ['useFinanzasMovimientos', 'useFinanzasResumen', 'Nuevo movimiento']],
  ['src/components/finanzas/FinanzasFiltrosUI.jsx', await read('src/components/finanzas/FinanzasFiltrosUI.jsx'), ['Mostrar movimientos anulados']],
  ['supabase/migrations/221_finanzas_movimientos.sql', financeMigrationSource, ['finanzas_movimientos', 'finanzas_resumen', 'ENABLE ROW LEVEL SECURITY', 'monto_ves']],
  ['supabase/migrations/222_finanzas_admin_role_guard.sql', financeRoleMigrationSource, ['nomina_single_role_guard', 'usuarios_rol_administracion_check', 'UPDATE public.usuarios', 'rol = \'administracion\'', 'anulacion_idempotency_key']],
  ['tailwind.config.js', tailwindSource, ['./compat/**/*.{js,jsx}', "darkMode: 'class'", '.scrollbar-hide']],
  ['public/sw.js', serviceWorkerSource, ['APP_SHELL', 'startsWith(\'/api/\')', 'skipWaiting']],
  ['AGENT.md', agentSource, ['100% responsivo', 'Después de **cada cambio**', 'docs/BITACORA_PROYECTO.md', 'Registro obligatorio de reglas']],
  ['docs/BITACORA_PROYECTO.md', bitacoraSource, ['Bitácora completa del proyecto', 'PWA, carga y egress', 'Formato obligatorio', 'Regla para documentar nuevas reglas', 'Moneda primaria del sistema en USD']],
  ['compat/components/ui/Toast.jsx', toastSource, ['autoDismissMs', 'setTimeout']],
]) {
  for (const marker of markers) {
    if (!source.includes(marker)) fail(`${name} perdió el contrato de identidad/login: ${marker}`)
  }
}
// Contrato de roles (migración 245 + matriz permissions.js): jefe/desarrollador
// = total; finanzas y nomina = módulo propio. La autorización SIEMPRE pasa por la
// matriz central — ningún handler mantiene listas de roles propias.
if (!authServerSource.includes('OPERATIONAL_ROLES') || !authServerSource.includes('ROLES_OPERATIVOS') || !authServerSource.includes('rolesConCapacidad')) {
  fail('La puerta de autorización (validateOperator) debe derivar los roles operativos de la matriz única (server/lib/permissions.js), sin listas propias')
}
if (!accesoModulosSource.includes("export * from '../../server/lib/permissions.js'")) {
  fail('src/config/accesoModulos.js debe reexportar la matriz única en vez de mantener su propia lista de roles')
}
if (!nominaSharedSource.includes("rolesConCapacidad('verNomina')") || !nominaSharedSource.includes("rolesConCapacidad('gestionarUsuarios')")) {
  fail('Los handlers de nómina no deben fijar roles a mano: derivan de la matriz (rolesConCapacidad)')
}
if (!permissionsGuardSource.includes('gestionarUsuarios') || !permissionsGuardSource.includes("capacidadesFinanzas") || !permissionsGuardSource.includes("capacidadesNomina")) {
  fail('La matriz de permisos debe mantener las capacidades separadas por rol (finanzas sin saldos, nomina sin finanzas)')
}

// Paridad UI ↔ servidor: `administrarNomina` es la capacidad del MÓDULO (lectura y
// marcaje); 31 rutas del Worker exigen `gestionarUsuarios` y 7 exigen `operarFinanzas`.
// Cada acción de escritura de Nómina debe gatearse con la capacidad de su endpoint, o
// el rol `nomina` vuelve a ver botones que el servidor rechaza con 403.
const paridadGates = [
  ['src/components/nomina/TabPeriodos.jsx',
    ['puedeGestionarNomina &&', 'puedePagarNomina &&'],
    ['esAdmin && abierto', 'esAdmin && tieneLineas', 'esAdmin && periodo.estado']],
  ['src/components/nomina/PeriodoDetalleModal.jsx',
    ['puedeGestionarNomina &&', 'puedePagarNomina &&'],
    ['esAdmin']],
  ['src/components/nomina/AsistenciaDiariaMovil.jsx',
    ['puedeGestionarNomina &&'],
    ['esAdmin && !esDomingo']],
  ['src/components/nomina/AsistenciaModal.jsx',
    ['registro && puedeGestionarNomina && !esMarcajeReal'],
    ['registro && esAdmin && !esMarcajeReal']],
  ['src/components/nomina/TabAsistencia.jsx',
    ['puedeGestionarNomina={puedeGestionarNomina}'],
    []],
]
for (const [archivo, requeridos, prohibidos] of paridadGates) {
  const fuente = await read(archivo)
  for (const marcador of requeridos) {
    if (!fuente.includes(marcador)) fail(`${archivo} debe gatear por capacidad del endpoint: falta ${marcador}`)
  }
  for (const marcador of prohibidos) {
    if (fuente.includes(marcador)) fail(`${archivo} volvió a gatear una escritura con la capacidad del módulo: ${marcador}`)
  }
}

// El contrato de la sesión: SOLO un 403 marcado OPERADOR_INVALIDO (operador
// inactivo o rol revocado, emitido por validateOperator) cierra la sesión; los
// demás 403 son errores de acción y llegan a la interfaz sin tocarla. La marca
// tiene que viajar del servidor al cliente: si se pierde en cualquiera de los
// dos lados, un error de acción vuelve a cerrar la sesión.
const authFetchSource = await read('compat/services/authFetch.js')
const authLibSource = await read('compat/api/lib/auth.js')
if (!permissionsGuardSource.includes('CODIGO_CAPACIDAD_INSUFICIENTE')) {
  fail('requireCapacidad debe marcar sus 403 con CODIGO_CAPACIDAD_INSUFICIENTE')
}
if (!authLibSource.includes('CODIGO_OPERADOR_INVALIDO')) {
  fail('validateOperator debe marcar sus 403 de revocación con CODIGO_OPERADOR_INVALIDO')
}
if (!authFetchSource.includes('CODIGO_OPERADOR_INVALIDO') || !authFetchSource.includes('denyAccess')) {
  fail('authFetch solo debe invalidar la sesión ante un 403 marcado OPERADOR_INVALIDO')
}
// Sistema de diseño (paridad con POS Cotizaciones): la paleta institucional
// debe seguir definida en tailwind.config.js y el kit UI compartido debe existir
// como superficie única de componentes (src/components/ui).
const tailwindDesignSource = await read('tailwind.config.js')
for (const token of ['#1B365D', '#B8860B', 'content:', 'status:', 'border:', 'fontFamily']) {
  if (!tailwindDesignSource.includes(token)) fail(`tailwind.config.js perdió el token de diseño: ${token}`)
}
const kitUiSource = await read('src/components/ui/index.js')
if (!kitUiSource.includes('Button') || !kitUiSource.includes('Card') || !kitUiSource.includes('Switch')) {
  fail('src/components/ui/index.js debe exportar el kit UI compartido (Button, Card, Switch)')
}
if (!(await read('src/modo-accesible.css')).includes('modo-accesible')) {
  fail('src/modo-accesible.css debe mantener el modo accesible portado del POS')
}

// El espejo SQL de la matriz (migraciones 245 y 250) no puede divergir de la
// fuente JS: si alguien agrega o quita una capacidad en cualquiera de los dos
// lados, esto falla. Se verifican TODAS las ocurrencias del espejo: 245 lo
// declara base y 250 lo reemplaza ampliado con `purgarRegistros`.
const rolesSqlSource = (await read('supabase/migrations/245_converge_administracion_to_jefe.sql'))
  + (await read('supabase/migrations/250_mantenimiento_purga_registros.sql'))
for (const capacidad of CAPACIDADES) {
  const bloques = [...rolesSqlSource.matchAll(new RegExp(`WHEN '${capacidad}'\\s*THEN ARRAY\\[([^\\]]*)\\]`, 'g'))]
  if (bloques.length === 0) {
    fail(`El espejo SQL de roles (migraciones 245/250) no declara la capacidad ${capacidad}`)
    continue
  }
  const rolesJs = [...rolesConCapacidad(capacidad)].sort().join(',')
  for (const bloque of bloques) {
    const rolesSql = [...bloque[1].matchAll(/'([^']+)'/g)].map(match => match[1]).sort().join(',')
    if (rolesSql !== rolesJs) {
      fail(`El espejo SQL de '${capacidad}' no coincide con la matriz única: SQL [${rolesSql}] vs JS [${rolesJs}]`)
    }
  }
}
// El CHECK final de la migración 245 es la tercera fuente: debe cubrir
// exactamente los mismos roles válidos que la matriz única.
const checkRolesSql = await read('supabase/migrations/245_converge_administracion_to_jefe.sql')
const bloqueCheck = checkRolesSql.match(/ADD CONSTRAINT usuarios_rol_check CHECK \(rol IN \(([^)]*)\)\)/)
if (!bloqueCheck) {
  fail('La migración 245 no declara el CHECK usuarios_rol_check')
} else {
  const rolesCheck = [...bloqueCheck[1].matchAll(/'([^']+)'/g)].map(match => match[1]).sort().join(',')
  const rolesMatriz = [...ROLES_VALIDOS].sort().join(',')
  if (rolesCheck !== rolesMatriz) {
    fail(`El CHECK de roles (245) no coincide con ROLES_VALIDOS: SQL [${rolesCheck}] vs JS [${rolesMatriz}]`)
  }
}

const operacionesSqlSource = await read('supabase/migrations/244_roles_operativos_operaciones.sql')
// Se juzga solo el código: los comentarios explican el cambio y citan el patrón
// anterior a propósito.
const soloCodigoSql = sql => sql.split('\n').filter(linea => !linea.trimStart().startsWith('--')).join('\n')
const convergenciaSqlSource = await read('supabase/migrations/245_converge_administracion_to_jefe.sql')
for (const [numero, sql] of [['244', operacionesSqlSource]]) {
  for (const patron of ["get_rol_actual() = 'administracion'", "u.rol = 'administracion'", "rol = 'administracion'"]) {
    if (soloCodigoSql(sql).includes(patron)) fail(`La migración ${numero} reintroduce una autorización por rol único: ${patron}`)
  }
}
// En 245 el literal antiguo solo puede aparecer en el filtro de conversión
// transaccional y en la meta de auditoría; nunca en una capacidad o compuerta.
if (soloCodigoSql(convergenciaSqlSource).includes("WHEN 'verSaldos'          THEN ARRAY['administracion'") ||
    soloCodigoSql(convergenciaSqlSource).includes("WHEN 'gestionarUsuarios'  THEN ARRAY['administracion'")) {
  fail('La migración 245 reintroduce administracion en una capacidad vigente')
}
if (!soloCodigoSql(convergenciaSqlSource).includes("SET rol = 'jefe'")) {
  fail('La migración 245 no contiene la convergencia de usuarios a jefe')
}

if (authOperatorsSource.includes('handleSuperAdmin') || authOperatorsSource.includes('/api/auth/super-admin') || authOperatorsSource.includes('DEV_SUPER_CODE')) {
  fail('No debe existir un bypass de desarrollador o Super Admin en el flujo de autenticación')
}
if (loginSource.includes('super-admin') || loginSource.includes('Acceso Desarrollador') || loginSource.includes('_isSuperAdmin')) {
  fail('El login no debe contener accesos secretos ni perfiles virtuales')
}
// F2 — barrera de acceso: la selección de operador exige PIN validado en el
// Worker (PBKDF2) y la ruta sin PIN está eliminada. LOGIN_SIN_PIN no debe poder
// regresar ni por una nueva ruta ni por una redefinición del handler.
if (workerAuthSource.includes("const { operator_id: operatorId, pin } = parsed.body || {}") === false) {
  fail('La ruta de PIN (switch-operator) debe conservar su validación de operator_id y pin')
}
if (workerAuthSource.includes('LOGIN_SIN_PIN') || workerAuthSource.includes('handleSelectOperator')) {
  fail('La selección sin PIN (LOGIN_SIN_PIN / handleSelectOperator) está eliminada y no debe regresar')
}
if (workerSource.includes('select-operator')) {
  fail('La ruta /api/auth/select-operator está eliminada y no debe registrarse en el Worker')
}
if (!authOperatorsSource.includes("OPERADOR_REQUERIDO")) {
  fail('/api/auth/me debe responder OPERADOR_REQUERIDO para cuentas multi-operador sin selección')
}
if (!financeHandlerSource.includes("requireCapacidad(result.operador, 'verFinanzas'") || !financeHandlerSource.includes("requireCapacidad(result.operador, 'operarFinanzas'")) {
  fail('Finanzas debe autorizar por capacidad (verFinanzas/operarFinanzas) antes de tocar Supabase')
}
// El frontend ya no escribe listas de roles: deriva de la matriz única. La regla
// general (EXPRESIONES_ROL) se aplica a todas las fuentes más abajo.
if (payrollHookSource.includes("'logistica'") || payrollHookSource.includes("'supervisor'")) {
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
  '243_roles_operativos_autorizacion.sql',
  '244_roles_operativos_operaciones.sql',
  '245_converge_administracion_to_jefe.sql',
]
for (const migration of expectedMigrations) {
  if (!migrationFiles.includes(migration)) fail(`Falta migración de contrato: ${migration}`)
}

const sourceFiles = (await walk('.')).filter(path => /\.(?:js|jsx|mjs|json|toml|sql|css)$/.test(path))
const boundedSourceFiles = sourceFiles.filter(path => /\.(?:js|jsx|mjs|sql|css)$/.test(path))
// Rol literal: la ÚNICA fuente permitida es server/lib/permissions.js. Cualquier
// otra autorización escrita como rol literal rompe la paridad interfaz ↔
// servidor ↔ SQL (es justo el desajuste que dejó a jefe/finanzas/nomina fuera).
// Solo vigila los roles de ESTA matriz: los roles heredados del POS (vendedor,
// supervisor, logistica…) son dominio externo y pueden filtrarse donde toque.
const ROLES_MATRIZ = 'desarrollador|jefe|finanzas|nomina'
const EXPRESIONES_ROL = [
  // comparación directa: perfil?.rol === 'finanzas'
  new RegExp(`\\brol\\s*(?:===|!==|==|!=)\\s*['"](?:${ROLES_MATRIZ})['"]`),
  // comparación normalizada: u.rol?.toLowerCase() === 'administracion'
  new RegExp(`\\brol\\b[^\\n]{0,40}toLowerCase\\(\\)[^\\n]{0,20}(?:===|!==|==|!=)\\s*['"](?:${ROLES_MATRIZ})['"]`),
  // lista de roles: ['jefe', 'administracion', 'desarrollador']
  new RegExp(`\\[[^\\]\\n]*'(?:${ROLES_MATRIZ})'[^\\]\\n]*,[^\\]\\n]*'(?:${ROLES_MATRIZ})'`),
  // constante de rol administrativo: const ADMIN_ROLE = 'jefe'
  new RegExp(`\\b(?:const|let|var)\\s+\\w*(?:ROLE|ROL)\\w*\\s*=\\s*['"](?:${ROLES_MATRIZ})['"]`),
]
// Presentación pura: la paleta del avatar distingue visualmente al jefe y no
// autoriza nada, por eso queda fuera de la regla (documentado a propósito).
const EXENTOS_ROL_LITERAL = new Set([
  'compat/components/auth/LoginAvatar.jsx',
])
for (const path of sourceFiles) {
  // Este archivo contiene las expresiones del propio escáner; no lo uses como
  // entrada para detectar los patrones que implementa.
  if (path.split(/[\\/]/)[0] === 'scripts') continue
  const text = await read(path)
  if (boundedSourceFiles.includes(path) && text.split(/\r?\n/).length > 600) {
    fail(`Archivo sobrepasa el límite de 600 líneas: ${path}`)
  }
  // Toda compuerta de rol deriva de la matriz única. La regla ignora las
  // pruebas (su trabajo es fijar roles concretos) y el propio archivo de la
  // matriz; se limita a JS/JSX/MJS para no chocar con el SQL de las migraciones.
  const pathRol = path.split('\\').join('/')
  const esFuenteRol = /\.(?:js|jsx|mjs)$/.test(pathRol)
  const esPrueba = /__tests__\//.test(pathRol) || /\.(?:test|spec)\./.test(pathRol)
  if (esFuenteRol && !esPrueba && pathRol !== 'server/lib/permissions.js' &&
      !EXENTOS_ROL_LITERAL.has(pathRol) &&
      EXPRESIONES_ROL.some(expresion => expresion.test(text))) {
    fail(`Autorización por rol literal fuera de la matriz única en ${pathRol}; deriva de server/lib/permissions.js`)
  }
  // F2 — barrera de acceso: el navegador nunca compara credenciales. El PIN se
  // valida solo en el Worker (PBKDF2); el frontend únicamente lo transporta.
  // Se buscan señales de código (la mención de PBKDF2 en un comentario es legítima).
  if ((pathRol.startsWith('src/') || pathRol.startsWith('compat/')) && !esPrueba &&
      /verifyPinPBKDF2|pin_hash|pin_salt/.test(text)) {
    fail(`Validación de credenciales en el navegador detectada en ${pathRol}; el PIN se valida solo en el Worker`)
  }
  // Política de PIN: la longitud por rol (finanzas/nomina: 4) SOLO se define en
  // la matriz. Cualquier largo escrito a mano es una fuente de divergencia entre
  // el login, el panel y el Worker. Las pruebas quedan fuera: su trabajo es fijar
  // justamente esos largos.
  const PIN_LITERALES = ['/^\\d{6}$/', 'PIN debe ser de 6 dígitos']
  if (!esPrueba && pathRol !== 'server/lib/permissions.js' &&
      PIN_LITERALES.some(literal => text.includes(literal))) {
    fail(`Longitud de PIN escrita a mano en ${pathRol}; deriva de longitudPin() en la matriz única`)
  }
  if (pathRol === 'compat/components/auth/LoginPinModal.jsx' && !text.includes('longitudPin(')) {
    fail('LoginPinModal debe derivar la longitud del PIN de longitudPin() (matriz única)')
  }
  if (pathRol === 'src/components/sistema/UsuariosPanel.jsx') {
    if (!text.includes('ROLES_CREABLES')) {
      fail('UsuariosPanel debe ofrecer ROLES_CREABLES (el selector oculta administracion)')
    }
    if (text.includes('ROLES_ASIGNABLES')) {
      fail('UsuariosPanel no debe usar ROLES_ASIGNABLES: el selector debe usar la fuente vigente ROLES_CREABLES')
    }
  }
  if (pathRol === 'compat/api/lib/auth.js' && text.includes('headerOpId')) {
    fail('verifyAuth no debe aceptar el operador desde la cabecera X-Operator-Id: solo app_metadata tras validar PIN')
  }
  // El paquete puede importar sus propios módulos internos, pero nunca debe
  // alcanzar el POS por rutas relativas al directorio padre.
  if (/\.(?:js|jsx|mjs)$/.test(path)) {
    for (const specifier of findExternalImports(text, path, root)) {
      fail(`Import fuera del repositorio detectado en ${path}: ${specifier}`)
    }
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) ||
      /(?:sk_live_|sk_test_|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/.test(text)) {
    fail(`Posible secreto incrustado en ${path}`)
  }
  // Guardarraíl de egress (proyección de columnas y techo de filas): la regla
  // vive en qa-responsive-rules para que su prueba use el mismo comparador.
  for (const fallo of infraccionesEgress(path, text)) fail(fallo)
  if (path.endsWith('.jsx') && /<select\b/i.test(text)) {
    fail(`Selector nativo cuadrado detectado en ${path}; usa el selector visual compartido`)
  }
  // Lanzamiento por fases terminado: el candado de Nómina y el comando secreto
  // (logo + código) fueron eliminados — el acceso lo decide el permiso del rol.
  // Prueba negativa: ninguna fuente puede re-declarar la maquinaria.
  const pathNorm = path.split('\\').join('/')
  const esTest = /__tests__\//.test(pathNorm)
  if (!esTest && pathNorm.startsWith('src/') && /(?:const|let|var)\s+(?:NOMINA_BLOQUEADA|SECCIONES_NOMINA_BLOQUEADAS|MODULO_BLOQUEADO|CODIGO_DESBLOQUEO)\s*=/.test(text)) {
    fail(`La maquinaria de candados fue eliminada (declaración local en ${path}); el acceso lo decide el permiso del rol`)
  }
  if (!esTest && pathNorm.startsWith('src/') && /ComandoDesbloqueo|comandoDesbloqueo/.test(text)) {
    fail(`El comando secreto de desbloqueo fue eliminado y no debe regresar (${path})`)
  }
}
if (boundedSourceFiles.length === 0) fail('No se encontraron fuentes acotadas para el guardrail de tamaño')

const gitignore = await read('.gitignore')
for (const line of ['.env', '.dev.vars', 'node_modules/', 'dist/']) {
  if (!gitignore.split(/\r?\n/).includes(line)) fail(`.gitignore no protege ${line}`)
}

for (const marker of ["GET /api/rates", 'handleGetRates']) {
  if (!workerSource.includes(marker)) fail(`worker.js no expone tasas: ${marker}`)
}
const egressCacheSource = await read('server/lib/egressCache.js')
for (const marker of ['egressCacheTtl', 'clearEgressCache', 'cacheResponse']) {
  if (!workerSource.includes(marker)) fail(`worker.js no aplica guardrail de egress: ${marker}`)
}
for (const marker of ['MAX_ENTRY_BYTES', 'MAX_TOTAL_BYTES', 'egressRequestKey']) {
  if (!egressCacheSource.includes(marker)) fail(`Falta límite del caché de egress: ${marker}`)
}

const packageJson = JSON.parse(await read('package.json'))
for (const script of ['lint', 'test', 'build', 'check:project', 'check:local']) {
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
