// server/handlers/nomina.asistencia.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { calcularCamposAsistencia } from '../lib/nominaUtils.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import {
  ROLES_ADMIN,
  ROLES_VER,
  booleanNominaValido,
  fechaNominaValida,
  horaNominaValida,
  svcHeaders,
  tenantGuard,
  textoNominaValido,
} from './nomina.shared.js'

export async function handleGetAsistencia(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const url = new URL(request.url)
  const desde = url.searchParams.get('desde')
  const hasta = url.searchParams.get('hasta')
  const empleadoId = url.searchParams.get('empleadoId')
  if (empleadoId && !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (desde && !fechaNominaValida(desde)) return jsonError('desde inválida', 400, request)
  if (hasta && !fechaNominaValida(hasta)) return jsonError('hasta inválida', 400, request)
  if (desde && hasta) {
    const range = new Date(`${hasta}T12:00:00Z`) - new Date(`${desde}T12:00:00Z`)
    if (range < 0 || range > 31 * 86400000) return jsonError('El rango debe estar entre 0 y 31 días', 400, request)
  }
  const filters = [nominaTenantFilter(operador.cuenta_id), desde ? `&fecha=gte.${desde}` : '', hasta ? `&fecha=lte.${hasta}` : '', empleadoId ? `&empleado_id=eq.${empleadoId}` : ''].join('')
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?order=fecha.asc${filters}&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,es_sabado,es_domingo,es_feriado,es_ausencia,nota&limit=500`, { headers })
  if (!response.ok) return jsonError('Error al leer asistencia', 500, request)
  return json(await response.json() ?? [], 200, request)
}

function nowInNominaZone(env) {
  const now = env.NOMINA_NOW ? new Date(env.NOMINA_NOW) : new Date()
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: env.NOMINA_TIMEZONE || 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return { fecha: `${values.year}-${values.month}-${values.day}`, hora: `${values.hour === '24' ? '00' : values.hour}:${values.minute}`, marcadoEn: now.toISOString() }
}

function idempotencyKeyValida(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value.trim())
}

async function fetchRegistroDelDia(env, headers, operador, empleadoId, fecha) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?empleado_id=eq.${empleadoId}&fecha=eq.${fecha}${nominaTenantFilter(operador.cuenta_id)}&select=id,hora_entrada,hora_salida,es_feriado,nota,entrada_idempotency_key,salida_idempotency_key&limit=1`, { headers })
  if (!response.ok) return { error: true, row: null }
  const [row] = await response.json()
  return { error: false, row: row || null }
}

async function periodoBloqueadoParaFecha(env, headers, operador, fecha) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?desde=lte.${fecha}&hasta=gte.${fecha}&estado=neq.abierto${nominaTenantFilter(operador.cuenta_id)}&select=nombre,estado&limit=1`, { headers })
  if (!response.ok) return null
  const [periodo] = await response.json()
  return periodo || null
}

async function fetchConfigActiva(env, headers, operador, empleadoId) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?empleado_id=eq.${empleadoId}&activo=eq.true${nominaTenantFilter(operador.cuenta_id)}&select=horas_jornada&limit=1`, { headers })
  if (!response.ok) return null
  const [config] = await response.json()
  return config || null
}

async function fetchFeriadoDelDia(env, headers, operador, fecha) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_feriados?fecha=eq.${fecha}${nominaTenantFilter(operador.cuenta_id)}&select=id,fecha,nombre,tipo,laborable&limit=1`, { headers })
  if (!response.ok) return { error: true, row: null }
  const [row] = await response.json()
  return { error: false, row: row || null }
}

export async function validarFeriadoSolicitado(env, headers, operador, fecha, solicitado) {
  return solicitado ? fetchFeriadoDelDia(env, headers, operador, fecha) : { error: false, row: null }
}

export async function handleGetMarcajeHoy(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const { fecha } = nowInNominaZone(env)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?fecha=eq.${fecha}${nominaTenantFilter(operador.cuenta_id)}&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,estado_marcaje,entrada_marcada_en,salida_marcada_en,nota`, { headers })
  if (!response.ok) return jsonError('Error al leer marcaje del día', 500, request)
  return json({ fecha, registros: await response.json() ?? [] }, 200, request)
}

export async function handleMarcarEntrada(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (operador.rol !== 'administracion') return jsonError('Solo administración puede marcar entradas', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, idempotencyKey, nota } = body || {}
  if (!empleadoId || !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (!idempotencyKeyValida(idempotencyKey)) return jsonError('idempotencyKey inválida', 400, request)
  if (!textoNominaValido(nota, 500)) return jsonError('nota inválida', 400, request)
  const mark = nowInNominaZone(env)
  const period = await periodoBloqueadoParaFecha(env, headers, operador, mark.fecha)
  if (period) return jsonError(`No se puede marcar: el período está ${period.estado}`, 400, request)
  if (!await fetchConfigActiva(env, headers, operador, empleadoId)) return jsonError('El empleado no tiene configuración activa de nómina', 400, request)
  const holiday = await fetchFeriadoDelDia(env, headers, operador, mark.fecha)
  if (holiday.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)
  const existing = await fetchRegistroDelDia(env, headers, operador, empleadoId, mark.fecha)
  if (existing.error) return jsonError('Error al leer asistencia del día', 500, request)
  if (existing.row?.entrada_idempotency_key === idempotencyKey.trim()) return json({ ok: true, idempotente: true, registro: existing.row }, 200, request)
  if (existing.row?.hora_entrada) return jsonError('El empleado ya tiene entrada marcada hoy', 409, request)
  const row = { empleado_id: empleadoId, fecha: mark.fecha, hora_entrada: mark.hora, hora_salida: null, horas_trabajadas: 0, horas_normales: 0, horas_extra: 0, es_sabado: new Date(`${mark.fecha}T12:00:00`).getDay() === 6, es_domingo: new Date(`${mark.fecha}T12:00:00`).getDay() === 0, es_feriado: !!holiday.row, es_ausencia: false, estado_marcaje: 'entrada', entrada_marcada_en: mark.marcadoEn, entrada_por: operador.id, entrada_idempotency_key: idempotencyKey.trim(), nota: nota || null, registrado_por: operador.id, cuenta_id: operador.cuenta_id }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,es_feriado,es_ausencia,estado_marcaje,nota`, { method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' }, body: JSON.stringify(row) })
  if (!response.ok) return jsonError('No se pudo registrar la entrada', 409, request)
  const [registro] = await response.json()
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'MARCAR_ENTRADA', entidadTipo: 'registro_asistencia', entidadId: registro?.id || null, meta: { empleadoId, fecha: mark.fecha }, ip }).catch(() => {})
  return json({ ok: true, idempotente: false, registro }, 201, request)
}

export async function handleMarcarSalida(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (operador.rol !== 'administracion') return jsonError('Solo administración puede marcar salidas', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, idempotencyKey, nota } = body || {}
  if (!empleadoId || !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (!idempotencyKeyValida(idempotencyKey)) return jsonError('idempotencyKey inválida', 400, request)
  if (!textoNominaValido(nota, 500)) return jsonError('nota inválida', 400, request)
  const mark = nowInNominaZone(env)
  const period = await periodoBloqueadoParaFecha(env, headers, operador, mark.fecha)
  if (period) return jsonError(`No se puede marcar: el período está ${period.estado}`, 400, request)
  const config = await fetchConfigActiva(env, headers, operador, empleadoId)
  if (!config) return jsonError('El empleado no tiene configuración activa de nómina', 400, request)
  const holiday = await fetchFeriadoDelDia(env, headers, operador, mark.fecha)
  if (holiday.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)
  const existing = await fetchRegistroDelDia(env, headers, operador, empleadoId, mark.fecha)
  if (existing.error) return jsonError('Error al leer asistencia del día', 500, request)
  if (!existing.row?.hora_entrada) return jsonError('No existe una entrada marcada hoy', 409, request)
  if (existing.row.salida_idempotency_key === idempotencyKey.trim()) return json({ ok: true, idempotente: true, registro: existing.row }, 200, request)
  if (existing.row.hora_salida) return jsonError('El empleado ya tiene salida marcada hoy', 409, request)
  if (existing.row.hora_entrada === mark.hora) return jsonError('La salida no puede ser igual a la entrada', 400, request)
  let calculation
  try { calculation = calcularCamposAsistencia(mark.fecha, existing.row.hora_entrada, mark.hora, Number(config.horas_jornada) || 8, !!(existing.row.es_feriado || holiday.row), false) } catch (error) { return jsonError(error.message || 'Horas inválidas', 400, request) }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${existing.row.id}${nominaTenantFilter(operador.cuenta_id)}&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,es_feriado,es_ausencia,estado_marcaje,nota`, { method: 'PATCH', headers: { ...svcHeaders(env), Prefer: 'return=representation' }, body: JSON.stringify({ ...calculation, hora_salida: mark.hora, estado_marcaje: 'completo', salida_marcada_en: mark.marcadoEn, salida_por: operador.id, salida_idempotency_key: idempotencyKey.trim(), registrado_por: operador.id, nota: nota || existing.row.nota || null }) })
  if (!response.ok) return jsonError('No se pudo registrar la salida', 409, request)
  const [registro] = await response.json()
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'MARCAR_SALIDA', entidadTipo: 'registro_asistencia', entidadId: existing.row.id, meta: { empleadoId, fecha: mark.fecha }, ip }).catch(() => {})
  return json({ ok: true, idempotente: false, registro }, 200, request)
}

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
  if (!fechaNominaValida(desde) || !fechaNominaValida(hasta)) return jsonError('Rango de fechas inválido', 400, request)
  const range = new Date(`${hasta}T12:00:00Z`) - new Date(`${desde}T12:00:00Z`)
  if (range < 0 || range > 31 * 86400000) return jsonError('El rango debe estar entre 0 y 31 días', 400, request)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_feriados?fecha=gte.${desde}&fecha=lte.${hasta}${nominaTenantFilter(operador.cuenta_id)}&select=id,fecha,nombre,tipo,laborable&order=fecha.asc`, { headers })
  if (!response.ok) return jsonError('Error al leer feriados', 500, request)
  return json(await response.json() ?? [], 200, request)
}

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
  if (tipo !== undefined && !['nacional', 'regional', 'empresa'].includes(tipo)) return jsonError('tipo de feriado inválido', 400, request)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_feriados`, { method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' }, body: JSON.stringify({ fecha, nombre: nombre.trim(), tipo: tipo || 'empresa', laborable: laborable === true, cuenta_id: operador.cuenta_id, creado_por: operador.id }) })
  if (!response.ok) return jsonError('Error al crear feriado', 409, request)
  const [holiday] = await response.json()
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'CREAR_FERIADO', entidadTipo: 'nomina_feriado', entidadId: holiday?.id || null, meta: { fecha, nombre: nombre.trim() }, ip }).catch(() => {})
  return json({ ok: true, feriado: holiday }, 201, request)
}

export async function handleGetHorarios(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const empleadoId = new URL(request.url).searchParams.get('empleadoId')
  if (empleadoId && !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  const empleadoFilter = empleadoId ? `&empleado_id=eq.${empleadoId}` : ''
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_horarios?order=dia_semana.asc${nominaTenantFilter(operador.cuenta_id)}${empleadoFilter}&select=id,empleado_id,dia_semana,semana_ciclo,grupo_rotacion,fecha_desde,fecha_hasta,hora_inicio,hora_fin,horas_jornada,trabaja&limit=500`, { headers })
  if (!response.ok) return jsonError('Error al leer horarios', 500, request)
  return json(await response.json() ?? [], 200, request)
}

export async function handleCrearHorario(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, diaSemana, semanaCiclo, grupoRotacion, fechaDesde, fechaHasta, horaInicio, horaFin, horasJornada, trabaja } = body || {}
  if (empleadoId && !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (!booleanNominaValido(trabaja)) return jsonError('trabaja inválido', 400, request)
  if (!Number.isInteger(Number(diaSemana)) || Number(diaSemana) < 0 || Number(diaSemana) > 6) return jsonError('diaSemana inválido', 400, request)
  if (!fechaNominaValida(fechaDesde) || (fechaHasta && !fechaNominaValida(fechaHasta))) return jsonError('Vigencia de fechas inválida', 400, request)
  if (fechaHasta && fechaHasta < fechaDesde) return jsonError('fechaHasta anterior a fechaDesde', 400, request)
  if (!textoNominaValido(grupoRotacion, 80)) return jsonError('grupoRotacion inválido', 400, request)
  if (!horaNominaValida(horaInicio) || !horaNominaValida(horaFin)) return jsonError('Horario inválido', 400, request)
  if (!(Number(horasJornada) > 0 && Number(horasJornada) <= 24)) return jsonError('horasJornada inválida', 400, request)
  if (semanaCiclo !== undefined && semanaCiclo !== null && (!Number.isInteger(Number(semanaCiclo)) || Number(semanaCiclo) < 1 || Number(semanaCiclo) > 5)) return jsonError('semanaCiclo inválida', 400, request)
  if (empleadoId) {
    const employeeResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${empleadoId}${nominaTenantFilter(operador.cuenta_id)}&select=id,tipo_cliente&limit=1`, { headers: svcHeaders(env, 'return=minimal') })
    if (!employeeResponse.ok) return jsonError('No se pudo verificar el empleado', 500, request)
    const [employee] = await employeeResponse.json()
    if (!employee) return jsonError('Empleado no encontrado', 404, request)
    if (employee.tipo_cliente !== 'personal') return jsonError('El horario solo puede asignarse a personal', 400, request)
  }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_horarios`, { method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' }, body: JSON.stringify({ empleado_id: empleadoId || null, dia_semana: Number(diaSemana), semana_ciclo: semanaCiclo ?? null, grupo_rotacion: grupoRotacion || null, fecha_desde: fechaDesde, fecha_hasta: fechaHasta || null, hora_inicio: horaInicio, hora_fin: horaFin, horas_jornada: Number(horasJornada), trabaja: trabaja !== false, cuenta_id: operador.cuenta_id, creado_por: operador.id }) })
  if (!response.ok) return jsonError('Error al crear horario', 409, request)
  const [schedule] = await response.json()
  return json({ ok: true, horario: schedule }, 201, request)
}
