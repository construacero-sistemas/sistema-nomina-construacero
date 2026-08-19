// server/handlers/nomina.empleados.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import {
  ROLES_ADMIN,
  ROLES_NOMINA,
  ROLES_VER,
  booleanNominaValido,
  fechaNominaValida,
  horaNominaValida,
  montoNominaValido,
  tenantGuard,
  textoNominaValido,
} from './nomina.shared.js'

export async function handleGetEmpleados(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/clientes?tipo_cliente=eq.personal&activo=eq.true` +
      `${nominaTenantFilter(operador.cuenta_id)}&select=id,nombre,tipo_cliente,activo&order=nombre.asc&limit=500`,
    { headers },
  )
  if (!response.ok) return jsonError('Error al leer empleados', 500, request)
  return json(await response.json() ?? [], 200, request)
}

export async function handleGetConfigEmpleados(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_VER.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const selectConfig = ROLES_NOMINA.includes(operador.rol)
    ? 'id,empleado_id,cargo,fecha_ingreso,salario_dia_usd,horas_jornada,hora_inicio,hora_fin,activo'
    : 'id,empleado_id,cargo,fecha_ingreso,horas_jornada,hora_inicio,hora_fin,activo'
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?activo=eq.true${nominaTenantFilter(operador.cuenta_id)}` +
      `&select=${selectConfig},empleado:clientes!empleado_id(id,nombre,tipo_cliente)&order=empleado(nombre).asc&limit=500`,
    { headers },
  )
  if (!response.ok) return jsonError('Error al leer config empleados', 500, request)
  const data = await response.json()
  if (ROLES_NOMINA.includes(operador.rol)) return json(data ?? [], 200, request)
  return json((data ?? []).map(item => ({
    id: item.id,
    empleado_id: item.empleado_id,
    cargo: item.cargo ?? null,
    fecha_ingreso: item.fecha_ingreso ?? null,
    horas_jornada: item.horas_jornada,
    hora_inicio: item.hora_inicio,
    hora_fin: item.hora_fin,
    activo: item.activo,
    empleado: item.empleado ? { id: item.empleado.id, nombre: item.empleado.nombre, tipo_cliente: item.empleado.tipo_cliente } : null,
  })), 200, request)
}

export async function handleCrearConfigEmpleado(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, cargo, fechaIngreso, salarioDiaUsd, horasJornada, horaInicio, horaFin } = body || {}
  if (!empleadoId || !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (Number.isFinite(Number(salarioDiaUsd)) && Number(salarioDiaUsd) < 0) return jsonError('Salario no puede ser negativo', 400, request)
  if (!montoNominaValido(salarioDiaUsd)) return jsonError('Salario inválido', 400, request)
  if (fechaIngreso && !fechaNominaValida(fechaIngreso)) return jsonError('fechaIngreso inválida', 400, request)
  if (horasJornada !== undefined && !(Number.isFinite(Number(horasJornada)) && Number(horasJornada) > 0 && Number(horasJornada) <= 24)) return jsonError('horasJornada inválida', 400, request)
  if (horaInicio !== undefined && !horaNominaValida(horaInicio)) return jsonError('horaInicio inválida', 400, request)
  if (horaFin !== undefined && !horaNominaValida(horaFin)) return jsonError('horaFin inválida', 400, request)
  if (!textoNominaValido(cargo, 160)) return jsonError('cargo inválido', 400, request)

  const employeeResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${empleadoId}${nominaTenantFilter(operador.cuenta_id)}&select=id,tipo_cliente&limit=1`,
    { headers },
  )
  if (!employeeResponse.ok) return jsonError('No se pudo verificar el empleado', 500, request)
  const [employee] = await employeeResponse.json()
  if (!employee) return jsonError('Empleado no encontrado', 404, request)
  if (employee.tipo_cliente !== 'personal') return jsonError('Solo se puede configurar nómina para empleados (tipo_cliente = personal)', 400, request)

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ empleado_id: empleadoId, cargo: cargo || null, fecha_ingreso: fechaIngreso || null, salario_dia_usd: Number(salarioDiaUsd) || 0, horas_jornada: Number(horasJornada) || 8, hora_inicio: horaInicio || '08:00', hora_fin: horaFin || '17:00', cuenta_id: operador.cuenta_id, activo: true }),
  })
  if (!response.ok) {
    const detail = (await response.text()).toLowerCase()
    if (detail.includes('unique')) return jsonError('Este empleado ya tiene configuración de nómina', 409, request)
    return jsonError('No se pudo crear la configuración de nómina', 500, request)
  }
  const [row] = await response.json()
  return json({ ok: true, config: row }, 201, request)
}

export async function handleActualizarConfigEmpleado(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador } = v
  if (!ROLES_ADMIN.includes(operador.rol)) return jsonError('Acceso denegado', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { id, cargo, fechaIngreso, salarioDiaUsd, horasJornada, horaInicio, horaFin, activo } = body || {}
  if (!id || !isValidUuid(id)) return jsonError('id inválido', 400, request)
  if (!booleanNominaValido(activo)) return jsonError('activo inválido', 400, request)
  if (salarioDiaUsd !== undefined && salarioDiaUsd !== null && salarioDiaUsd !== '' && (typeof salarioDiaUsd === 'boolean' || !Number.isFinite(Number(salarioDiaUsd)))) return jsonError('salarioDiaUsd inválido', 400, request)
  if (fechaIngreso !== undefined && fechaIngreso !== null && fechaIngreso !== '' && !fechaNominaValida(fechaIngreso)) return jsonError('fechaIngreso inválida', 400, request)
  if (horasJornada !== undefined && (!Number.isFinite(Number(horasJornada)) || Number(horasJornada) <= 0 || Number(horasJornada) > 24)) return jsonError('horasJornada inválida', 400, request)
  if (horaInicio !== undefined && !horaNominaValida(horaInicio)) return jsonError('horaInicio inválida', 400, request)
  if (horaFin !== undefined && !horaNominaValida(horaFin)) return jsonError('horaFin inválida', 400, request)
  if (!textoNominaValido(cargo, 160)) return jsonError('cargo inválido', 400, request)
  const fields = {}
  if (cargo !== undefined) fields.cargo = cargo || null
  if (fechaIngreso !== undefined) fields.fecha_ingreso = fechaIngreso || null
  if (salarioDiaUsd !== undefined) fields.salario_dia_usd = Math.max(0, Number(salarioDiaUsd) || 0)
  if (horasJornada !== undefined) fields.horas_jornada = Math.max(.5, Number(horasJornada) || 8)
  if (horaInicio !== undefined) fields.hora_inicio = horaInicio
  if (horaFin !== undefined) fields.hora_fin = horaFin
  if (activo !== undefined) fields.activo = activo
  if (!Object.keys(fields).length) return jsonError('Nada que actualizar', 400, request)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?id=eq.${id}${nominaTenantFilter(operador.cuenta_id)}`, {
    method: 'PATCH', headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(fields),
  })
  if (!response.ok) return jsonError('Error al actualizar config', 500, request)
  const [row] = await response.json()
  if (!row) return jsonError('Configuración no encontrada', 404, request)
  return json({ ok: true, config: row }, 200, request)
}
