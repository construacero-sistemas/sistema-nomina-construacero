// server/handlers/nomina.periodos.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { calcularLineaNomina } from '../lib/nominaUtils.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { ROLES_ADMIN, ROLES_NOMINA, fechaNominaValida, fetchConfigNomina, r4, svcHeaders, tenantGuard, textoNominaValido } from './nomina.shared.js'

export async function handleGetPeriodos(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_NOMINA.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const account = nominaTenantFilter(operador.cuenta_id)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?order=desde.desc${account}&select=id,nombre,desde,hasta,tipo,estado&limit=500`, { headers })
  if (!response.ok) return jsonError('Error al leer períodos', 500, request)
  const periods = await response.json()
  if (!periods.length) return json(periods, 200, request)
  const lineResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=in.(${periods.map(period => period.id).join(',')})${account}&select=periodo_id,total_bruto_usd,total_neto_usd,pagado`, { headers })
  if (lineResponse.ok) {
    const aggregate = new Map()
    for (const line of await lineResponse.json()) {
      const totals = aggregate.get(line.periodo_id) || { empleados: 0, bruto: 0, neto: 0, pagados: 0 }
      totals.empleados += 1
      totals.bruto += Number(line.total_bruto_usd || 0)
      totals.neto += Number(line.total_neto_usd || 0)
      if (line.pagado) totals.pagados += 1
      aggregate.set(line.periodo_id, totals)
    }
    for (const period of periods) {
      const totals = aggregate.get(period.id) || { empleados: 0, bruto: 0, neto: 0, pagados: 0 }
      period.total_empleados = totals.empleados
      period.total_bruto_usd = r4(totals.bruto)
      period.total_neto_usd = r4(totals.neto)
      period.lineas_pagadas = totals.pagados
    }
  }
  return json(periods, 200, request)
}

export async function handleCrearPeriodo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { nombre, desde, hasta, tipo } = body || {}
  if (!nombre?.trim() || !textoNominaValido(nombre, 160)) return jsonError('El nombre es obligatorio o demasiado largo', 400, request)
  if (!fechaNominaValida(desde) || !fechaNominaValida(hasta)) return jsonError('Fechas inválidas', 400, request)
  if (hasta < desde) return jsonError('La fecha final debe ser posterior a la inicial', 400, request)
  if (new Date(`${hasta}T12:00:00Z`) - new Date(`${desde}T12:00:00Z`) > 30 * 86400000) return jsonError('El período no puede superar 31 días', 400, request)
  const account = nominaTenantFilter(operador.cuenta_id)
  const overlap = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?desde=lte.${hasta}&hasta=gte.${desde}${account}&select=id,nombre&limit=1`, { headers })
  if (overlap.ok) {
    const [period] = await overlap.json()
    if (period) return jsonError(`Las fechas se solapan con el período "${period.nombre}"`, 400, request)
  }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos`, { method: 'POST', headers: svcHeaders(env), body: JSON.stringify({ nombre: nombre.trim(), desde, hasta, tipo: ['semanal', 'quincenal', 'mensual'].includes(tipo) ? tipo : 'semanal', estado: 'abierto', cuenta_id: operador.cuenta_id }) })
  if (!response.ok) return jsonError('No se pudo crear el período', 500, request)
  const [period] = await response.json()
  return json({ ok: true, periodo: period }, 201, request)
}

export async function handleCalcularPeriodo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { periodoId } = body || {}
  if (!periodoId || !isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)
  const account = nominaTenantFilter(operador.cuenta_id)
  const periodResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}${account}&select=id,nombre,desde,hasta,estado&limit=1`, { headers })
  const [period] = periodResponse.ok ? await periodResponse.json() : []
  if (!period) return jsonError('Período no encontrado', 404, request)
  if (period.estado !== 'abierto') return jsonError(`El período está ${period.estado}; reábrelo para recalcular`, 400, request)
  const [configResponse, payrollConfig, attendanceResponse, previousResponse] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?activo=eq.true${account}&select=empleado_id,cargo,salario_dia_usd,horas_jornada`, { headers }),
    fetchConfigNomina(env, headers, operador.cuenta_id),
    fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?fecha=gte.${period.desde}&fecha=lte.${period.hasta}${account}&select=empleado_id,fecha,horas_normales,horas_extra,es_sabado,es_domingo,es_feriado,es_ausencia`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}${account}&select=empleado_id,bonos_usd,deducciones_usd,nota_bonos,nota_deducciones,pagado`, { headers }),
  ])
  if (!configResponse.ok) return jsonError('Error al leer empleados', 500, request)
  if (!attendanceResponse.ok) return jsonError('Error al leer asistencia', 500, request)
  if (!previousResponse.ok) return jsonError('Error al leer líneas existentes', 500, request)
  const employees = await configResponse.json()
  const attendance = await attendanceResponse.json()
  const previous = await previousResponse.json()
  if (!employees.length) return jsonError('No hay empleados activos con configuración de nómina', 400, request)
  const byEmployee = new Map()
  for (const row of attendance) {
    if (!byEmployee.has(row.empleado_id)) byEmployee.set(row.empleado_id, [])
    byEmployee.get(row.empleado_id).push(row)
  }
  const previousByEmployee = new Map(previous.map(row => [row.empleado_id, row]))
  const lines = employees.map(config => {
    const old = previousByEmployee.get(config.empleado_id) || {}
    const calculation = calcularLineaNomina(byEmployee.get(config.empleado_id) || [], config, payrollConfig, Number(old.bonos_usd || 0), Number(old.deducciones_usd || 0))
    return { periodo_id: periodoId, empleado_id: config.empleado_id, ...calculation, nota_bonos: old.nota_bonos || null, nota_deducciones: old.nota_deducciones || null, cuenta_id: operador.cuenta_id }
  })
  const paidIds = new Set(previous.filter(row => row.pagado).map(row => row.empleado_id))
  const activeIds = new Set(employees.map(employee => employee.empleado_id))
  const obsoleteIds = previous.filter(row => !row.pagado && !activeIds.has(row.empleado_id)).map(row => row.empleado_id)
  const toInsert = lines.filter(line => !paidIds.has(line.empleado_id))
  if (toInsert.length) {
    const insertResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?on_conflict=periodo_id,empleado_id`, { method: 'POST', headers: svcHeaders(env, 'resolution=merge-duplicates,return=minimal'), body: JSON.stringify(toInsert) })
    if (!insertResponse.ok) return jsonError('No se pudieron generar las líneas de nómina', 500, request)
  }
  if (obsoleteIds.length) {
    const deleteResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}${account}&empleado_id=in.(${obsoleteIds.join(',')})`, { method: 'DELETE', headers: svcHeaders(env, 'return=minimal') })
    if (!deleteResponse.ok) return jsonError('No se pudieron retirar líneas obsoletas', 500, request)
  }
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'CALCULAR_PERIODO', entidadTipo: 'nomina_periodo', entidadId: periodoId, meta: { periodo: period.nombre, lineas: toInsert.length, preservadas: paidIds.size, obsoletas: obsoleteIds.length }, ip }).catch(() => {})
  return json({ ok: true, lineas_generadas: toInsert.length, lineas_preservadas: paidIds.size }, 200, request)
}

export async function handleCerrarPeriodo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { periodoId } = body || {}
  if (!periodoId || !isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)
  const account = nominaTenantFilter(operador.cuenta_id)
  const periodResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}${account}&select=id,nombre,estado&limit=1`, { headers })
  const [period] = periodResponse.ok ? await periodResponse.json() : []
  if (!period) return jsonError('Período no encontrado', 404, request)
  if (period.estado !== 'abierto') return jsonError(`El período ya está ${period.estado}`, 400, request)
  const linesResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}${account}&select=id&limit=1`, { headers })
  if (!(linesResponse.ok ? await linesResponse.json() : []).length) return jsonError('Calcula la nómina antes de cerrar el período', 400, request)
  const update = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}${account}`, { method: 'PATCH', headers: svcHeaders(env, 'return=minimal'), body: JSON.stringify({ estado: 'cerrado', cerrado_en: new Date().toISOString(), cerrado_por: operador.id }) })
  if (!update.ok) return jsonError('Error al cerrar período', 500, request)
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'CERRAR_PERIODO', entidadTipo: 'nomina_periodo', entidadId: periodoId, meta: { periodo: period.nombre }, ip }).catch(() => {})
  return json({ ok: true }, 200, request)
}

export async function handleReabrirPeriodo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { periodoId } = body || {}
  if (!periodoId || !isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)
  const account = nominaTenantFilter(operador.cuenta_id)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}${account}&select=id,nombre,estado&limit=1`, { headers })
  const [period] = response.ok ? await response.json() : []
  if (!period) return jsonError('Período no encontrado', 404, request)
  if (period.estado === 'abierto') return jsonError('El período ya está abierto', 400, request)
  if (period.estado === 'pagado') return jsonError('No se puede reabrir un período ya pagado', 400, request)
  const paidResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}${account}&pagado=eq.true&select=id&limit=1`, { headers })
  if ((paidResponse.ok ? await paidResponse.json() : []).length) return jsonError('Hay recibos ya pagados en este período. Revierte los pagos antes de reabrir.', 400, request)
  const update = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}${account}`, { method: 'PATCH', headers: svcHeaders(env, 'return=minimal'), body: JSON.stringify({ estado: 'abierto', cerrado_en: null, cerrado_por: null }) })
  if (!update.ok) return jsonError('Error al reabrir período', 500, request)
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'REABRIR_PERIODO', entidadTipo: 'nomina_periodo', entidadId: periodoId, meta: { periodo: period.nombre }, ip }).catch(() => {})
  return json({ ok: true }, 200, request)
}

export async function handleEliminarPeriodo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { periodoId } = body || {}
  if (!periodoId || !isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)
  const account = nominaTenantFilter(operador.cuenta_id)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}${account}&select=id,nombre,estado&limit=1`, { headers })
  const [period] = response.ok ? await response.json() : []
  if (!period) return jsonError('Período no encontrado', 404, request)
  if (period.estado === 'pagado') return jsonError('No se puede eliminar un período ya pagado', 400, request)
  const paidResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}${account}&pagado=eq.true&select=id&limit=1`, { headers })
  if ((paidResponse.ok ? await paidResponse.json() : []).length) return jsonError('Hay recibos ya pagados en este período. Revierte los pagos antes de eliminar.', 400, request)
  await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}${account}`, { method: 'DELETE', headers: svcHeaders(env, 'return=minimal') })
  const deletePeriod = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}${account}`, { method: 'DELETE', headers: svcHeaders(env, 'return=minimal') })
  if (!deletePeriod.ok) return jsonError('Error al eliminar período', 500, request)
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'ELIMINAR_PERIODO', entidadTipo: 'nomina_periodo', entidadId: periodoId, meta: { periodo: period.nombre }, ip }).catch(() => {})
  return json({ ok: true }, 200, request)
}
