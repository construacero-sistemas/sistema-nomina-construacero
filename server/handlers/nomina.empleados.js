// server/handlers/nomina.empleados.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { DIAS_LABORABLES_DEFAULT, fetchDiasLaborablesPorEmpleado } from '../lib/nominaHorarios.js'
import { requireCapacidad } from '../lib/permissions.js'
import { registrarAuditoria } from '../lib/audit.js'
import { clearEgressCache } from '../lib/egressCache.js'
import {
  ROLES_NOMINA,
  booleanNominaValido,
  fechaNominaValida,
  horaNominaValida,
  montoNominaValido,
  svcHeaders,
  tenantGuard,
  textoNominaValido,
  fetchConfigsConControl,
} from './nomina.shared.js'

export async function handleGetEmpleados(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
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
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  // incluirInactivas=1: incluye también los dados de baja (vista "Bajas" de la UI).
  // Sin el flag el listado queda limitado a activos, como siempre.
  const incluirInactivas = new URL(request.url).searchParams.get('incluirInactivas') === '1'
  const tenantFilter = nominaTenantFilter(operador.cuenta_id)
  const queryFilters = incluirInactivas ? tenantFilter.slice(1) : `activo=eq.true${tenantFilter}`
  const selectBase = ROLES_NOMINA.includes(operador.rol)
    ? 'id,empleado_id,cargo,fecha_ingreso,salario_dia_usd,horas_jornada,hora_inicio,hora_fin,activo,pos_vendedor_id'
    : 'id,empleado_id,cargo,fecha_ingreso,horas_jornada,hora_inicio,hora_fin,activo,pos_vendedor_id'
  // `fetchConfigsConControl` añade la bandera de control de asistencia y, si la
  // migración 246 aún no está aplicada, sirve el listado anterior en vez de romper
  // la pestaña de Empleados.
  const { ok, rows: data } = await fetchConfigsConControl(env, headers, {
    filtros: queryFilters,
    select: `${selectBase},empleado:clientes!empleado_id(id,nombre,tipo_cliente)`,
    orden: 'empleado(nombre).asc',
    limit: 500,
  })
  if (!ok) return jsonError('Error al leer config empleados', 500, request)
  // Días laborables por persona (tabla `nomina_horarios`): alimenta el estado
  // "Libre" de la asistencia y del reloj real sin que cada vista tenga que
  // consultarlos por su cuenta.
  const { ok: horariosOk, porEmpleado } = await fetchDiasLaborablesPorEmpleado(env, headers, operador.cuenta_id)
  if (!horariosOk) return jsonError('Error al leer los días laborables del personal', 500, request)
  const controlaDe = item => item.controla_asistencia !== false
  const diasDe = item => {
    const resuelto = porEmpleado.get(item.empleado_id)
    return {
      dias_laborables: resuelto?.dias ?? [...DIAS_LABORABLES_DEFAULT],
      horario_configurado: Boolean(resuelto?.configurado),
    }
  }
  if (ROLES_NOMINA.includes(operador.rol)) {
    return json((data ?? []).map(item => ({ ...item, ...diasDe(item) })), 200, request)
  }
  return json((data ?? []).map(item => ({
    id: item.id,
    empleado_id: item.empleado_id,
    cargo: item.cargo ?? null,
    fecha_ingreso: item.fecha_ingreso ?? null,
    horas_jornada: item.horas_jornada,
    hora_inicio: item.hora_inicio,
    hora_fin: item.hora_fin,
    activo: item.activo,
    controla_asistencia: controlaDe(item),
    pos_vendedor_id: item.pos_vendedor_id ?? null,
    empleado: item.empleado ? { id: item.empleado.id, nombre: item.empleado.nombre, tipo_cliente: item.empleado.tipo_cliente } : null,
    ...diasDe(item),
  })), 200, request)
}

export async function handleCrearConfigEmpleado(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, nombre, documento, cargo, fechaIngreso, salarioDiaUsd, horasJornada, horaInicio, horaFin, posVendedorId } = body || {}
  if (empleadoId && !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (posVendedorId && !isValidUuid(posVendedorId)) return jsonError('posVendedorId inválido', 400, request)
  if (!empleadoId && !textoNominaValido(nombre, 160)) return jsonError('nombre inválido', 400, request)
  if (Number.isFinite(Number(salarioDiaUsd)) && Number(salarioDiaUsd) < 0) return jsonError('Salario no puede ser negativo', 400, request)
  if (!montoNominaValido(salarioDiaUsd)) return jsonError('Salario inválido', 400, request)
  if (fechaIngreso && !fechaNominaValida(fechaIngreso)) return jsonError('fechaIngreso inválida', 400, request)
  if (horasJornada !== undefined && !(Number.isFinite(Number(horasJornada)) && Number(horasJornada) > 0 && Number(horasJornada) <= 24)) return jsonError('horasJornada inválida', 400, request)
  if (horaInicio !== undefined && !horaNominaValida(horaInicio)) return jsonError('horaInicio inválida', 400, request)
  if (horaFin !== undefined && !horaNominaValida(horaFin)) return jsonError('horaFin inválida', 400, request)
  if (!textoNominaValido(cargo, 160)) return jsonError('cargo inválido', 400, request)

  let resolvedEmployeeId = empleadoId
  if (!resolvedEmployeeId) {
    const employeeResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ cuenta_id: operador.cuenta_id, nombre: nombre.trim(), documento: documento?.trim() || null, tipo_cliente: 'personal', activo: true }),
    })
    if (!employeeResponse.ok) return jsonError('No se pudo registrar el empleado', 500, request)
    const [employee] = await employeeResponse.json()
    resolvedEmployeeId = employee?.id
  } else {
    const employeeResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${resolvedEmployeeId}${nominaTenantFilter(operador.cuenta_id)}&select=id&limit=1`, { headers })
    if (!employeeResponse.ok) return jsonError('No se pudo verificar el empleado', 500, request)
    const [employee] = await employeeResponse.json()
    if (!employee) return jsonError('Empleado no encontrado', 404, request)
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      empleado_id: resolvedEmployeeId,
      cargo: cargo || null,
      fecha_ingreso: fechaIngreso || null,
      salario_dia_usd: Number(salarioDiaUsd) || 0,
      horas_jornada: Number(horasJornada) || 8,
      hora_inicio: horaInicio || '08:00',
      hora_fin: horaFin || '17:00',
      pos_vendedor_id: posVendedorId || null,
      cuenta_id: operador.cuenta_id,
      activo: true,
    }),
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
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { id, cargo, fechaIngreso, salarioDiaUsd, horasJornada, horaInicio, horaFin, activo, posVendedorId, controlaAsistencia } = body || {}
  if (!id || !isValidUuid(id)) return jsonError('id inválido', 400, request)
  if (posVendedorId !== undefined && posVendedorId !== null && posVendedorId !== '' && !isValidUuid(posVendedorId)) return jsonError('posVendedorId inválido', 400, request)
  if (!booleanNominaValido(activo)) return jsonError('activo inválido', 400, request)
  if (!booleanNominaValido(controlaAsistencia)) return jsonError('controlaAsistencia inválido', 400, request)
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
  if (controlaAsistencia !== undefined) fields.controla_asistencia = controlaAsistencia
  if (posVendedorId !== undefined) fields.pos_vendedor_id = posVendedorId || null
  if (!Object.keys(fields).length) return jsonError('Nada que actualizar', 400, request)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?id=eq.${id}${nominaTenantFilter(operador.cuenta_id)}`, {
    method: 'PATCH', headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(fields),
  })
  if (!response.ok) {
    const detalle = await response.text().catch(() => '')
    // Migración 246 pendiente: se avisa con claridad en vez de reportar un error
    // genérico, porque el arreglo es aplicar la migración, no reintentar.
    if (detalle.includes('controla_asistencia')) {
      return jsonError('Falta aplicar la migración 246 (columna controla_asistencia) antes de cambiar el control de asistencia', 409, request)
    }
    return jsonError('Error al actualizar config', 500, request)
  }
  const [row] = await response.json()
  if (!row) return jsonError('Configuración no encontrada', 404, request)
  return json({ ok: true, config: row }, 200, request)
}

export async function handleEliminarConfigEmpleado(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, ip } = v
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body = {}
  try {
    body = await request.json()
  } catch {
    const url = new URL(request.url)
    body = { id: url.searchParams.get('id') }
  }

  const id = body?.id?.trim?.() || body?.id
  if (!id || !isValidUuid(id)) return jsonError('id inválido', 400, request)
  const incluirHistorial = body?.incluirHistorial === true
  const tenantFilter = nominaTenantFilter(operador.cuenta_id)
  const serviceHeaders = svcHeaders(env, 'return=representation')
  const configRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?id=eq.${id}${tenantFilter}&select=id,empleado_id,cargo,cuenta_id,activo,empleado:clientes!empleado_id(id,nombre,tipo_cliente)&limit=1`,
    { headers: serviceHeaders },
  )
  if (!configRes.ok) return jsonError('Error al consultar configuración de empleado', 500, request)
  const [config] = await configRes.json()
  if (!config) return jsonError('Configuración de empleado no encontrada', 404, request)

  const empleado = config.empleado
  if (incluirHistorial) {
    if (config.activo !== false) return jsonError('Solo se permite la eliminación definitiva de una ficha dada de baja', 409, request)
    if (!empleado?.id || empleado.tipo_cliente !== 'personal') return jsonError('La ficha no corresponde a un trabajador personal', 409, request)
    if (body.empleadoId !== config.empleado_id || typeof body.confirmarNombre !== 'string'
      || body.confirmarNombre.trim().toLocaleLowerCase('es') !== String(empleado.nombre || '').trim().toLocaleLowerCase('es')) {
      return jsonError('El nombre de confirmación no coincide con la ficha seleccionada', 400, request)
    }
  }

  const empleadoId = config.empleado_id
  const [asistenciaRes, recibosRes, horariosRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?empleado_id=eq.${empleadoId}${tenantFilter}&select=id,fecha&limit=500`, { headers: serviceHeaders }),
    fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?empleado_id=eq.${empleadoId}${tenantFilter}&select=id,periodo_id,pagado,total_neto_usd&limit=500`, { headers: serviceHeaders }),
    fetch(`${env.SUPABASE_URL}/rest/v1/nomina_horarios?empleado_id=eq.${empleadoId}${tenantFilter}&select=id&limit=500`, { headers: serviceHeaders }),
  ])
  if (!asistenciaRes.ok || !recibosRes.ok || !horariosRes.ok) return jsonError('No se pudo comprobar todo el historial del trabajador; no se eliminó nada', 500, request)
  const [asistencias, recibos, horarios] = await Promise.all([asistenciaRes.json(), recibosRes.json(), horariosRes.json()])

  if (!incluirHistorial && (asistencias.length || recibos.length)) {
    return jsonError(
      'No se puede eliminar por completo a este trabajador porque tiene historial contable (recibos de nómina o asistencias). Debe permanecer como "Dado de baja" para preservarlo.',
      409,
      request,
    )
  }

  const periodIds = [...new Set(recibos.map(linea => linea.periodo_id))]
  let periodos = []
  if (periodIds.length) {
    const periodsRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=in.(${periodIds.join(',')})${tenantFilter}&select=id,nombre,estado&limit=500`, { headers: serviceHeaders })
    if (!periodsRes.ok) return jsonError('No se pudieron verificar los períodos de nómina; no se eliminó nada', 500, request)
    periodos = await periodsRes.json()
    const periodosEncontrados = new Set(periodos.map(periodo => periodo.id))
    if (periodIds.some(periodId => !periodosEncontrados.has(periodId))) return jsonError('Hay recibos con período no encontrado; no se eliminó nada', 409, request)
  }

  if (incluirHistorial && recibos.length) {
    if (recibos.some(linea => linea.pagado || periodos.find(periodo => periodo.id === linea.periodo_id)?.estado !== 'abierto')) {
      return jsonError('Hay recibos pagados o períodos cerrados. Se conserva el historial para proteger el libro financiero.', 409, request)
    }

    // No consultar ni mutar la tabla de asignaciones financieras desde esta ruta:
    // su acceso es deliberadamente restringido. El DELETE de la propia línea es
    // la comprobación atómica de la FK: si hubo un pago/reversión enlazado, la
    // base lo rechaza antes de modificar cualquier otro dato.
    const lineIds = recibos.map(linea => linea.id)
    const conceptsRes = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_linea_conceptos?linea_id=in.(${lineIds.join(',')})&select=id&limit=1`, { headers: serviceHeaders })
    if (!conceptsRes.ok) return jsonError('No se pudieron verificar los conceptos de recibo; no se eliminó nada', 500, request)
    const concepts = await conceptsRes.json()
    if (concepts.length) return jsonError('Hay conceptos asociados a los recibos. Se conserva todo para proteger su historial.', 409, request)

    const deleteLines = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?id=in.(${lineIds.join(',')})${tenantFilter}&select=id`, {
      method: 'DELETE',
      headers: { ...svcHeaders(env), Prefer: 'return=representation' },
    })
    if (!deleteLines.ok) return jsonError('La base detectó un vínculo de pago, reversión o referencia histórica en esos recibos. No se eliminó ningún otro dato.', 409, request)
    const deletedLines = await deleteLines.json()
    if (deletedLines.length !== lineIds.length) return jsonError('Cambió el historial mientras se procesaba la eliminación; actualiza y revisa las fichas antes de reintentar.', 409, request)
  }

  // Eliminar solo después de superar las comprobaciones y, si había recibos,
  // de que la base confirmara que no tienen referencias financieras restrictivas.
  const deleteAttendance = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?empleado_id=eq.${empleadoId}${tenantFilter}`, {
    method: 'DELETE', headers: svcHeaders(env, 'return=minimal'),
  })
  if (!deleteAttendance.ok) return jsonError('No se pudieron eliminar sus asistencias', 409, request)
  if (horarios.length) {
    const deleteSchedules = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_horarios?empleado_id=eq.${empleadoId}${tenantFilter}`, {
      method: 'DELETE', headers: svcHeaders(env, 'return=minimal'),
    })
    if (!deleteSchedules.ok) return jsonError('No se pudieron eliminar los horarios asignados', 409, request)
  }

  const deleteConfig = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?id=eq.${id}${tenantFilter}`, {
    method: 'DELETE', headers: { ...svcHeaders(env), Prefer: 'return=representation' },
  })
  if (!deleteConfig.ok) return jsonError('No se pudo eliminar la configuración del trabajador', 409, request)
  if (!(await deleteConfig.json()).length) return jsonError('La ficha cambió mientras se procesaba la eliminación', 409, request)

  let clienteEliminado = false
  if (empleadoId) {
    const deleteClient = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?id=eq.${empleadoId}&tipo_cliente=eq.personal${tenantFilter}`, {
      method: 'DELETE', headers: svcHeaders(env, 'return=minimal'),
    })
    clienteEliminado = deleteClient.ok
  }

  await registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA',
    accion: 'EMPLEADO_ELIMINADO_DEFINITIVAMENTE',
    entidadTipo: 'nomina_config_empleado',
    entidadId: id,
    meta: {
      empleado_id: empleadoId,
      nombre: empleado?.nombre || null,
      cargo: config.cargo,
      historialesEliminados: incluirHistorial,
      asistenciasEliminadas: asistencias.map(row => row.id),
      recibosEliminados: incluirHistorial ? recibos.map(row => row.id) : [],
      clienteEliminado,
    },
    ip,
  }).catch(() => {})

  clearEgressCache()
  return json({ ok: true, eliminado: true, id, empleadoId, clienteEliminado }, 200, request)
}

