// scripts/test-staging-purga.mjs
// Prueba determinista de la ZONA DE MANTENIMIENTO contra el staging aislado:
// purga de registros (Nómina + Finanzas) con respaldo previo.
//
// Flujo:
//   1. Preflight: ambos configs apuntan SOLO al staging y con claves de staging.
//   2. Login sintético + semilla de registros transaccionales sintéticos
//      (enero: asistencia, movimiento, período, línea, concepto, operación +
//      asignación; marzo: grupo FUERA de rango que debe sobrevivir).
//   3. Candados del endpoint: frase incorrecta (400), nómina sola con pagos
//      vinculados (409) y nómina sola por rango (409) NO borran nada.
//   4. Purga por RANGO DE FECHAS (enero–febrero): solo lo del rango, previo ==
//      purga (misma cuenta por tabla), respaldo con fechas y el grupo de marzo
//      intacto.
//   5. Purga TOTAL por el endpoint con el jefe sintético (200 + backup_id).
//   6. Verificación: tablas operativas en cero, MAESTROS intactos (cuentas,
//      empleados, configuraciones, catálogos, carteras), tasa manual global viva,
//      respaldo exacto en purga_backups y ejecución en purga_log.
//   7. Restaura los fixtures estándar (seed-staging-fixtures) para que smoke y
//      determinista sigan funcionando.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import worker from '../worker.js'

const REF = 'wishglzpmcshyvlgpjxj'
const SUPABASE_URL = `https://${REF}.supabase.co`
const TASA_SUPERVIVIENTE = '123456.789'

function readEnv(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing staging config: ${path}`)
  const values = {}
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const text = line.trim()
    if (!text || text.startsWith('#')) continue
    const index = text.indexOf('=')
    if (index < 1) continue
    let value = text.slice(index + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value)
    values[text.slice(0, index)] = value
  }
  return values
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const frontend = readEnv('.env.staging.local')
  const localWorker = readEnv('.dev.vars.staging')
  assert(frontend.VITE_SUPABASE_URL === SUPABASE_URL && localWorker.SUPABASE_URL === SUPABASE_URL,
    'Refusing purge test: both configs must target the isolated staging project.')
  assert(frontend.VITE_SUPABASE_ANON_KEY?.startsWith('sb_publishable_')
    && localWorker.SUPABASE_SERVICE_KEY?.startsWith('sb_secret_'),
  'Refusing purge test: expected staging-only key types.')

  // Sincronizar el SQL de la migración 250 en staging (idempotente: CREATE
  // OR REPLACE + CREATE TABLE IF NOT EXISTS) para probar siempre el código real.
  const local = readEnv('.env')
  const token = local.SUPABASE_ACCESS_TOKEN
  assert(token, 'Falta .env con SUPABASE_ACCESS_TOKEN.')
  const sync = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: fs.readFileSync('supabase/migrations/250_mantenimiento_purga_registros.sql', 'utf8') }),
  })
  assert(sync.ok, `No se pudo sincronizar la migración 250 en staging (${sync.status}).`)

  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: frontend.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: frontend.STAGING_TEST_EMAIL, password: frontend.STAGING_TEST_PASSWORD }),
  })
  assert(login.ok, `Synthetic staging login failed (${login.status}).`)
  const session = await login.json()
  const accountId = session.user?.id
  assert(accountId, 'Synthetic staging login did not return an account ID.')

  const env = {
    SUPABASE_URL: localWorker.SUPABASE_URL,
    SUPABASE_ANON_KEY: localWorker.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: localWorker.SUPABASE_SERVICE_KEY,
    NOMINA_TIMEZONE: localWorker.NOMINA_TIMEZONE || 'America/Caracas',
    NOMINA_ALLOWED_ORIGINS: localWorker.NOMINA_ALLOWED_ORIGINS || '',
  }
  const workerRequest = (path, body) => worker.fetch(new Request(`http://127.0.0.1:8789${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env)
  const workerJson = async (path, body) => {
    const response = await workerRequest(path, body)
    const payload = await response.json().catch(() => null)
    return { status: response.status, payload }
  }
  const serviceRequest = (path, init = {}) => fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: localWorker.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${localWorker.SUPABASE_SERVICE_KEY}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const readRows = async path => {
    const response = await serviceRequest(path)
    assert(response.ok, `Staging purge read failed (${response.status}).`)
    return response.json()
  }
  const insert = async (table, row) => {
    const response = await serviceRequest(`/rest/v1/${table}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    })
    const payload = await response.json().catch(() => null)
    assert(response.ok && Array.isArray(payload), `No se pudo sembrar ${table} (${response.status}): ${JSON.stringify(payload)}`)
    return payload[0]
  }
  const tenant = `cuenta_id=eq.${accountId}`
  const countRows = async (table, extra = '') => (await readRows(`/rest/v1/${table}?select=id&${tenant}${extra ? `&${extra}` : ''}`)).length

  // ── Operador y empleado sintéticos ────────────────────────────────────────
  // La purga es EXCLUSIVA del rol jefe (capacidad purgarRegistros): el operador
  // sintético debe serlo, y la sesión queda ligada a él validando su PIN.
  const operadores = await readRows(`/rest/v1/usuarios?select=id,nombre,rol,activo&${tenant}&limit=10`)
  const operador = operadores.find(o => o.activo && o.rol === 'jefe')
  assert(operador, `El operador sintético debe ser un jefe activo (roles: ${operadores.map(o => o.rol).join(', ') || 'ninguno'}).`)
  const eleccion = await workerJson('/api/auth/switch-operator', { operator_id: operador.id, pin: frontend.STAGING_TEST_PIN })
  assert(eleccion.status === 200, `La selección del operador jefe falló (${eleccion.status}): ${JSON.stringify(eleccion.payload)}`)
  const [empleado] = await readRows(`/rest/v1/clientes?select=id,nombre&${tenant}&limit=5`)
  assert(empleado, 'No hay empleado sintético en staging.')

  // ── Pre-limpieza con el MISMO RPC de purga: borra restos de ejecuciones
  //    fallidas anteriores y los fixtures estándar (el seed los recrea al final).
  const preclean = await serviceRequest('/rest/v1/rpc/mantenimiento_purgar', {
    method: 'POST',
    body: JSON.stringify({
      p_cuenta_id: accountId, p_modulos: ['nomina', 'finanzas'],
      p_operador_id: operador.id, p_ejecutado_nombre: 'Preclean purga QA', p_ip: null,
    }),
  })
  const precleanBody = await preclean.text()
  assert(preclean.ok, `La pre-limpieza falló (${preclean.status}): ${precleanBody}`)
  console.log('[purga] Pre-limpieza de restos anteriores ejecutada con el RPC de purga.')

  // ── Cartera (maestro que debe sobrevivir; se crea si falta) ───────────────
  let [cartera] = await readRows(`/rest/v1/cuentas_custodia?select=id,nombre&${tenant}&nombre=eq.Cartera%20purga%20QA&limit=1`)
  if (!cartera) {
    cartera = await insert('cuentas_custodia', {
      cuenta_id: accountId, nombre: 'Cartera purga QA', tipo: 'efectivo_usd',
      cartera: 'USD', moneda: 'USD', subcuenta_id: 'purga-qa', predeterminada: false, activo: true,
      creado_por: operador.id,
    })
  }

  // ── Estado de maestros ANTES (nunca deben cambiar) ───────────────────────
  const maestrosAntes = {
    usuarios: await countRows('usuarios'),
    clientes: await countRows('clientes'),
    cuentas_custodia: await countRows('cuentas_custodia'),
    configuracion_negocio: await countRows('configuracion_negocio'),
    finanzas_categorias: await countRows('finanzas_categorias'),
    nomina_conceptos: await countRows('nomina_conceptos'),
    nomina_config_empleado: await countRows('nomina_config_empleado'),
    nomina_horarios: await countRows('nomina_horarios'),
    nomina_feriados: await countRows('nomina_feriados'),
  }

  // ── Semilla de registros transaccionales sintéticos ───────────────────────
  const asistencia = await insert('registro_asistencia', {
    cuenta_id: accountId, empleado_id: empleado.id, fecha: '2026-01-15',
    horas_trabajadas: 8, horas_normales: 8, horas_extra: 0,
    nota: 'purga-qa asistencia sintética', registrado_por: operador.id,
  })
  const movimiento = await insert('finanzas_movimientos', {
    cuenta_id: accountId, fecha: '2026-01-15', tipo: 'egreso', categoria: 'Purga QA',
    concepto: 'Registro sintético para purga', monto: 1, moneda: 'USD', tasa_ves: 1,
    fuente_tasa: 'BCV', idempotency_key: `purga-qa-${randomUUID()}`, creado_por: operador.id,
  })
  const periodo = await insert('nomina_periodos', {
    cuenta_id: accountId, nombre: 'Purga QA staging', desde: '2026-01-01', hasta: '2026-01-07',
    tipo: 'semanal', estado: 'abierto',
  })
  // OJO con el orden de los entrelazados contables: las líneas se insertan con
  // el período ABIERTO (insertarlas cerrado las rechaza) y recién entonces se
  // cierra el período (el pago exige períodos cerrados).
  const linea = await insert('nomina_lineas', {
    cuenta_id: accountId, periodo_id: periodo.id, empleado_id: empleado.id,
    total_bruto_usd: 1, total_neto_usd: 1, dias_trabajados: 1,
  })
  await insert('nomina_linea_conceptos', {
    cuenta_id: accountId, linea_id: linea.id, codigo_snap: 'PURGA-QA',
    nombre_snap: 'Concepto purga QA', tipo_snap: 'ingreso', monto: 1,
  })
  const cierre = await serviceRequest(`/rest/v1/nomina_periodos?id=eq.${periodo.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ estado: 'cerrado', cerrado_en: new Date().toISOString(), cerrado_por: operador.id }),
  })
  assert(cierre.ok, `No se pudo cerrar el período sintético (${cierre.status}).`)
  // El pago REAL (flujo del sistema) crea operación + asignación + movimientos:
  // esas tablas solo se escriben vía la RPC atómica, nunca por INSERT directo.
  const pago = await workerJson('/api/nomina/lineas/pagar', {
    idempotencyKey: `purga-qa-${randomUUID()}`,
    lineaIds: [linea.id],
    fuenteTasa: 'BCV',
    tasaBcv: 100,
    metodoPago: 'purga-qa',
    cuentaCustodiaId: cartera.id,
    referencia: 'purga qa',
  })
  assert(pago.status === 200, `El pago sintético falló (${pago.status}): ${JSON.stringify(pago.payload)}`)
  // La asignación/operación se verifican al final vía el respaldo: estas tablas
  // solo son legibles por RPC (grants cerrados del núcleo financiero).
  // La tasa manual global (periodo_id NULL) sobrevive a la purga a propósito,
  // así que se limpia la sintética de ejecuciones anteriores antes de sembrar.
  const limpiaTasas = await serviceRequest(
    `/rest/v1/nomina_tasas_snapshot?${tenant}&fuente=eq.MANUAL&valor=eq.${TASA_SUPERVIVIENTE}`,
    { method: 'DELETE' },
  )
  assert(limpiaTasas.ok, `No se pudo limpiar la tasa manual sintética previa (${limpiaTasas.status}).`)
  const tasaManual = await insert('nomina_tasas_snapshot', {
    cuenta_id: accountId, fecha: '2020-01-01', moneda_origen: 'USD', moneda_destino: 'VES',
    valor: TASA_SUPERVIVIENTE, fuente: 'MANUAL', observado_en: '2020-01-01T00:00:00Z',
    aprobado: false, periodo_id: null, motivo: 'Purga QA (debe sobrevivir)', fijada_por_nombre: 'Purga QA',
  })

  // ── Grupo FUERA del rango de prueba (marzo): debe sobrevivir a la purga por
  //    rango y solo desaparecer en la purga total. ───────────────────────────
  const asistenciaMarzo = await insert('registro_asistencia', {
    cuenta_id: accountId, empleado_id: empleado.id, fecha: '2026-03-10',
    horas_trabajadas: 8, horas_normales: 8, horas_extra: 0,
    nota: 'purga-qa asistencia fuera de rango', registrado_por: operador.id,
  })
  const movimientoMarzo = await insert('finanzas_movimientos', {
    cuenta_id: accountId, fecha: '2026-03-10', tipo: 'egreso', categoria: 'Purga QA',
    concepto: 'Registro sintético fuera de rango', monto: 1, moneda: 'USD', tasa_ves: 1,
    fuente_tasa: 'BCV', idempotency_key: `purga-qa-${randomUUID()}`, creado_por: operador.id,
  })
  const periodoMarzo = await insert('nomina_periodos', {
    cuenta_id: accountId, nombre: 'Purga QA marzo', desde: '2026-03-02', hasta: '2026-03-08',
    tipo: 'semanal', estado: 'abierto',
  })
  const lineaMarzo = await insert('nomina_lineas', {
    cuenta_id: accountId, periodo_id: periodoMarzo.id, empleado_id: empleado.id,
    total_bruto_usd: 1, total_neto_usd: 1, dias_trabajados: 1,
  })
  await insert('nomina_linea_conceptos', {
    cuenta_id: accountId, linea_id: lineaMarzo.id, codigo_snap: 'PURGA-QA-MARZO',
    nombre_snap: 'Concepto purga QA marzo', tipo_snap: 'ingreso', monto: 1,
  })
  console.log('[purga] Semilla creada: grupo ENERO (asistencia, movimiento, período cerrado, línea, concepto, pago real con operación+asignación), grupo MARZO fuera de rango y tasa manual.')

  // ── Candado 1: frase incorrecta no borra nada ────────────────────────────
  const falsa = await workerJson('/api/mantenimiento/purgar', { modulos: ['nomina', 'finanzas'], confirmacion: 'ELIMINAR!' })
  assert(falsa.status === 400, `La frase incorrecta debió ser 400 y fue ${falsa.status}.`)
  assert(await countRows('registro_asistencia') >= 1, 'La frase incorrecta borró datos: candado roto.')

  // ── Candado 2: nómina sola con pagos vinculados → 409 y nada se borra ────
  const soloNomina = await workerJson('/api/mantenimiento/purgar', { modulos: ['nomina'], confirmacion: 'ELIMINAR' })
  assert(soloNomina.status === 409, `Nómina sola con pagos vinculados debió ser 409 y fue ${soloNomina.status}.`)
  assert(await countRows('nomina_lineas') >= 2, 'El candado de pagos vinculados borró datos: candado roto.')

  // ── Candado 3: nómina sola CON rango y pago vinculado en él → 409 ────────
  const soloNominaRango = await workerJson('/api/mantenimiento/purgar',
    { modulos: ['nomina'], confirmacion: 'ELIMINAR', desde: '2026-01-01', hasta: '2026-02-28' })
  assert(soloNominaRango.status === 409, `Nómina sola por rango con pagos vinculados debió ser 409 y fue ${soloNominaRango.status}.`)
  assert(await countRows('nomina_lineas') >= 2, 'El candado de rango borró datos: candado roto.')

  // ── Previo por endpoint (jefe sintético) ─────────────────────────────────
  const previo = await workerJson('/api/mantenimiento/purga-preview?modulos=nomina,finanzas')
  assert(previo.status === 200 && previo.payload?.ok, `Previo de purga falló (${previo.status}).`)
  assert(previo.payload.conteos.registro_asistencia >= 2 && previo.payload.conteos.finanzas_movimientos >= 2,
    'El previo no contó los registros sembrados (enero + marzo).')

  // ── Purga por RANGO DE FECHAS (enero–febrero): solo lo del rango ─────────
  const previoRango = await workerJson('/api/mantenimiento/purga-preview?modulos=nomina,finanzas&desde=2026-01-01&hasta=2026-02-28')
  assert(previoRango.status === 200 && previoRango.payload?.ok, `Previo por rango falló (${previoRango.status}).`)
  assert(previoRango.payload.conteos.registro_asistencia === 1 && previoRango.payload.conteos.nomina_periodos === 1
    && previoRango.payload.conteos.nomina_lineas === 1 && previoRango.payload.conteos.nomina_linea_conceptos === 1
    && previoRango.payload.conteos.finanzas_movimientos >= 1
    && previoRango.payload.conteos.finanzas_nomina_asignaciones >= 1,
  `El previo por rango no refleja exactamente el grupo de enero: ${JSON.stringify(previoRango.payload.conteos)}`)

  const purgaRango = await workerJson('/api/mantenimiento/purgar',
    { modulos: ['nomina', 'finanzas'], confirmacion: 'ELIMINAR', desde: '2026-01-01', hasta: '2026-02-28' })
  assert(purgaRango.status === 200 && purgaRango.payload?.ok, `La purga por rango falló (${purgaRango.status}): ${JSON.stringify(purgaRango.payload)}`)
  assert(purgaRango.payload.rango?.desde === '2026-01-01' && purgaRango.payload.rango?.hasta === '2026-02-28',
    'La purga por rango no devolvió el rango aplicado.')
  assert(JSON.stringify(purgaRango.payload.por_tabla) === JSON.stringify(previoRango.payload.conteos),
    `El previo y la purga por rango divergen: ${JSON.stringify(previoRango.payload.conteos)} vs ${JSON.stringify(purgaRango.payload.por_tabla)}`)

  // El grupo de enero desapareció; el de marzo sobrevive intacto.
  assert(await countRows('registro_asistencia', 'fecha=eq.2026-01-15') === 0, 'La asistencia de enero debió eliminarse con el rango.')
  assert(await countRows('registro_asistencia', 'fecha=eq.2026-03-10') === 1, 'La asistencia de marzo debió sobrevivir al rango.')
  assert(await countRows('nomina_periodos', 'nombre=eq.Purga%20QA%20staging') === 0, 'El período de enero debió eliminarse con el rango.')
  assert(await countRows('nomina_periodos', 'nombre=eq.Purga%20QA%20marzo') === 1, 'El período de marzo debió sobrevivir al rango.')
  assert(await countRows('nomina_lineas', `periodo_id=eq.${periodoMarzo.id}`) === 1, 'La línea de marzo debió sobrevivir al rango.')
  const [respaldoRango] = await readRows(`/rest/v1/purga_backups?select=id,desde,hasta,payload&${tenant}&id=eq.${purgaRango.payload.backup_id}`)
  assert(respaldoRango?.desde === '2026-01-01' && respaldoRango.hasta === '2026-02-28', 'El respaldo del rango no registra las fechas aplicadas.')
  assert(respaldoRango.payload.registro_asistencia?.some(fila => fila.id === asistencia.id),
    'El respaldo del rango no contiene la asistencia de enero.')
  assert(respaldoRango.payload.finanzas_movimientos?.some(fila => fila.id === movimiento.id),
    'El respaldo del rango no contiene el movimiento de enero.')
  assert(respaldoRango.payload.nomina_lineas?.some(fila => fila.id === linea.id),
    'El respaldo del rango no contiene la línea de enero.')
  assert((respaldoRango.payload.finanzas_nomina_asignaciones || []).length >= 1,
    'El respaldo del rango no arrastró el pago vinculado a la línea borrada (cierre por clave foránea).')
  assert(!(respaldoRango.payload.registro_asistencia || []).some(fila => fila.id === asistenciaMarzo.id),
    'El respaldo del rango incluyó datos de marzo: el filtro de fechas está roto.')
  const [bitacoraRango] = await readRows(`/rest/v1/purga_log?select=id,resumen,total_eliminadas&${tenant}&disparador=eq.manual&order=creado_en.desc&limit=1`)
  assert(bitacoraRango?.resumen?.rango?.desde === '2026-01-01' && bitacoraRango.resumen.rango.hasta === '2026-02-28',
    'purga_log no registró el rango aplicado.')
  console.log(`[purga] Rango enero–febrero purgado (${purgaRango.payload.total_eliminadas} filas, respaldo ${purgaRango.payload.backup_id}): el grupo de marzo sobrevive.`)

  // ── Purga TOTAL por endpoint (lo restante) ───────────────────────────────
  const purga = await workerJson('/api/mantenimiento/purgar', { modulos: ['nomina', 'finanzas'], confirmacion: 'ELIMINAR' })
  assert(purga.status === 200 && purga.payload?.ok, `La purga falló (${purga.status}): ${JSON.stringify(purga.payload)}`)
  assert(purga.payload.backup_id, 'La purga no devolvió backup_id.')
  assert(purga.payload.total_eliminadas >= 6, `La purga eliminó pocas filas (${purga.payload.total_eliminadas}).`)
  console.log(`[purga] Purga total ejecutada: ${purga.payload.total_eliminadas} filas, respaldo ${purga.payload.backup_id}.`)

  // ── Verificación post ────────────────────────────────────────────────────
  // El núcleo financiero solo es legible vía RPC (grants cerrados): el previo
  // del endpoint es la verificación de conteos post-purga, tabla por tabla.
  const post = await workerJson('/api/mantenimiento/purga-preview?modulos=nomina,finanzas')
  assert(post.status === 200 && post.payload?.ok, `El previo post-purga falló (${post.status}).`)
  for (const [tabla, filas] of Object.entries(post.payload.conteos)) {
    assert(filas === 0, `La tabla ${tabla} debió quedar en cero (preview: ${filas}).`)
  }
  for (const [tabla, esperado] of Object.entries(maestrosAntes)) {
    assert(await countRows(tabla) === esperado, `El maestro ${tabla} cambió (${esperado} → ${await countRows(tabla)}): prohibido.`)
  }
  const supervivientes = await readRows(`/rest/v1/nomina_tasas_snapshot?select=id,valor&${tenant}&fuente=eq.MANUAL&periodo_id=is.null&valor=eq.${TASA_SUPERVIVIENTE}`)
  assert(supervivientes.length === 1, 'La tasa manual global (periodo_id NULL) debió sobrevivir a la purga.')

  const [respaldo] = await readRows(`/rest/v1/purga_backups?select=id,total_filas,payload&${tenant}&id=eq.${purga.payload.backup_id}`)
  assert(respaldo, 'No existe el respaldo de la purga.')
  assert(respaldo.payload.registro_asistencia?.some(fila => fila.id === asistenciaMarzo.id),
    'El respaldo no contiene la asistencia de marzo (lo que faltaba tras el rango).')
  assert(respaldo.payload.nomina_periodos?.some(fila => fila.id === periodoMarzo.id),
    'El respaldo no contiene el período de marzo.')
  assert(respaldo.payload.finanzas_movimientos?.some(fila => fila.id === movimientoMarzo.id),
    'El respaldo no contiene el movimiento de marzo.')
  assert((respaldo.payload.finanzas_operaciones || []).length >= 1,
    'El respaldo no contiene la operación del pago (sobrevivió al rango y entra en la purga total).')

  const [bitacora] = await readRows(`/rest/v1/purga_log?select=id,resumen,total_eliminadas&${tenant}&disparador=eq.manual&order=creado_en.desc&limit=1`)
  assert(bitacora?.resumen?.tipo === 'mantenimiento', 'purga_log no registró la ejecución de mantenimiento.')
  console.log('[purga] Verificación post OK: operativas en cero, maestros intactos, tasa manual viva, respaldo exacto.')

  // ── Restauración de fixtures estándar ────────────────────────────────────
  console.log('[purga] Restaurando fixtures estándar de staging…')
  execFileSync('node', ['scripts/seed-staging-fixtures.mjs'], { stdio: 'inherit' })
  const periodoFixture = await readRows(`/rest/v1/nomina_periodos?select=id,nombre&${tenant}&nombre=eq.Período%20sintético%20staging`)
  assert(periodoFixture.length === 1, 'La restauración no recreó el período sintético.')
  console.log('[purga] TODAS LAS COMPROBACIONES DE PURGA EN STAGING PASARON.')
}

main().catch(error => {
  console.error('[test:staging:purga] FALLÓ:', error?.message || error)
  process.exit(1)
})
