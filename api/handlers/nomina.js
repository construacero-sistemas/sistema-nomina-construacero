// api/handlers/nomina.js
// Módulo de nómina: config empleados, asistencia, períodos y líneas de liquidación.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { calcularCamposAsistencia, calcularLineaNomina } from '../lib/nominaUtils.js'
import { requireNominaTenant, nominaTenantFilter } from '../lib/nominaTenant.js'
import { normalizarConcepto } from '../lib/nominaConceptos.js'
import { normalizarReglaLegal } from '../lib/nominaLegal.js'
import { normalizarTasa } from '../lib/tasasCambio.js'

// Logística registra asistencia pero no participa en el pago: puede ver la
// plantilla y la grilla, no los montos salariales.
const ROLES_VER    = ['administracion', 'jefe', 'desarrollador', 'logistica']
// Puede VER datos salariales (períodos, recibos, salarios de la plantilla).
const ROLES_NOMINA = ['administracion', 'jefe', 'desarrollador']
// Puede MODIFICAR (crear, calcular, cerrar, pagar).
const ROLES_ADMIN  = ['administracion', 'jefe', 'desarrollador']

function r4(n) { return Math.round(Number(n) * 10000) / 10000 }

function tenantGuard(operador, request) {
  return requireNominaTenant(operador, request)
}

function fechaNominaValida(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function horaNominaValida(value) {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) &&
    Number(value.slice(0, 2)) <= 23 && Number(value.slice(3, 5)) <= 59
}

function montoNominaValido(value) {
  return value === undefined || value === null || value === '' ||
    (typeof value !== 'boolean' && Number.isFinite(Number(value)) && Number(value) >= 0)
}

function ajusteNominaValido(value) {
  return value === undefined || value === null || value === '' ||
    (typeof value !== 'boolean' && Number.isFinite(Number(value)))
}

function textoNominaValido(value, max = 500) {
  return value === undefined || value === null ||
    (typeof value === 'string' && value.trim().length <= max)
}

function booleanNominaValido(value) {
  return value === undefined || value === null || typeof value === 'boolean'
}

function horasEntradaSalidaValidas(horaEntrada, horaSalida) {
  const tieneEntrada = horaEntrada !== undefined && horaEntrada !== null && horaEntrada !== ''
  const tieneSalida = horaSalida !== undefined && horaSalida !== null && horaSalida !== ''
  if (!tieneEntrada && !tieneSalida) return true
  return tieneEntrada && tieneSalida && horaNominaValida(horaEntrada) && horaNominaValida(horaSalida)
}

// ─── Empleados y configuración ─────────────────────────────────────────────────

// GET /api/nomina/empleados
// Contrato mínimo de empleados sincronizados: nunca expone datos salariales.
export async function handleGetEmpleados(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/clientes?tipo_cliente=eq.personal&activo=eq.true` +
    `${nominaTenantFilter(operador.cuenta_id)}` +
    '&select=id,nombre,tipo_cliente,activo&order=nombre.asc&limit=1000',
    { headers },
  )
  if (!res.ok) return jsonError('Error al leer empleados', 500, request)
  return json(await res.json() ?? [], 200, request)
}

// GET /api/nomina/config-empleados
export async function handleGetConfigEmpleados(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  const cuentaFilter = nominaTenantFilter(operador.cuenta_id)
  const selectConfig = ROLES_NOMINA.includes(operador.rol)
    ? 'id,empleado_id,cargo,fecha_ingreso,salario_dia_usd,horas_jornada,hora_inicio,hora_fin,activo'
    : 'id,empleado_id,cargo,fecha_ingreso,horas_jornada,hora_inicio,hora_fin,activo'
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?activo=eq.true${cuentaFilter}` +
    `&select=${selectConfig},empleado:clientes!empleado_id(id,nombre,tipo_cliente)` +
    `&order=empleado(nombre).asc&limit=500`,
    { headers }
  )
  if (!res.ok) return jsonError('Error al leer config empleados', 500, request)
  const data = await res.json()
  if (ROLES_NOMINA.includes(operador.rol)) return json(data ?? [], 200, request)

  // Segunda barrera: aunque el upstream ignore el select o agregue columnas,
  // logística solo recibe datos operativos y nunca salario ni cuenta interna.
  const operativa = (data ?? []).map(item => ({
    id: item.id,
    empleado_id: item.empleado_id,
    cargo: item.cargo ?? null,
    fecha_ingreso: item.fecha_ingreso ?? null,
    horas_jornada: item.horas_jornada,
    hora_inicio: item.hora_inicio,
    hora_fin: item.hora_fin,
    activo: item.activo,
    empleado: item.empleado
      ? { id: item.empleado.id, nombre: item.empleado.nombre, tipo_cliente: item.empleado.tipo_cliente }
      : null,
  }))
  return json(operativa, 200, request)
}

// POST /api/nomina/config-empleado/crear
export async function handleCrearConfigEmpleado(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, cargo, fechaIngreso, salarioDiaUsd, horasJornada, horaInicio, horaFin } = body

  if (!empleadoId || !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (Number.isFinite(Number(salarioDiaUsd)) && Number(salarioDiaUsd) < 0) return jsonError('Salario no puede ser negativo', 400, request)
  if (!montoNominaValido(salarioDiaUsd)) return jsonError('Salario inválido', 400, request)
  if (fechaIngreso && !fechaNominaValida(fechaIngreso)) return jsonError('fechaIngreso inválida', 400, request)
  if (horasJornada !== undefined && !(Number.isFinite(Number(horasJornada)) && Number(horasJornada) > 0 && Number(horasJornada) <= 24)) {
    return jsonError('horasJornada inválida', 400, request)
  }
  if (horaInicio !== undefined && !horaNominaValida(horaInicio)) return jsonError('horaInicio inválida', 400, request)
  if (horaFin !== undefined && !horaNominaValida(horaFin)) return jsonError('horaFin inválida', 400, request)
  if (!textoNominaValido(cargo, 160)) return jsonError('cargo inválido', 400, request)

  // Validar que el empleado existe y es tipo 'personal'
  const empRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${empleadoId}` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=id,tipo_cliente&limit=1`,
    { headers }
  )
  if (!empRes.ok) {
    console.error('[nomina] buscar empleado upstream error', empRes.status)
    return jsonError('No se pudo verificar el empleado', 500, request)
  }
  const [emp] = await empRes.json()
  if (!emp) return jsonError('Empleado no encontrado', 404, request)
  if (emp.tipo_cliente !== 'personal') return jsonError('Solo se puede configurar nómina para empleados (tipo_cliente = personal)', 400, request)

  const svcH = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
  const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado`, {
    method: 'POST', headers: svcH,
    body: JSON.stringify({
      empleado_id:     empleadoId,
      cargo:           cargo || null,
      fecha_ingreso:   fechaIngreso || null,
      salario_dia_usd: Number(salarioDiaUsd) || 0,
      horas_jornada:   Number(horasJornada)  || 8,
      hora_inicio:     horaInicio || '08:00',
      hora_fin:        horaFin    || '17:00',
      cuenta_id:       operador.cuenta_id || null,
      activo:          true,
    }),
  })
  if (!insRes.ok) {
    const err = await insRes.text()
    if (err.toLowerCase().includes('unique')) return jsonError('Este empleado ya tiene configuración de nómina', 409, request)
    console.error('[nomina] crear config upstream error', insRes.status, err.slice(0, 500))
    return jsonError('No se pudo crear la configuración de nómina', 500, request)
  }
  const [row] = await insRes.json()
  return json({ ok: true, config: row }, 201, request)
}

// POST /api/nomina/config-empleado/actualizar
export async function handleActualizarConfigEmpleado(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { id, cargo, fechaIngreso, salarioDiaUsd, horasJornada, horaInicio, horaFin, activo } = body
  if (!id || !isValidUuid(id)) return jsonError('id inválido', 400, request)
  if (!booleanNominaValido(activo)) return jsonError('activo inválido', 400, request)
  // En una edición, los valores negativos se normalizan a cero para que una
  // corrección manual no pueda dejar una base salarial negativa. Los valores
  // no numéricos siguen siendo inválidos.
  if (salarioDiaUsd !== undefined && salarioDiaUsd !== null && salarioDiaUsd !== '' &&
      (typeof salarioDiaUsd === 'boolean' || !Number.isFinite(Number(salarioDiaUsd)))) {
    return jsonError('salarioDiaUsd inválido', 400, request)
  }
  if (fechaIngreso !== undefined && fechaIngreso !== null && fechaIngreso !== '' && !fechaNominaValida(fechaIngreso)) {
    return jsonError('fechaIngreso inválida', 400, request)
  }
  if (horasJornada !== undefined && (!Number.isFinite(Number(horasJornada)) || Number(horasJornada) <= 0 || Number(horasJornada) > 24)) {
    return jsonError('horasJornada inválida', 400, request)
  }
  if (horaInicio !== undefined && !horaNominaValida(horaInicio)) return jsonError('horaInicio inválida', 400, request)
  if (horaFin !== undefined && !horaNominaValida(horaFin)) return jsonError('horaFin inválida', 400, request)
  if (!textoNominaValido(cargo, 160)) return jsonError('cargo inválido', 400, request)

  const campos = {}
  if (cargo           !== undefined) campos.cargo            = cargo || null
  if (fechaIngreso    !== undefined) campos.fecha_ingreso     = fechaIngreso || null
  if (salarioDiaUsd   !== undefined) campos.salario_dia_usd  = Math.max(0, Number(salarioDiaUsd) || 0)
  if (horasJornada    !== undefined) campos.horas_jornada    = Math.max(0.5, Number(horasJornada) || 8)
  if (horaInicio      !== undefined) campos.hora_inicio      = horaInicio
  if (horaFin         !== undefined) campos.hora_fin         = horaFin
  if (activo          !== undefined) campos.activo           = activo

  if (Object.keys(campos).length === 0) return jsonError('Nada que actualizar', 400, request)

  const svcH = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
  const upRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?id=eq.${id}` +
    nominaTenantFilter(operador.cuenta_id), {
    method: 'PATCH', headers: svcH,
    body: JSON.stringify(campos),
  })
  if (!upRes.ok) return jsonError('Error al actualizar config', 500, request)
  const [row] = await upRes.json()
  if (!row) return jsonError('Configuración no encontrada', 404, request)
  return json({ ok: true, config: row }, 200, request)
}

// ─── Helpers internos ──────────────────────────────────────────────────────────

function svcHeaders(env, prefer = 'return=representation') {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: prefer,
  }
}

/** Lee los factores globales de nómina para el tenant. */
async function fetchConfigNomina(env, headers, cuentaId) {
  const filtro = cuentaId ? `&cuenta_id=eq.${cuentaId}` : ''
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/configuracion_negocio?limit=1${filtro}` +
      `&select=nomina_factor_hora_extra,nomina_factor_sabado,nomina_factor_feriado,nomina_tipo_periodo`,
      { headers }
    )
    if (res.ok) {
      const [cfg] = await res.json()
      if (cfg) return cfg
    }
  } catch (err) {
    console.warn('[nomina] Error leyendo config de nómina:', err?.message)
  }
  return { nomina_factor_hora_extra: 1.5, nomina_factor_sabado: 1.25, nomina_factor_feriado: 2.0 }
}

// ─── Asistencia ────────────────────────────────────────────────────────────────

// GET /api/nomina/asistencia?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&empleadoId=UUID
export async function handleGetAsistencia(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  const url = new URL(request.url)
  const desde      = url.searchParams.get('desde')
  const hasta      = url.searchParams.get('hasta')
  const empleadoId = url.searchParams.get('empleadoId')

  if (empleadoId && !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (desde && !fechaNominaValida(desde)) return jsonError('desde inválida', 400, request)
  if (hasta && !fechaNominaValida(hasta)) return jsonError('hasta inválida', 400, request)
  if (desde && hasta) {
    const rango = new Date(`${hasta}T12:00:00Z`) - new Date(`${desde}T12:00:00Z`)
    if (rango < 0 || rango > 31 * 86400000) return jsonError('El rango debe estar entre 0 y 31 días', 400, request)
  }

  const filtros = [
    nominaTenantFilter(operador.cuenta_id),
    desde      ? `&fecha=gte.${desde}`          : '',
    hasta      ? `&fecha=lte.${hasta}`          : '',
    empleadoId ? `&empleado_id=eq.${empleadoId}` : '',
  ].join('')

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/registro_asistencia?order=fecha.asc${filtros}` +
    `&select=*,empleado:clientes!empleado_id(id,nombre)&limit=500`,
    { headers }
  )
  if (!res.ok) return jsonError('Error al leer asistencia', 500, request)
  return json(await res.json() ?? [], 200, request)
}

function nowInNominaZone(env) {
  const now = env.NOMINA_NOW ? new Date(env.NOMINA_NOW) : new Date()
  const timezone = env.NOMINA_TIMEZONE || 'America/Caracas'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]))
  const hour = values.hour === '24' ? '00' : values.hour
  return {
    fecha: `${values.year}-${values.month}-${values.day}`,
    hora: `${hour}:${values.minute}`,
    marcadoEn: now.toISOString(),
  }
}

function idempotencyKeyValida(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value.trim())
}

async function fetchRegistroDelDia(env, headers, operador, empleadoId, fecha) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/registro_asistencia?empleado_id=eq.${empleadoId}` +
    `&fecha=eq.${fecha}${nominaTenantFilter(operador.cuenta_id)}&select=*&limit=1`,
    { headers }
  )
  if (!res.ok) return { error: true, row: null }
  const [row] = await res.json()
  return { error: false, row: row || null }
}

async function periodoBloqueadoParaFecha(env, headers, operador, fecha) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?desde=lte.${fecha}&hasta=gte.${fecha}` +
    `&estado=neq.abierto${nominaTenantFilter(operador.cuenta_id)}&select=nombre,estado&limit=1`,
    { headers }
  )
  if (!res.ok) return null
  const [periodo] = await res.json()
  return periodo || null
}

async function fetchConfigActiva(env, headers, operador, empleadoId) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?empleado_id=eq.${empleadoId}` +
    `&activo=eq.true${nominaTenantFilter(operador.cuenta_id)}&select=horas_jornada&limit=1`,
    { headers }
  )
  if (!res.ok) return null
  const [config] = await res.json()
  return config || null
}

async function fetchFeriadoDelDia(env, headers, operador, fecha) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_feriados?fecha=eq.${fecha}` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=id,fecha,nombre,tipo,laborable&limit=1`,
    { headers },
  )
  if (!res.ok) return { error: true, row: null }
  const [feriado] = await res.json()
  return { error: false, row: feriado || null }
}

async function validarFeriadoSolicitado(env, headers, operador, fecha, solicitado) {
  if (!solicitado) return { error: false, row: null }
  return fetchFeriadoDelDia(env, headers, operador, fecha)
}

// GET /api/nomina/marcaje/hoy
// Devuelve solo asistencia operativa del día del servidor; nunca salario.
export async function handleGetMarcajeHoy(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  const { fecha } = nowInNominaZone(env)
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/registro_asistencia?fecha=eq.${fecha}` +
    `${nominaTenantFilter(operador.cuenta_id)}` +
    '&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,estado_marcaje,entrada_marcada_en,salida_marcada_en,nota',
    { headers }
  )
  if (!res.ok) return jsonError('Error al leer marcaje del día', 500, request)
  return json({ fecha, registros: await res.json() ?? [] }, 200, request)
}

// POST /api/nomina/marcaje/entrada  Body: { empleadoId, idempotencyKey, nota? }
export async function handleMarcarEntrada(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (operador.rol !== 'logistica') return jsonError('Solo logística puede marcar entradas', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, idempotencyKey, nota } = body || {}
  if (!empleadoId || !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (!idempotencyKeyValida(idempotencyKey)) return jsonError('idempotencyKey inválida', 400, request)
  if (!textoNominaValido(nota, 500)) return jsonError('nota inválida', 400, request)

  const marca = nowInNominaZone(env)
  const periodo = await periodoBloqueadoParaFecha(env, headers, operador, marca.fecha)
  if (periodo) return jsonError(`No se puede marcar: el período está ${periodo.estado}`, 400, request)
  const config = await fetchConfigActiva(env, headers, operador, empleadoId)
  if (!config) return jsonError('El empleado no tiene configuración activa de nómina', 400, request)
  const feriado = await fetchFeriadoDelDia(env, headers, operador, marca.fecha)
  if (feriado.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)

  const existente = await fetchRegistroDelDia(env, headers, operador, empleadoId, marca.fecha)
  if (existente.error) return jsonError('Error al leer asistencia del día', 500, request)
  if (existente.row?.entrada_idempotency_key === idempotencyKey.trim()) {
    return json({ ok: true, idempotente: true, registro: existente.row }, 200, request)
  }
  if (existente.row?.hora_entrada) return jsonError('El empleado ya tiene entrada marcada hoy', 409, request)

  const fila = {
    empleado_id: empleadoId,
    fecha: marca.fecha,
    hora_entrada: marca.hora,
    hora_salida: null,
    horas_trabajadas: 0,
    horas_normales: 0,
    horas_extra: 0,
    es_sabado: new Date(`${marca.fecha}T12:00:00`).getDay() === 6,
    es_domingo: new Date(`${marca.fecha}T12:00:00`).getDay() === 0,
    es_feriado: !!feriado.row,
    es_ausencia: false,
    estado_marcaje: 'entrada',
    entrada_marcada_en: marca.marcadoEn,
    entrada_por: operador.id,
    entrada_idempotency_key: idempotencyKey.trim(),
    nota: nota || null,
    registrado_por: operador.id,
    cuenta_id: operador.cuenta_id,
  }
  const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia`, {
    method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify(fila),
  })
  if (!insRes.ok) return jsonError('No se pudo registrar la entrada', 409, request)
  const [registro] = await insRes.json()
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA', accion: 'MARCAR_ENTRADA', entidadTipo: 'registro_asistencia',
    entidadId: registro?.id || null, meta: { empleadoId, fecha: marca.fecha }, ip,
  }).catch(() => {})
  return json({ ok: true, idempotente: false, registro }, 201, request)
}

// POST /api/nomina/marcaje/salida  Body: { empleadoId, idempotencyKey, nota? }
export async function handleMarcarSalida(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (operador.rol !== 'logistica') return jsonError('Solo logística puede marcar salidas', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, idempotencyKey, nota } = body || {}
  if (!empleadoId || !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (!idempotencyKeyValida(idempotencyKey)) return jsonError('idempotencyKey inválida', 400, request)
  if (!textoNominaValido(nota, 500)) return jsonError('nota inválida', 400, request)

  const marca = nowInNominaZone(env)
  const periodo = await periodoBloqueadoParaFecha(env, headers, operador, marca.fecha)
  if (periodo) return jsonError(`No se puede marcar: el período está ${periodo.estado}`, 400, request)
  const config = await fetchConfigActiva(env, headers, operador, empleadoId)
  if (!config) return jsonError('El empleado no tiene configuración activa de nómina', 400, request)
  const feriado = await fetchFeriadoDelDia(env, headers, operador, marca.fecha)
  if (feriado.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)
  const existente = await fetchRegistroDelDia(env, headers, operador, empleadoId, marca.fecha)
  if (existente.error) return jsonError('Error al leer asistencia del día', 500, request)
  if (!existente.row?.hora_entrada) return jsonError('No existe una entrada marcada hoy', 409, request)
  if (existente.row.salida_idempotency_key === idempotencyKey.trim()) {
    return json({ ok: true, idempotente: true, registro: existente.row }, 200, request)
  }
  if (existente.row.hora_salida) return jsonError('El empleado ya tiene salida marcada hoy', 409, request)
  if (existente.row.hora_entrada === marca.hora) return jsonError('La salida no puede ser igual a la entrada', 400, request)

  let calc
  try {
    calc = calcularCamposAsistencia(
      marca.fecha, existente.row.hora_entrada, marca.hora,
      Number(config.horas_jornada) || 8, !!(existente.row.es_feriado || feriado.row), false
    )
  } catch (err) {
    return jsonError(err.message || 'Horas inválidas', 400, request)
  }
  const upRes = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${existente.row.id}` +
    nominaTenantFilter(operador.cuenta_id), {
    method: 'PATCH', headers: { ...svcHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify({
      ...calc,
      hora_salida: marca.hora,
      estado_marcaje: 'completo',
      salida_marcada_en: marca.marcadoEn,
      salida_por: operador.id,
      salida_idempotency_key: idempotencyKey.trim(),
      registrado_por: operador.id,
      nota: nota || existente.row.nota || null,
    }),
  })
  if (!upRes.ok) return jsonError('No se pudo registrar la salida', 409, request)
  const [registro] = await upRes.json()
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA', accion: 'MARCAR_SALIDA', entidadTipo: 'registro_asistencia',
    entidadId: existente.row.id, meta: { empleadoId, fecha: marca.fecha }, ip,
  }).catch(() => {})
  return json({ ok: true, idempotente: false, registro }, 200, request)
}

// GET /api/nomina/calendario/feriados?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
export async function handleGetFeriados(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  const url = new URL(request.url)
  const desde = url.searchParams.get('desde')
  const hasta = url.searchParams.get('hasta')
  if (!fechaNominaValida(desde) || !fechaNominaValida(hasta)) {
    return jsonError('Rango de fechas inválido', 400, request)
  }
  const inicio = new Date(`${desde}T12:00:00Z`)
  const fin = new Date(`${hasta}T12:00:00Z`)
  if (fin < inicio || (fin - inicio) > 31 * 86400000) {
    return jsonError('El rango debe estar entre 0 y 31 días', 400, request)
  }

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_feriados?fecha=gte.${desde}&fecha=lte.${hasta}` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=id,fecha,nombre,tipo,laborable&order=fecha.asc`,
    { headers }
  )
  if (!res.ok) return jsonError('Error al leer feriados', 500, request)
  return json(await res.json() ?? [], 200, request)
}

// POST /api/nomina/calendario/feriados/crear
export async function handleCrearFeriado(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { fecha, nombre, tipo, laborable } = body || {}
  if (!fechaNominaValida(fecha)) return jsonError('fecha inválida', 400, request)
  if (!booleanNominaValido(laborable)) return jsonError('laborable inválido', 400, request)
  if (!nombre?.trim() || !textoNominaValido(nombre, 160)) return jsonError('nombre obligatorio o demasiado largo', 400, request)
  if (tipo !== undefined && !['nacional', 'regional', 'empresa'].includes(tipo)) {
    return jsonError('tipo de feriado inválido', 400, request)
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_feriados`, {
    method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify({
      fecha, nombre: nombre.trim(), tipo: tipo || 'empresa', laborable: laborable === true,
      cuenta_id: operador.cuenta_id, creado_por: operador.id,
    }),
  })
  if (!res.ok) return jsonError('Error al crear feriado', 409, request)
  const [feriado] = await res.json()
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA', accion: 'CREAR_FERIADO', entidadTipo: 'nomina_feriado',
    entidadId: feriado?.id || null, meta: { fecha, nombre: nombre.trim() }, ip,
  }).catch(() => {})
  return json({ ok: true, feriado }, 201, request)
}

// GET /api/nomina/calendario/horarios?empleadoId=UUID
export async function handleGetHorarios(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const url = new URL(request.url)
  const empleadoId = url.searchParams.get('empleadoId')
  if (empleadoId && !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)

  const empleadoFilter = empleadoId ? `&empleado_id=eq.${empleadoId}` : ''
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_horarios?order=dia_semana.asc${nominaTenantFilter(operador.cuenta_id)}` +
    `${empleadoFilter}&select=id,empleado_id,dia_semana,semana_ciclo,grupo_rotacion,fecha_desde,fecha_hasta,hora_inicio,hora_fin,horas_jornada,trabaja&limit=500`,
    { headers }
  )
  if (!res.ok) return jsonError('Error al leer horarios', 500, request)
  return json(await res.json() ?? [], 200, request)
}

// POST /api/nomina/calendario/horarios/crear
export async function handleCrearHorario(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const {
    empleadoId, diaSemana, semanaCiclo, grupoRotacion, fechaDesde, fechaHasta,
    horaInicio, horaFin, horasJornada, trabaja,
  } = body || {}
  if (empleadoId && !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (!booleanNominaValido(trabaja)) return jsonError('trabaja inválido', 400, request)
  if (!Number.isInteger(Number(diaSemana)) || Number(diaSemana) < 0 || Number(diaSemana) > 6) {
    return jsonError('diaSemana inválido', 400, request)
  }
  if (!fechaNominaValida(fechaDesde) || (fechaHasta && !fechaNominaValida(fechaHasta))) {
    return jsonError('Vigencia de fechas inválida', 400, request)
  }
  if (fechaHasta && fechaHasta < fechaDesde) return jsonError('fechaHasta anterior a fechaDesde', 400, request)
  if (!textoNominaValido(grupoRotacion, 80)) return jsonError('grupoRotacion inválido', 400, request)
  if (!horaNominaValida(horaInicio) || !horaNominaValida(horaFin)) return jsonError('Horario inválido', 400, request)
  if (!(Number(horasJornada) > 0 && Number(horasJornada) <= 24)) return jsonError('horasJornada inválida', 400, request)
  if (semanaCiclo !== undefined && semanaCiclo !== null &&
      (!Number.isInteger(Number(semanaCiclo)) || Number(semanaCiclo) < 1 || Number(semanaCiclo) > 5)) {
    return jsonError('semanaCiclo inválida', 400, request)
  }

  if (empleadoId) {
    const empleadoRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${empleadoId}` +
      `${nominaTenantFilter(operador.cuenta_id)}&select=id,tipo_cliente&limit=1`,
      { headers: svcHeaders(env, 'return=minimal') },
    )
    if (!empleadoRes.ok) return jsonError('No se pudo verificar el empleado', 500, request)
    const [empleado] = await empleadoRes.json()
    if (!empleado) return jsonError('Empleado no encontrado', 404, request)
    if (empleado.tipo_cliente !== 'personal') return jsonError('El horario solo puede asignarse a personal', 400, request)
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_horarios`, {
    method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify({
      empleado_id: empleadoId || null,
      dia_semana: Number(diaSemana), semana_ciclo: semanaCiclo ?? null,
      grupo_rotacion: grupoRotacion || null, fecha_desde: fechaDesde, fecha_hasta: fechaHasta || null,
      hora_inicio: horaInicio, hora_fin: horaFin, horas_jornada: Number(horasJornada),
      trabaja: trabaja !== false, cuenta_id: operador.cuenta_id, creado_por: operador.id,
    }),
  })
  if (!res.ok) return jsonError('Error al crear horario', 409, request)
  const [horario] = await res.json()
  return json({ ok: true, horario }, 201, request)
}

// POST /api/nomina/asistencia/registrar
// Body: { empleadoId, fecha, horaEntrada, horaSalida, esFeriado, esAusencia, nota }
export async function handleRegistrarAsistencia(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, fecha, horaEntrada, horaSalida, esFeriado, esAusencia, nota } = body

  if (!empleadoId || !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (!booleanNominaValido(esFeriado) || !booleanNominaValido(esAusencia)) {
    return jsonError('esFeriado y esAusencia deben ser booleanos', 400, request)
  }
  if (!fechaNominaValida(fecha)) return jsonError('fecha inválida (YYYY-MM-DD)', 400, request)
  if (!horasEntradaSalidaValidas(horaEntrada, horaSalida)) return jsonError('Debe indicar entrada y salida válidas (HH:MM)', 400, request)
  if (!textoNominaValido(nota, 500)) return jsonError('nota inválida', 400, request)

  // Bloquear edición si la fecha cae en un período ya cerrado o pagado
  const perFiltro = nominaTenantFilter(operador.cuenta_id)
  const perRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?desde=lte.${fecha}&hasta=gte.${fecha}` +
    `&estado=neq.abierto${perFiltro}&select=id,nombre,estado&limit=1`,
    { headers }
  )
  if (perRes.ok) {
    const [per] = await perRes.json()
    if (per) return jsonError(`No se puede editar asistencia: el período "${per.nombre}" está ${per.estado}`, 400, request)
  }

  const feriado = await validarFeriadoSolicitado(env, headers, operador, fecha, esFeriado)
  if (feriado.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)
  if (esFeriado && !feriado.row) return jsonError('El feriado debe estar registrado en el calendario laboral', 400, request)

  // Jornada del empleado para calcular horas normales/extra
  const cfgRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?empleado_id=eq.${empleadoId}` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=horas_jornada&limit=1`,
    { headers }
  )
  const [cfgEmp] = cfgRes.ok ? await cfgRes.json() : []
  if (!cfgEmp) return jsonError('El empleado no tiene configuración de nómina', 400, request)

  let calc
  try {
    calc = calcularCamposAsistencia(
      fecha, horaEntrada || null, horaSalida || null,
      Number(cfgEmp.horas_jornada) || 8,
      !!(feriado.row || esFeriado), !!esAusencia
    )
  } catch (err) {
    return jsonError(err.message || 'Horas inválidas', 400, request)
  }

  // Upsert por (empleado_id, fecha)
  const upRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/registro_asistencia?on_conflict=empleado_id,fecha`,
    {
      method: 'POST',
      headers: { ...svcHeaders(env), Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        empleado_id:    empleadoId,
        fecha,
        hora_entrada:   (esAusencia ? null : horaEntrada) || null,
        hora_salida:    (esAusencia ? null : horaSalida)  || null,
        ...calc,
        nota:           nota || null,
        registrado_por: operador.id,
        cuenta_id:      operador.cuenta_id || null,
      }),
    }
  )
  if (!upRes.ok) {
    const err = await upRes.text()
    console.error('[nomina] registrar asistencia upstream error', upRes.status, err.slice(0, 500))
    return jsonError('No se pudo registrar la asistencia', 500, request)
  }
  const [row] = await upRes.json()
  return json({ ok: true, registro: row }, 200, request)
}

// POST /api/nomina/asistencia/registrar-masivo
// Body: { fecha, horaEntrada, horaSalida, esFeriado, empleadoIds? }
export async function handleRegistrarAsistenciaMasivo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { fecha, horaEntrada, horaSalida, esFeriado, empleadoIds } = body
  if (!booleanNominaValido(esFeriado)) return jsonError('esFeriado inválido', 400, request)
  if (!fechaNominaValida(fecha)) return jsonError('fecha inválida (YYYY-MM-DD)', 400, request)
  if (!horasEntradaSalidaValidas(horaEntrada, horaSalida)) return jsonError('Debe indicar entrada y salida válidas (HH:MM)', 400, request)
  if (!Array.isArray(empleadoIds) && empleadoIds !== undefined) return jsonError('empleadoIds inválidos', 400, request)
  if (Array.isArray(empleadoIds) && empleadoIds.some(id => !isValidUuid(id))) return jsonError('empleadoIds inválidos', 400, request)

  // Período cerrado → bloquear
  const perFiltro = nominaTenantFilter(operador.cuenta_id)
  const perRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?desde=lte.${fecha}&hasta=gte.${fecha}` +
    `&estado=neq.abierto${perFiltro}&select=nombre,estado&limit=1`,
    { headers }
  )
  if (perRes.ok) {
    const [per] = await perRes.json()
    if (per) return jsonError(`No se puede editar asistencia: el período "${per.nombre}" está ${per.estado}`, 400, request)
  }

  const feriado = await validarFeriadoSolicitado(env, headers, operador, fecha, esFeriado)
  if (feriado.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)
  if (esFeriado && !feriado.row) return jsonError('El feriado debe estar registrado en el calendario laboral', 400, request)

  // Empleados destino
  const cuentaFilter = nominaTenantFilter(operador.cuenta_id)
  const idsFilter = Array.isArray(empleadoIds) && empleadoIds.length > 0
    ? `&empleado_id=in.(${empleadoIds.filter(isValidUuid).join(',')})`
    : ''
  const cfgRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?activo=eq.true${cuentaFilter}${idsFilter}` +
    `&select=empleado_id,horas_jornada`,
    { headers }
  )
  if (!cfgRes.ok) return jsonError('Error al leer empleados', 500, request)
  const empleados = await cfgRes.json()
  if (!empleados.length) return jsonError('No hay empleados activos con configuración de nómina', 400, request)

  let filas
  try {
    filas = empleados.map(e => ({
      empleado_id:    e.empleado_id,
      fecha,
      hora_entrada:   horaEntrada || null,
      hora_salida:    horaSalida  || null,
      ...calcularCamposAsistencia(fecha, horaEntrada || null, horaSalida || null, Number(e.horas_jornada) || 8, !!(feriado.row || esFeriado), false),
      registrado_por: operador.id,
      cuenta_id:      operador.cuenta_id || null,
    }))
  } catch (err) {
    return jsonError(err.message || 'Horas inválidas', 400, request)
  }

  const insRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/registro_asistencia?on_conflict=empleado_id,fecha`,
    {
      method: 'POST',
      headers: { ...svcHeaders(env, 'resolution=merge-duplicates,return=minimal') },
      body: JSON.stringify(filas),
    }
  )
  if (!insRes.ok) {
    const err = await insRes.text()
    console.error('[nomina] registrar asistencia masiva upstream error', insRes.status, err.slice(0, 500))
    return jsonError('No se pudo registrar la asistencia masiva', 500, request)
  }

  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA', accion: 'ASISTENCIA_MASIVA',
    entidadTipo: 'registro_asistencia', entidadId: null,
    meta: { fecha, empleados: filas.length, hora_entrada: horaEntrada, hora_salida: horaSalida }, ip,
  }).catch(() => {})

  return json({ ok: true, registros: filas.length }, 200, request)
}

// POST /api/nomina/asistencia/eliminar  Body: { id }
export async function handleEliminarAsistencia(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { id } = body
  if (!id || !isValidUuid(id)) return jsonError('id inválido', 400, request)

  // Verificar que la fecha no esté en período cerrado
  const regRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${id}` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=fecha&limit=1`,
    { headers }
  )
  const [reg] = regRes.ok ? await regRes.json() : []
  if (!reg) return jsonError('Registro no encontrado', 404, request)

  const perFiltro = nominaTenantFilter(operador.cuenta_id)
  const perRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?desde=lte.${reg.fecha}&hasta=gte.${reg.fecha}` +
    `&estado=neq.abierto${perFiltro}&select=nombre,estado&limit=1`,
    { headers }
  )
  if (perRes.ok) {
    const [per] = await perRes.json()
    if (per) return jsonError(`No se puede eliminar: el período "${per.nombre}" está ${per.estado}`, 400, request)
  }

  const delRes = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${id}` +
    nominaTenantFilter(operador.cuenta_id), {
    method: 'DELETE', headers: svcHeaders(env, 'return=minimal'),
  })
  if (!delRes.ok) return jsonError('Error al eliminar registro', 500, request)
  return json({ ok: true }, 200, request)
}

// ─── Períodos ──────────────────────────────────────────────────────────────────

// GET /api/nomina/conceptos
export async function handleGetConceptos(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_NOMINA.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_conceptos?activo=eq.true` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=id,codigo,nombre,tipo,imponible,obligatorio,moneda_default,formula_key,fecha_desde,fecha_hasta&order=codigo.asc&limit=500`,
    { headers }
  )
  if (!res.ok) return jsonError('Error al leer conceptos', 500, request)
  return json(await res.json() ?? [], 200, request)
}

// POST /api/nomina/conceptos/crear
export async function handleCrearConcepto(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  let concepto
  try {
    concepto = normalizarConcepto(body)
  } catch (err) {
    return jsonError(err.message || 'Concepto inválido', 400, request)
  }
  if (!fechaNominaValida(concepto.fecha_desde) || (concepto.fecha_hasta && !fechaNominaValida(concepto.fecha_hasta)) ||
      (concepto.fecha_hasta && concepto.fecha_hasta < concepto.fecha_desde)) {
    return jsonError('Vigencia del concepto inválida', 400, request)
  }
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_conceptos`, {
    method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify({ ...concepto, cuenta_id: operador.cuenta_id, creado_por: operador.id }),
  })
  if (!res.ok) return jsonError('Error al crear concepto', 409, request)
  const [row] = await res.json()
  return json({ ok: true, concepto: row }, 201, request)
}

// GET /api/nomina/tasas-snapshots?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
export async function handleGetTasasSnapshots(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_NOMINA.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const url = new URL(request.url)
  const desde = url.searchParams.get('desde')
  const hasta = url.searchParams.get('hasta')
  if (!fechaNominaValida(desde) || !fechaNominaValida(hasta)) return jsonError('Rango de fechas inválido', 400, request)
  const inicio = new Date(`${desde}T12:00:00Z`)
  const fin = new Date(`${hasta}T12:00:00Z`)
  if (fin < inicio || fin - inicio > 31 * 86400000) return jsonError('El rango debe estar entre 0 y 31 días', 400, request)
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_tasas_snapshot?fecha=gte.${desde}&fecha=lte.${hasta}` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=id,fecha,moneda_origen,moneda_destino,valor,fuente,observado_en,aprobado,periodo_id&order=fecha.desc&limit=500`,
    { headers }
  )
  if (!res.ok) return jsonError('Error al leer snapshots de tasa', 500, request)
  return json(await res.json() ?? [], 200, request)
}

// POST /api/nomina/tasas-snapshots/crear
export async function handleCrearTasaSnapshot(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  if (!fechaNominaValida(body?.fecha)) return jsonError('fecha inválida', 400, request)
  if (body.observadoEn && (typeof body.observadoEn !== 'string' || Number.isNaN(Date.parse(body.observadoEn)))) {
    return jsonError('observadoEn inválido', 400, request)
  }
  let tasa
  try { tasa = normalizarTasa(body) } catch (err) { return jsonError(err.message || 'Tasa inválida', 400, request) }
  if (body.periodoId && !isValidUuid(body.periodoId)) return jsonError('periodoId inválido', 400, request)
  if (body.periodoId) {
    const periodoRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${body.periodoId}` +
      `${nominaTenantFilter(operador.cuenta_id)}&select=id&limit=1`,
      { headers },
    )
    if (!periodoRes.ok) return jsonError('No se pudo verificar el período de la tasa', 500, request)
    const [periodo] = await periodoRes.json()
    if (!periodo) return jsonError('Período no encontrado', 404, request)
  }
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_tasas_snapshot`, {
    method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify({
      fecha: body.fecha, ...tasa, observado_en: body.observadoEn || new Date().toISOString(),
      aprobado: false, periodo_id: body.periodoId || null, cuenta_id: operador.cuenta_id,
    }),
  })
  if (!res.ok) return jsonError('Error al crear snapshot de tasa', 409, request)
  const [snapshot] = await res.json()
  return json({ ok: true, snapshot, requiere_aprobacion: true }, 201, request)
}

// GET /api/nomina/reglas-legales
export async function handleGetReglasLegales(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_NOMINA.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_reglas_legal?order=codigo.asc,fecha_desde.desc` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=id,codigo,nombre,tipo,valor,unidad,formula_key,base_key,fecha_desde,fecha_hasta,version,fuente,aprobado_por,aprobado_en,activo&limit=500`,
    { headers }
  )
  if (!res.ok) return jsonError('Error al leer reglas legales', 500, request)
  return json(await res.json() ?? [], 200, request)
}

// POST /api/nomina/reglas-legales/crear
// Las reglas nuevas nacen inactivas; no se pueden usar para cerrar nómina.
export async function handleCrearReglaLegal(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  let regla
  try {
    regla = normalizarReglaLegal(body)
  } catch (err) {
    return jsonError(err.message || 'Regla legal inválida', 400, request)
  }
  if (!fechaNominaValida(regla.fecha_desde) || (regla.fecha_hasta && !fechaNominaValida(regla.fecha_hasta)) ||
      (regla.fecha_hasta && regla.fecha_hasta < regla.fecha_desde)) {
    return jsonError('Vigencia legal inválida', 400, request)
  }
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_reglas_legal`, {
    method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify({ ...regla, cuenta_id: operador.cuenta_id, creado_por: operador.id }),
  })
  if (!res.ok) return jsonError('Error al crear regla legal', 409, request)
  const [row] = await res.json()
  return json({ ok: true, regla: row, requiere_aprobacion: true }, 201, request)
}

// GET /api/nomina/periodos
export async function handleGetPeriodos(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_NOMINA.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  const cuentaFilter = nominaTenantFilter(operador.cuenta_id)
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?order=desde.desc${cuentaFilter}&select=*&limit=500`,
    { headers }
  )
  if (!res.ok) return jsonError('Error al leer períodos', 500, request)
  const periodos = await res.json()

  // Adjuntar totales por período (una sola query de líneas)
  if (periodos.length > 0) {
    const ids = periodos.map(p => p.id).join(',')
    const lRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=in.(${ids})` +
      cuentaFilter +
      `&select=periodo_id,total_bruto_usd,total_neto_usd,pagado`,
      { headers }
    )
    if (lRes.ok) {
      const lineas = await lRes.json()
      const agg = new Map()
      for (const l of lineas) {
        const a = agg.get(l.periodo_id) || { empleados: 0, bruto: 0, neto: 0, pagados: 0 }
        a.empleados += 1
        a.bruto += Number(l.total_bruto_usd || 0)
        a.neto  += Number(l.total_neto_usd  || 0)
        if (l.pagado) a.pagados += 1
        agg.set(l.periodo_id, a)
      }
      for (const p of periodos) {
        const a = agg.get(p.id) || { empleados: 0, bruto: 0, neto: 0, pagados: 0 }
        p.total_empleados   = a.empleados
        p.total_bruto_usd   = r4(a.bruto)
        p.total_neto_usd    = r4(a.neto)
        p.lineas_pagadas    = a.pagados
      }
    }
  }

  return json(periodos ?? [], 200, request)
}

// POST /api/nomina/periodos/crear  Body: { nombre, desde, hasta, tipo }
export async function handleCrearPeriodo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { nombre, desde, hasta, tipo } = body
  if (!nombre?.trim() || !textoNominaValido(nombre, 160)) return jsonError('El nombre es obligatorio o demasiado largo', 400, request)
  if (!fechaNominaValida(desde) || !fechaNominaValida(hasta)) return jsonError('Fechas inválidas', 400, request)
  if (hasta < desde) return jsonError('La fecha final debe ser posterior a la inicial', 400, request)
  const rangoPeriodo = new Date(`${hasta}T12:00:00Z`) - new Date(`${desde}T12:00:00Z`)
  if (rangoPeriodo > 30 * 86400000) return jsonError('El período no puede superar 31 días', 400, request)

  // Validar solapamiento con otros períodos del tenant
  const cuentaFilter = nominaTenantFilter(operador.cuenta_id)
  const solapRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?desde=lte.${hasta}&hasta=gte.${desde}` +
    `${cuentaFilter}&select=id,nombre&limit=1`,
    { headers }
  )
  if (solapRes.ok) {
    const [solap] = await solapRes.json()
    if (solap) return jsonError(`Las fechas se solapan con el período "${solap.nombre}"`, 400, request)
  }

  const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos`, {
    method: 'POST', headers: svcHeaders(env),
    body: JSON.stringify({
      nombre: nombre.trim(),
      desde, hasta,
      tipo: ['semanal', 'quincenal', 'mensual'].includes(tipo) ? tipo : 'semanal',
      estado: 'abierto',
      cuenta_id: operador.cuenta_id || null,
    }),
  })
  if (!insRes.ok) {
    const err = await insRes.text()
    console.error('[nomina] crear período upstream error', insRes.status, err.slice(0, 500))
    return jsonError('No se pudo crear el período', 500, request)
  }
  const [row] = await insRes.json()
  return json({ ok: true, periodo: row }, 201, request)
}

// POST /api/nomina/periodos/calcular  Body: { periodoId }
// Genera/recalcula las líneas del período desde la asistencia registrada.
// Preserva bonos/deducciones ya ajustados manualmente.
export async function handleCalcularPeriodo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { periodoId } = body
  if (!periodoId || !isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)

  // 1. Período
  const pRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=*&limit=1`,
    { headers }
  )
  const [periodo] = pRes.ok ? await pRes.json() : []
  if (!periodo) return jsonError('Período no encontrado', 404, request)
  if (periodo.estado !== 'abierto') return jsonError(`El período está ${periodo.estado}; reábrelo para recalcular`, 400, request)

  // 2. Empleados activos + factores + asistencia del rango (en paralelo)
  const cuentaFilter = nominaTenantFilter(operador.cuenta_id)
  const [cfgRes, configNomina, aRes, prevRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?activo=eq.true${cuentaFilter}&select=*`, { headers }),
    fetchConfigNomina(env, headers, operador.cuenta_id),
    fetch(
      `${env.SUPABASE_URL}/rest/v1/registro_asistencia` +
      `?fecha=gte.${periodo.desde}&fecha=lte.${periodo.hasta}${cuentaFilter}` +
      `&select=empleado_id,fecha,horas_normales,horas_extra,es_sabado,es_domingo,es_feriado,es_ausencia`,
      { headers }
    ),
    fetch(
      `${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}` +
      cuentaFilter +
      `&select=empleado_id,bonos_usd,deducciones_usd,nota_bonos,nota_deducciones,pagado`,
      { headers }
    ),
  ])

  if (!cfgRes.ok) return jsonError('Error al leer empleados', 500, request)
  if (!aRes.ok)   return jsonError('Error al leer asistencia', 500, request)
  if (!prevRes.ok) return jsonError('Error al leer líneas existentes', 500, request)

  const empleados   = await cfgRes.json()
  const asistencias = await aRes.json()
  const previas     = prevRes.ok ? await prevRes.json() : []

  if (empleados.length === 0) return jsonError('No hay empleados activos con configuración de nómina', 400, request)

  // Índices para lookup O(1)
  const porEmpleado = new Map()
  for (const a of asistencias) {
    if (!porEmpleado.has(a.empleado_id)) porEmpleado.set(a.empleado_id, [])
    porEmpleado.get(a.empleado_id).push(a)
  }
  const ajustesPrevios = new Map(previas.map(l => [l.empleado_id, l]))

  // 3. Construir las líneas
  const lineas = empleados.map(cfg => {
    const asis  = porEmpleado.get(cfg.empleado_id) || []
    const prev  = ajustesPrevios.get(cfg.empleado_id) || {}
    const calc  = calcularLineaNomina(
      asis, cfg, configNomina,
      Number(prev.bonos_usd || 0),
      Number(prev.deducciones_usd || 0)
    )
    return {
      periodo_id:       periodoId,
      empleado_id:      cfg.empleado_id,
      ...calc,
      nota_bonos:       prev.nota_bonos       || null,
      nota_deducciones: prev.nota_deducciones || null,
      cuenta_id:        operador.cuenta_id || null,
    }
  })

  // 4. Upsert no destructivo: las líneas pagadas quedan intactas. Primero se
  // escriben las líneas activas y solo después se eliminan líneas obsoletas;
  // un fallo de inserción no deja el período vacío.
  const idsPagados = new Set(previas.filter(l => l.pagado).map(l => l.empleado_id))
  const empleadosActivos = new Set(empleados.map(e => e.empleado_id))
  const idsObsoletos = previas
    .filter(l => !l.pagado && !empleadosActivos.has(l.empleado_id))
    .map(l => l.empleado_id)
  const aInsertar = lineas.filter(l => !idsPagados.has(l.empleado_id))

  if (aInsertar.length > 0) {
    const insRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?on_conflict=periodo_id,empleado_id`, {
      method: 'POST', headers: svcHeaders(env, 'resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify(aInsertar),
    })
    if (!insRes.ok) {
      const err = await insRes.text()
      console.error('[nomina] generar líneas upstream error', insRes.status, err.slice(0, 500))
      return jsonError('No se pudieron generar las líneas de nómina', 500, request)
    }
  }

  if (idsObsoletos.length > 0) {
    const deleteRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}` +
      `${cuentaFilter}&empleado_id=in.(${idsObsoletos.join(',')})`,
      { method: 'DELETE', headers: svcHeaders(env, 'return=minimal') },
    )
    if (!deleteRes.ok) return jsonError('No se pudieron retirar líneas obsoletas', 500, request)
  }

  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA', accion: 'CALCULAR_PERIODO',
    entidadTipo: 'nomina_periodo', entidadId: periodoId,
    meta: { periodo: periodo.nombre, lineas: aInsertar.length, preservadas: idsPagados.size, obsoletas: idsObsoletos.length }, ip,
  }).catch(() => {})

  return json({
    ok: true,
    lineas_generadas: aInsertar.length,
    lineas_preservadas: idsPagados.size,
  }, 200, request)
}

// POST /api/nomina/periodos/cerrar  Body: { periodoId }
export async function handleCerrarPeriodo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { periodoId } = body
  if (!periodoId || !isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)

  const pRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=id,nombre,estado&limit=1`,
    { headers }
  )
  const [periodo] = pRes.ok ? await pRes.json() : []
  if (!periodo) return jsonError('Período no encontrado', 404, request)
  if (periodo.estado !== 'abierto') return jsonError(`El período ya está ${periodo.estado}`, 400, request)

  // Debe tener líneas calculadas
  const lRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=id&limit=1`,
    { headers }
  )
  const lineas = lRes.ok ? await lRes.json() : []
  if (lineas.length === 0) return jsonError('Calcula la nómina antes de cerrar el período', 400, request)

  const upRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}` +
    nominaTenantFilter(operador.cuenta_id), {
    method: 'PATCH', headers: svcHeaders(env, 'return=minimal'),
    body: JSON.stringify({
      estado: 'cerrado',
      cerrado_en: new Date().toISOString(),
      cerrado_por: operador.id,
    }),
  })
  if (!upRes.ok) return jsonError('Error al cerrar período', 500, request)

  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA', accion: 'CERRAR_PERIODO',
    entidadTipo: 'nomina_periodo', entidadId: periodoId,
    meta: { periodo: periodo.nombre }, ip,
  }).catch(() => {})

  return json({ ok: true }, 200, request)
}

// POST /api/nomina/periodos/reabrir  Body: { periodoId }
export async function handleReabrirPeriodo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { periodoId } = body
  if (!periodoId || !isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)

  const pRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=id,nombre,estado&limit=1`,
    { headers }
  )
  const [periodo] = pRes.ok ? await pRes.json() : []
  if (!periodo) return jsonError('Período no encontrado', 404, request)
  if (periodo.estado === 'abierto') return jsonError('El período ya está abierto', 400, request)
  if (periodo.estado === 'pagado')  return jsonError('No se puede reabrir un período ya pagado', 400, request)

  // Bloquear si hay líneas pagadas
  const lRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}` +
    `${nominaTenantFilter(operador.cuenta_id)}&pagado=eq.true&select=id&limit=1`,
    { headers }
  )
  const pagadas = lRes.ok ? await lRes.json() : []
  if (pagadas.length > 0) return jsonError('Hay recibos ya pagados en este período. Revierte los pagos antes de reabrir.', 400, request)

  const upRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}` +
    nominaTenantFilter(operador.cuenta_id), {
    method: 'PATCH', headers: svcHeaders(env, 'return=minimal'),
    body: JSON.stringify({ estado: 'abierto', cerrado_en: null, cerrado_por: null }),
  })
  if (!upRes.ok) return jsonError('Error al reabrir período', 500, request)

  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA', accion: 'REABRIR_PERIODO',
    entidadTipo: 'nomina_periodo', entidadId: periodoId,
    meta: { periodo: periodo.nombre }, ip,
  }).catch(() => {})

  return json({ ok: true }, 200, request)
}

// ─── Líneas ────────────────────────────────────────────────────────────────────

// GET /api/nomina/lineas?periodoId=UUID
export async function handleGetLineas(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_NOMINA.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  const url = new URL(request.url)
  const periodoId = url.searchParams.get('periodoId')
  if (!periodoId || !isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}` +
    `${nominaTenantFilter(operador.cuenta_id)}` +
    `&select=*,empleado:clientes!empleado_id(id,nombre,rif,telefono)` +
    `&order=empleado(nombre).asc&limit=1000`,
    { headers }
  )
  if (!res.ok) return jsonError('Error al leer líneas', 500, request)
  return json(await res.json() ?? [], 200, request)
}

// POST /api/nomina/lineas/ajustar
// Body: { lineaId, bonosUsd, deduccionesUsd, notaBonos, notaDeducciones }
export async function handleAjustarLinea(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { lineaId, bonosUsd, deduccionesUsd, notaBonos, notaDeducciones } = body
  if (!lineaId || !isValidUuid(lineaId)) return jsonError('lineaId inválido', 400, request)

  const lRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=eq.${lineaId}` +
    `${nominaTenantFilter(operador.cuenta_id)}` +
    `&select=id,periodo_id,pagado,monto_normal_usd,monto_extra_usd,monto_sabado_usd,monto_feriado_usd&limit=1`,
    { headers }
  )
  const [linea] = lRes.ok ? await lRes.json() : []
  if (!linea) return jsonError('Línea no encontrada', 404, request)
  if (linea.pagado) return jsonError('No se puede ajustar un recibo ya pagado. Revierte el pago primero.', 400, request)

  // Período debe estar abierto
  const pRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${linea.periodo_id}` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=estado,nombre&limit=1`,
    { headers }
  )
  const [per] = pRes.ok ? await pRes.json() : []
  if (per && per.estado !== 'abierto') return jsonError(`El período "${per.nombre}" está ${per.estado}`, 400, request)

  if (!ajusteNominaValido(bonosUsd) || !ajusteNominaValido(deduccionesUsd)) {
    return jsonError('Bonos o deducciones inválidos', 400, request)
  }
  if (!textoNominaValido(notaBonos, 500) || !textoNominaValido(notaDeducciones, 500)) {
    return jsonError('Notas de ajuste inválidas', 400, request)
  }
  const bonos = Math.max(0, Number(bonosUsd) || 0)
  const deduc = Math.max(0, Number(deduccionesUsd) || 0)

  const base = Number(linea.monto_normal_usd  || 0)
             + Number(linea.monto_extra_usd   || 0)
             + Number(linea.monto_sabado_usd  || 0)
             + Number(linea.monto_feriado_usd || 0)
  const bruto = r4(base + bonos)
  const neto  = r4(Math.max(0, bruto - deduc))

  const upRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=eq.${lineaId}` +
    nominaTenantFilter(operador.cuenta_id), {
    method: 'PATCH', headers: svcHeaders(env),
    body: JSON.stringify({
      bonos_usd:        r4(bonos),
      deducciones_usd:  r4(deduc),
      total_bruto_usd:  bruto,
      total_neto_usd:   neto,
      nota_bonos:       notaBonos       || null,
      nota_deducciones: notaDeducciones || null,
    }),
  })
  if (!upRes.ok) return jsonError('Error al ajustar línea', 500, request)
  const [row] = await upRes.json()
  return json({ ok: true, linea: row }, 200, request)
}

// POST /api/nomina/lineas/pagar  Body: { lineaIds: [], referencia, nota }
export async function handlePagarLineas(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { lineaIds, referencia } = body
  const ids = Array.isArray(lineaIds) ? [...new Set(lineaIds.filter(isValidUuid))] : []
  if (ids.length === 0) return jsonError('No hay recibos seleccionados', 400, request)
  if (!textoNominaValido(referencia, 160)) return jsonError('Referencia de pago inválida', 400, request)

  // Validar que ninguna esté pagada y que el período esté cerrado
  const lRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=in.(${ids.join(',')})` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=id,periodo_id,pagado,total_neto_usd`,
    { headers }
  )
  if (!lRes.ok) return jsonError('Error al leer recibos', 500, request)
  const lineas = await lRes.json()
  if (lineas.length === 0) return jsonError('Recibos no encontrados', 404, request)
  if (lineas.length !== ids.length) return jsonError('Uno o más recibos no existen en esta cuenta', 404, request)
  if (lineas.some(l => l.pagado)) return jsonError('Alguno de los recibos ya está pagado', 400, request)

  const periodoIds = [...new Set(lineas.map(l => l.periodo_id))]
  const pRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=in.(${periodoIds.join(',')})` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=id,nombre,estado`,
    { headers }
  )
  if (!pRes.ok) return jsonError('Error al leer períodos', 500, request)
  const periodos = await pRes.json()
  const faltante = periodoIds.find(pid => !periodos.some(periodo => periodo.id === pid))
  if (faltante) return jsonError('Uno de los períodos no existe', 404, request)
  const abierto = periodos.find(p => p.estado === 'abierto')
  if (abierto) return jsonError(`Cierra el período "${abierto.nombre}" antes de pagar`, 400, request)

  const ahora = new Date().toISOString()
  const upRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=in.(${ids.join(',')})` +
    nominaTenantFilter(operador.cuenta_id) + '&pagado=eq.false', {
    method: 'PATCH', headers: svcHeaders(env, 'return=representation'),
    body: JSON.stringify({
      pagado:            true,
      pagado_en:         ahora,
      pagado_por:        operador.id,
      pagado_por_nombre: operador.nombre,
      referencia_pago:   referencia || null,
    }),
  })
  if (!upRes.ok) {
    const err = await upRes.text()
    console.error('[nomina] registrar pago upstream error', upRes.status, err.slice(0, 500))
    return jsonError('No se pudo registrar el pago', 500, request)
  }
  const actualizadas = await upRes.json()
  if (!Array.isArray(actualizadas) || actualizadas.length !== ids.length) {
    return jsonError('El estado de algún recibo cambió; vuelve a cargar e intenta de nuevo', 409, request)
  }

  // Si todas las líneas del período quedaron pagadas → marcar período como 'pagado'
  for (const pid of periodoIds) {
    const pendRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${pid}` +
      `${nominaTenantFilter(operador.cuenta_id)}&pagado=eq.false&select=id&limit=1`,
      { headers }
    )
    if (!pendRes.ok) return jsonError('No se pudo confirmar el estado del período', 500, request)
    const pendientes = await pendRes.json()
    if (pendientes.length === 0) {
      const periodoUpRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${pid}` +
        nominaTenantFilter(operador.cuenta_id) + '&estado=eq.cerrado', {
        method: 'PATCH', headers: svcHeaders(env, 'return=minimal'),
        body: JSON.stringify({ estado: 'pagado' }),
      })
      if (!periodoUpRes.ok) return jsonError('No se pudo cerrar el estado de pago del período', 500, request)
    }
  }

  const totalPagado = r4(lineas.reduce((s, l) => s + Number(l.total_neto_usd || 0), 0))

  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA', accion: 'PAGAR_NOMINA',
    entidadTipo: 'nomina_linea', entidadId: ids[0],
    meta: { recibos: ids.length, total_usd: totalPagado, referencia: referencia || null }, ip,
  }).catch(() => {})

  return json({ ok: true, recibos_pagados: ids.length, total_usd: totalPagado }, 200, request)
}

// POST /api/nomina/lineas/revertir-pago  Body: { lineaId }
export async function handleRevertirPagoLinea(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { lineaId } = body
  if (!lineaId || !isValidUuid(lineaId)) return jsonError('lineaId inválido', 400, request)

  const lRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=eq.${lineaId}` +
    `${nominaTenantFilter(operador.cuenta_id)}&select=id,periodo_id,pagado,total_neto_usd&limit=1`,
    { headers }
  )
  const [linea] = lRes.ok ? await lRes.json() : []
  if (!linea) return jsonError('Recibo no encontrado', 404, request)
  if (!linea.pagado) return jsonError('Este recibo no está pagado', 400, request)

  const upRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=eq.${lineaId}` +
    nominaTenantFilter(operador.cuenta_id) + '&pagado=eq.true', {
    method: 'PATCH', headers: svcHeaders(env, 'return=representation'),
    body: JSON.stringify({
      pagado: false, pagado_en: null, pagado_por: null,
      pagado_por_nombre: null, referencia_pago: null,
    }),
  })
  if (!upRes.ok) return jsonError('Error al revertir el pago', 500, request)
  const revertidas = await upRes.json()
  if (!Array.isArray(revertidas) || revertidas.length !== 1) {
    return jsonError('El estado del recibo cambió; vuelve a cargar e intenta de nuevo', 409, request)
  }

  // El período vuelve de 'pagado' a 'cerrado'
  const periodoUpRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${linea.periodo_id}` +
    `${nominaTenantFilter(operador.cuenta_id)}&estado=eq.pagado`, {
    method: 'PATCH', headers: svcHeaders(env, 'return=minimal'),
    body: JSON.stringify({ estado: 'cerrado' }),
  })
  if (!periodoUpRes.ok) return jsonError('El pago se revirtió, pero no se pudo actualizar el período', 500, request)

  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA', accion: 'REVERTIR_PAGO_NOMINA',
    entidadTipo: 'nomina_linea', entidadId: lineaId,
    meta: { monto_usd: Number(linea.total_neto_usd || 0) }, ip,
  }).catch(() => {})

  return json({ ok: true }, 200, request)
}
