// server/handlers/nomina.registro.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { calcularCamposAsistencia } from '../lib/nominaUtils.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { ROLES_ADMIN, ROLES_VER, booleanNominaValido, fechaNominaValida, horasEntradaSalidaValidas, svcHeaders, tenantGuard, textoNominaValido } from './nomina.shared.js'
import { validarFeriadoSolicitado } from './nomina.asistencia.js'

async function periodForDate(env, headers, operador, fecha) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?desde=lte.${fecha}&hasta=gte.${fecha}&estado=neq.abierto${nominaTenantFilter(operador.cuenta_id)}&select=id,nombre,estado&limit=1`, { headers })
  if (!response.ok) return null
  const [period] = await response.json()
  return period || null
}

export async function handleRegistrarAsistencia(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, fecha, horaEntrada, horaSalida, esFeriado, esAusencia, nota } = body || {}
  if (!empleadoId || !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (!booleanNominaValido(esFeriado) || !booleanNominaValido(esAusencia)) return jsonError('esFeriado y esAusencia deben ser booleanos', 400, request)
  if (!fechaNominaValida(fecha)) return jsonError('fecha inválida (YYYY-MM-DD)', 400, request)
  if (!horasEntradaSalidaValidas(horaEntrada, horaSalida)) return jsonError('Debe indicar entrada y salida válidas (HH:MM)', 400, request)
  if (!textoNominaValido(nota, 500)) return jsonError('nota inválida', 400, request)
  const period = await periodForDate(env, headers, operador, fecha)
  if (period) return jsonError(`No se puede editar asistencia: el período "${period.nombre}" está ${period.estado}`, 400, request)
  const holiday = await validarFeriadoSolicitado(env, headers, operador, fecha, esFeriado)
  if (holiday.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)
  if (esFeriado && !holiday.row) return jsonError('El feriado debe estar registrado en el calendario laboral', 400, request)
  const configResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?empleado_id=eq.${empleadoId}${nominaTenantFilter(operador.cuenta_id)}&select=horas_jornada&limit=1`, { headers })
  const [config] = configResponse.ok ? await configResponse.json() : []
  if (!config) return jsonError('El empleado no tiene configuración de nómina', 400, request)
  let calculation
  try { calculation = calcularCamposAsistencia(fecha, horaEntrada || null, horaSalida || null, Number(config.horas_jornada) || 8, !!(holiday.row || esFeriado), !!esAusencia) } catch (error) { return jsonError(error.message || 'Horas inválidas', 400, request) }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?on_conflict=empleado_id,fecha&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,es_sabado,es_domingo,es_feriado,es_ausencia,nota`, { method: 'POST', headers: { ...svcHeaders(env), Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ empleado_id: empleadoId, fecha, hora_entrada: esAusencia ? null : horaEntrada || null, hora_salida: esAusencia ? null : horaSalida || null, ...calculation, nota: nota || null, registrado_por: operador.id, cuenta_id: operador.cuenta_id }) })
  if (!response.ok) return jsonError('No se pudo registrar la asistencia', 500, request)
  const [row] = await response.json()
  return json({ ok: true, registro: row }, 200, request)
}

export async function handleRegistrarAsistenciaMasivo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { fecha, horaEntrada, horaSalida, esFeriado, empleadoIds } = body || {}
  if (!booleanNominaValido(esFeriado)) return jsonError('esFeriado inválido', 400, request)
  if (!fechaNominaValida(fecha)) return jsonError('fecha inválida (YYYY-MM-DD)', 400, request)
  if (!horasEntradaSalidaValidas(horaEntrada, horaSalida)) return jsonError('Debe indicar entrada y salida válidas (HH:MM)', 400, request)
  if (!Array.isArray(empleadoIds) && empleadoIds !== undefined) return jsonError('empleadoIds inválidos', 400, request)
  if (Array.isArray(empleadoIds) && empleadoIds.some(id => !isValidUuid(id))) return jsonError('empleadoIds inválidos', 400, request)
  const period = await periodForDate(env, headers, operador, fecha)
  if (period) return jsonError(`No se puede editar asistencia: el período "${period.nombre}" está ${period.estado}`, 400, request)
  const holiday = await validarFeriadoSolicitado(env, headers, operador, fecha, esFeriado)
  if (holiday.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)
  if (esFeriado && !holiday.row) return jsonError('El feriado debe estar registrado en el calendario laboral', 400, request)
  const idsFilter = Array.isArray(empleadoIds) && empleadoIds.length ? `&empleado_id=in.(${empleadoIds.join(',')})` : ''
  const configResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?activo=eq.true${nominaTenantFilter(operador.cuenta_id)}${idsFilter}&select=empleado_id,horas_jornada`, { headers })
  if (!configResponse.ok) return jsonError('Error al leer empleados', 500, request)
  const employees = await configResponse.json()
  if (!employees.length) return jsonError('No hay empleados activos con configuración de nómina', 400, request)
  let rows
  try { rows = employees.map(employee => ({ empleado_id: employee.empleado_id, fecha, hora_entrada: horaEntrada || null, hora_salida: horaSalida || null, ...calcularCamposAsistencia(fecha, horaEntrada || null, horaSalida || null, Number(employee.horas_jornada) || 8, !!(holiday.row || esFeriado), false), registrado_por: operador.id, cuenta_id: operador.cuenta_id })) } catch (error) { return jsonError(error.message || 'Horas inválidas', 400, request) }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?on_conflict=empleado_id,fecha`, { method: 'POST', headers: svcHeaders(env, 'resolution=merge-duplicates,return=minimal'), body: JSON.stringify(rows) })
  if (!response.ok) return jsonError('No se pudo registrar la asistencia masiva', 500, request)
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'ASISTENCIA_MASIVA', entidadTipo: 'registro_asistencia', entidadId: null, meta: { fecha, empleados: rows.length, hora_entrada: horaEntrada, hora_salida: horaSalida }, ip }).catch(() => {})
  return json({ ok: true, registros: rows.length }, 200, request)
}

export async function handleEliminarAsistencia(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { id } = body || {}
  if (!id || !isValidUuid(id)) return jsonError('id inválido', 400, request)
  const recordResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${id}${nominaTenantFilter(operador.cuenta_id)}&select=fecha&limit=1`, { headers })
  const [record] = recordResponse.ok ? await recordResponse.json() : []
  if (!record) return jsonError('Registro no encontrado', 404, request)
  const period = await periodForDate(env, headers, operador, record.fecha)
  if (period) return jsonError(`No se puede eliminar: el período "${period.nombre}" está ${period.estado}`, 400, request)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${id}${nominaTenantFilter(operador.cuenta_id)}`, { method: 'DELETE', headers: svcHeaders(env, 'return=minimal') })
  if (!response.ok) return jsonError('Error al eliminar registro', 500, request)
  return json({ ok: true }, 200, request)
}
