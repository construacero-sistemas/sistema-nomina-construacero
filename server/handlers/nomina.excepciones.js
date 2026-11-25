// server/handlers/nomina.excepciones.js
// Acciones diarias por excepción: horas extras (desde 0.5h) y días de descanso
// o feriados trabajados. Respeta el horario del empleado, concurrencia optimista
// (G-3), período abierto (G-5), control de asistencia (G-8) y auditoría (G-4).
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { requireCapacidad } from '../lib/permissions.js'
import { registrarAuditoria } from '../lib/audit.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { fetchDiasLaborablesEmpleado, trabajaEnFecha } from '../lib/nominaHorarios.js'
import {
  construirRegistroExcepcion,
  horarioEfectivoDelDia,
  normalizarHorasExtra,
} from '../lib/asistenciaExcepciones.js'
import {
  booleanNominaValido,
  fechaNominaValida,
  fetchConfigNomina,
  filtroIgual,
  svcHeaders,
  tenantGuard,
  textoNominaValido,
} from './nomina.shared.js'
import {
  fetchConfigActiva,
  fetchFeriadoDelDia,
  fetchRegistroDelDia,
  nowInNominaZone,
  periodoBloqueadoParaFecha,
  sinControlDeAsistencia,
} from './nomina.asistencia.js'

const SELECT_ASISTENCIA = 'id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,horas_descanso,es_sabado,es_domingo,es_feriado,es_ausencia,ausencia_justificada,estado_marcaje,nota'

function filtroConcurrenciaManual(row, tenantFilter) {
  return `id=eq.${row.id}${tenantFilter}&estado_marcaje=eq.manual&es_ausencia=eq.false` +
    `${filtroIgual('hora_entrada', row.hora_entrada)}${filtroIgual('hora_salida', row.hora_salida)}`
}

async function verificarContextoDia(env, headers, operador, empleadoId, fecha, request) {
  const period = await periodoBloqueadoParaFecha(env, headers, operador, fecha)
  if (period) return { error: jsonError(`No se puede registrar: el período está ${period.estado}`, 400, request) }
  const config = await fetchConfigActiva(env, headers, operador, empleadoId)
  if (!config) return { error: jsonError('El empleado no tiene configuración activa de nómina', 400, request) }
  const sinControl = sinControlDeAsistencia(config, request)
  if (sinControl) return { error: sinControl }

  const [{ ok: diasOk, dias, horariosPorDia }, holiday, existing, configNomina] = await Promise.all([
    fetchDiasLaborablesEmpleado(env, headers, operador.cuenta_id, empleadoId, fecha),
    fetchFeriadoDelDia(env, headers, operador, fecha),
    fetchRegistroDelDia(env, headers, operador, empleadoId, fecha),
    fetchConfigNomina(env, headers, operador.cuenta_id),
  ])
  if (!diasOk) return { error: jsonError('No se pudieron verificar sus días laborables', 500, request) }
  if (holiday.error) return { error: jsonError('No se pudo consultar el calendario laboral', 500, request) }
  if (existing.error) return { error: jsonError('Error al leer la asistencia del día', 500, request) }

  const diaNoLaborable = !trabajaEnFecha(dias, fecha) || Boolean(holiday.row && holiday.row.laborable === false)
  const descansoDefault = Number(configNomina?.nomina_horas_descanso ?? 1.0)
  const horario = horarioEfectivoDelDia({ ...config, horarios_por_dia: horariosPorDia }, fecha, descansoDefault)
  return { config, holiday: holiday.row, existing: existing.row, diaNoLaborable, horario }
}

/**
 * POST /api/nomina/marcaje/horas-extra
 * Registra, modifica o quita (`horasExtra: 0`) las horas extras de un día.
 */
export async function handleRegistrarHorasExtra(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  const denegado = requireCapacidad(operador, 'administrarNomina', request)
  if (denegado) return denegado
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, fecha: fechaBody, horasExtra, nota, confirmarDiaTrabajado } = body || {}
  if (!empleadoId || !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  const fecha = fechaBody ? String(fechaBody).slice(0, 10) : nowInNominaZone(env).fecha
  if (!fechaNominaValida(fecha)) return jsonError('fecha inválida (YYYY-MM-DD)', 400, request)
  const horas = normalizarHorasExtra(horasExtra)
  if (horas === null) return jsonError('Indica horas extras válidas (0 para quitar, o entre 0.5 y 16 horas)', 400, request)
  if (!textoNominaValido(nota, 500)) return jsonError('nota inválida', 400, request)
  if (!booleanNominaValido(confirmarDiaTrabajado)) return jsonError('confirmarDiaTrabajado inválido', 400, request)

  const ctx = await verificarContextoDia(env, headers, operador, empleadoId, fecha, request)
  if (ctx.error) return ctx.error
  const { holiday, existing, diaNoLaborable, horario } = ctx
  const tenantFilter = nominaTenantFilter(operador.cuenta_id)

  if (horas === 0) {
    if (!existing) return json({ ok: true, idempotente: true, registro: null }, 200, request)
    if (existing.es_ausencia || existing.estado_marcaje !== 'manual') {
      return jsonError('Ese registro no es un ajuste manual de horas extras y no se modifica desde aquí.', 409, request)
    }
    const filtro = filtroConcurrenciaManual(existing, tenantFilter)
    if (!diaNoLaborable) {
      const del = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?${filtro}&select=id`, {
        method: 'DELETE',
        headers: svcHeaders(env, 'return=representation'),
      })
      if (!del.ok) return jsonError('No se pudieron quitar las horas extras', 500, request)
      const [borrado] = await del.json()
      if (!borrado) return jsonError('El registro cambió mientras guardabas. Actualiza la lista e inténtalo de nuevo.', 409, request)
      registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
        usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id,
        categoria: 'NOMINA', accion: 'QUITAR_HORAS_EXTRA', entidadTipo: 'registro_asistencia', entidadId: existing.id,
        meta: { empleadoId, fecha, antes: existing, despues: null }, ip,
      }).catch(() => {})
      return json({ ok: true, registro: null }, 200, request)
    }
    // En día de descanso/feriado trabajado, quitar extras deja el día como trabajado sin extras.
    const camposBase = construirRegistroExcepcion({ fecha, horario, horasExtra: 0, esFeriado: Boolean(holiday) })
    const patch = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?${filtro}&select=${SELECT_ASISTENCIA}`, {
      method: 'PATCH',
      headers: svcHeaders(env, 'return=representation'),
      body: JSON.stringify({ ...camposBase, nota: nota !== undefined ? (nota || null) : (existing.nota || null), registrado_por: operador.id }),
    })
    if (!patch.ok) return jsonError('No se pudieron quitar las horas extras', 500, request)
    const [actualizado] = await patch.json()
    if (!actualizado) return jsonError('El registro cambió mientras guardabas. Actualiza la lista e inténtalo de nuevo.', 409, request)
    registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id,
      categoria: 'NOMINA', accion: 'QUITAR_HORAS_EXTRA', entidadTipo: 'registro_asistencia', entidadId: existing.id,
      meta: { empleadoId, fecha, antes: existing, despues: actualizado }, ip,
    }).catch(() => {})
    return json({ ok: true, registro: actualizado }, 200, request)
  }

  if (existing?.es_ausencia) {
    return jsonError('Está marcado como ausente ese día. Quita la ausencia antes de registrar horas extras.', 409, request)
  }
  if (existing && existing.estado_marcaje !== 'manual') {
    return jsonError('Ese día tiene un marcaje histórico de reloj y no se modifica desde aquí.', 409, request)
  }
  if (diaNoLaborable && !existing && confirmarDiaTrabajado !== true) {
    return jsonError('Hoy es descanso o feriado no laborable. Márcalo primero como día trabajado.', 409, request)
  }

  const campos = construirRegistroExcepcion({ fecha, horario, horasExtra: horas, esFeriado: Boolean(holiday) })
  const payload = {
    ...campos,
    empleado_id: empleadoId,
    fecha,
    nota: nota !== undefined ? (nota || null) : (existing?.nota || null),
    registrado_por: operador.id,
    cuenta_id: operador.cuenta_id,
  }
  const url = existing
    ? `${env.SUPABASE_URL}/rest/v1/registro_asistencia?${filtroConcurrenciaManual(existing, tenantFilter)}&select=${SELECT_ASISTENCIA}`
    : `${env.SUPABASE_URL}/rest/v1/registro_asistencia?select=${SELECT_ASISTENCIA}`
  const response = await fetch(url, {
    method: existing ? 'PATCH' : 'POST',
    headers: svcHeaders(env, 'return=representation'),
    body: JSON.stringify(payload),
  })
  if (!response.ok) return jsonError('No se pudieron guardar las horas extras', response.status === 409 ? 409 : 500, request)
  const [registro] = await response.json()
  if (!registro) return jsonError('El registro cambió mientras guardabas. Actualiza la lista e inténtalo de nuevo.', 409, request)

  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id,
    categoria: 'NOMINA', accion: 'REGISTRAR_HORAS_EXTRA', entidadTipo: 'registro_asistencia', entidadId: registro.id,
    meta: { empleadoId, fecha, horasExtra: horas, antes: existing || null, despues: registro }, ip,
  }).catch(() => {})
  return json({ ok: true, registro }, existing ? 200 : 201, request)
}

/**
 * POST /api/nomina/marcaje/dia-trabajado
 * Marca o quita un día de descanso o feriado no laborable como trabajado.
 */
export async function handleMarcarDiaTrabajado(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  const denegado = requireCapacidad(operador, 'administrarNomina', request)
  if (denegado) return denegado
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, fecha: fechaBody, quitar = false, horasExtra = 0, nota } = body || {}
  if (!empleadoId || !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  const fecha = fechaBody ? String(fechaBody).slice(0, 10) : nowInNominaZone(env).fecha
  if (!fechaNominaValida(fecha)) return jsonError('fecha inválida (YYYY-MM-DD)', 400, request)
  if (!booleanNominaValido(quitar)) return jsonError('quitar inválido', 400, request)
  const extras = normalizarHorasExtra(horasExtra)
  if (extras === null) return jsonError('horasExtra inválidas (0 o entre 0.5 y 16)', 400, request)
  if (!textoNominaValido(nota, 500)) return jsonError('nota inválida', 400, request)

  const ctx = await verificarContextoDia(env, headers, operador, empleadoId, fecha, request)
  if (ctx.error) return ctx.error
  const { holiday, existing, diaNoLaborable, horario } = ctx
  if (!diaNoLaborable) {
    return jsonError('Este día ya es laborable: la persona figura presente por defecto.', 400, request)
  }

  const tenantFilter = nominaTenantFilter(operador.cuenta_id)
  if (quitar === true) {
    if (!existing) return jsonError('No hay día trabajado que quitar en esa fecha', 404, request)
    if (existing.es_ausencia || existing.estado_marcaje !== 'manual') {
      return jsonError('Ese registro no se puede quitar desde aquí.', 409, request)
    }
    const del = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?${filtroConcurrenciaManual(existing, tenantFilter)}&select=id`, {
      method: 'DELETE',
      headers: svcHeaders(env, 'return=representation'),
    })
    if (!del.ok) return jsonError('No se pudo quitar el día trabajado', 500, request)
    const [borrado] = await del.json()
    if (!borrado) return jsonError('El registro cambió mientras guardabas. Actualiza la lista.', 409, request)
    registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
      usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id,
      categoria: 'NOMINA', accion: 'QUITAR_DIA_TRABAJADO', entidadTipo: 'registro_asistencia', entidadId: existing.id,
      meta: { empleadoId, fecha, antes: existing }, ip,
    }).catch(() => {})
    return json({ ok: true, registro: null, deshecho: true }, 200, request)
  }

  if (existing && !existing.es_ausencia) {
    return json({ ok: true, idempotente: true, registro: existing }, 200, request)
  }
  if (existing?.es_ausencia) {
    return jsonError('Existe una ausencia en esa fecha. Quítala antes de marcar el día como trabajado.', 409, request)
  }

  const campos = construirRegistroExcepcion({ fecha, horario, horasExtra: extras, esFeriado: Boolean(holiday) })
  const payload = {
    ...campos,
    empleado_id: empleadoId,
    fecha,
    nota: nota || null,
    registrado_por: operador.id,
    cuenta_id: operador.cuenta_id,
  }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?select=${SELECT_ASISTENCIA}`, {
    method: 'POST',
    headers: svcHeaders(env, 'return=representation'),
    body: JSON.stringify(payload),
  })
  if (!response.ok) return jsonError('No se pudo marcar el día trabajado', response.status === 409 ? 409 : 500, request)
  const [registro] = await response.json()
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id,
    categoria: 'NOMINA', accion: 'MARCAR_DIA_TRABAJADO', entidadTipo: 'registro_asistencia', entidadId: registro?.id || null,
    meta: { empleadoId, fecha, horasExtra: extras, despues: registro }, ip,
  }).catch(() => {})
  return json({ ok: true, registro }, 201, request)
}
