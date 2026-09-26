// server/handlers/nomina.asistencia.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { requireCapacidad, tieneCapacidad } from '../lib/permissions.js'
import { registrarAuditoria } from '../lib/audit.js'
import { calcularCamposAsistencia } from '../lib/nominaUtils.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import {
  booleanNominaValido,
  fechaNominaValida,
  horaNominaValida,
  svcHeaders,
  tenantGuard,
  textoNominaValido,
  fechaOperativaNomina,
  fetchConfigNomina,
  fetchConfigsConControl,
  zonaNomina,
} from './nomina.shared.js'

// Los helpers de abajo se exportan para nomina.horarios.js (semana laboral por
// empleado y ausencia con reversa), que los comparte con el marcaje real.

export async function handleGetAsistencia(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
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
  // F-11: la lectura se pagina. Con una sola página de 500 el grid perdía en
  // silencio los últimos días de una semana desde ~71 empleados. El orden incluye
  // `empleado_id` para que el offset sea estable ((empleado_id, fecha) es único,
  // migración 209) y el techo delata datos anómalos en vez de tumbar la vista.
  const base = `${env.SUPABASE_URL}/rest/v1/registro_asistencia?order=fecha.asc,empleado_id.asc${filters}&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,es_sabado,es_domingo,es_feriado,es_ausencia,estado_marcaje,nota&limit=${ASISTENCIA_POR_PAGINA}`
  const registros = []
  let truncado = false
  for (let pagina = 0; pagina < ASISTENCIA_MAX_PAGINAS; pagina += 1) {
    const response = await fetch(`${base}&offset=${pagina * ASISTENCIA_POR_PAGINA}`, { headers })
    if (!response.ok) return jsonError('Error al leer asistencia', 500, request)
    const lote = await response.json() ?? []
    registros.push(...lote)
    if (lote.length < ASISTENCIA_POR_PAGINA) break
    if (pagina === ASISTENCIA_MAX_PAGINAS - 1) {
      truncado = true
      console.warn('[nomina] Asistencia truncada en el techo de paginación:', registros.length)
    }
  }
  // El objeto permite avisar del truncado; la UI lo muestra en vez de dar por
  // completo un rango incompleto.
  return json({ registros, truncado }, 200, request)
}

export function nowInNominaZone(env) {
  const now = env.NOMINA_NOW ? new Date(env.NOMINA_NOW) : new Date()
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zonaNomina(env), hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  // La fecha sale del mismo helper que usa el resto del módulo (una sola fuente para
  // la zona operativa); aquí solo se añade la hora del marcaje.
  return { fecha: fechaOperativaNomina(env), hora: `${values.hour === '24' ? '00' : values.hour}:${values.minute}`, marcadoEn: now.toISOString() }
}

function idempotencyKeyValida(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value.trim())
}

export function horaNominaNormalizada(value) {
  return value ? String(value).slice(0, 5) : null
}

function horaCoincideConOriginal(value, esperado) {
  return horaNominaNormalizada(value) === esperado
}

export async function fetchRegistroDelDia(env, headers, operador, empleadoId, fecha) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?empleado_id=eq.${empleadoId}&fecha=eq.${fecha}${nominaTenantFilter(operador.cuenta_id)}&select=id,hora_entrada,hora_salida,es_feriado,es_ausencia,estado_marcaje,nota,entrada_idempotency_key,salida_idempotency_key&limit=1`, { headers })
  if (!response.ok) return { error: true, row: null }
  const [row] = await response.json()
  return { error: false, row: row || null }
}

export async function periodoBloqueadoParaFecha(env, headers, operador, fecha) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?desde=lte.${fecha}&hasta=gte.${fecha}&estado=neq.abierto${nominaTenantFilter(operador.cuenta_id)}&select=nombre,estado&limit=1`, { headers })
  if (!response.ok) return null
  const [periodo] = await response.json()
  return periodo || null
}

export async function fetchConfigActiva(env, headers, operador, empleadoId) {
  const { ok, rows } = await fetchConfigsConControl(env, headers, {
    filtros: `empleado_id=eq.${empleadoId}&activo=eq.true${nominaTenantFilter(operador.cuenta_id)}`,
    select: 'horas_jornada',
  })
  if (!ok) return null
  return rows[0] || null
}

// El marcaje real solo aplica a quien tiene control de asistencia: si el perfil
// está configurado como "sin asistencia" (cobro por comisión), marcar sería pagar
// un día que ese perfil no devenga.
export function sinControlDeAsistencia(config, request) {
  if (config?.controla_asistencia === false) {
    return jsonError('Este perfil no tiene control de asistencia. Actívalo en su ficha de Empleados para poder marcarlo.', 400, request)
  }
  return null
}

// Paginación de la lectura de asistencia: 500 filas por página y 20 páginas
// (10.000 filas) como techo duro. Una semana completa de 71 personas son ~500
// filas, así que el techo solo aparece con datos anómalos.
export const ASISTENCIA_POR_PAGINA = 500
export const ASISTENCIA_MAX_PAGINAS = 20

export async function fetchFeriadoDelDia(env, headers, operador, fecha) {
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
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const { fecha } = nowInNominaZone(env)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?fecha=eq.${fecha}${nominaTenantFilter(operador.cuenta_id)}&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,horas_descanso,estado_marcaje,es_ausencia,es_sabado,es_feriado,entrada_marcada_en,salida_marcada_en,nota`, { headers })
  if (!response.ok) return jsonError('Error al leer marcaje del día', 500, request)
  return json({ fecha, registros: await response.json() ?? [] }, 200, request)
}

export async function handleMarcarEntrada(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!tieneCapacidad(operador, 'administrarNomina')) return jsonError('Tu rol no tiene permiso para marcar entradas', 403, request)
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
  const configEntrada = await fetchConfigActiva(env, headers, operador, empleadoId)
  if (!configEntrada) return jsonError('El empleado no tiene configuración activa de nómina', 400, request)
  const sinControlEntrada = sinControlDeAsistencia(configEntrada, request)
  if (sinControlEntrada) return sinControlEntrada
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
  if (!tieneCapacidad(operador, 'administrarNomina')) return jsonError('Tu rol no tiene permiso para marcar salidas', 403, request)
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
  const sinControlSalida = sinControlDeAsistencia(config, request)
  if (sinControlSalida) return sinControlSalida
  const holiday = await fetchFeriadoDelDia(env, headers, operador, mark.fecha)
  if (holiday.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)
  const existing = await fetchRegistroDelDia(env, headers, operador, empleadoId, mark.fecha)
  if (existing.error) return jsonError('Error al leer asistencia del día', 500, request)
  if (!existing.row?.hora_entrada) return jsonError('No existe una entrada marcada hoy', 409, request)
  if (existing.row.salida_idempotency_key === idempotencyKey.trim()) return json({ ok: true, idempotente: true, registro: existing.row }, 200, request)
  if (existing.row.hora_salida) return jsonError('El empleado ya tiene salida marcada hoy', 409, request)
  const dow = new Date(`${mark.fecha}T12:00:00`).getDay()
  const esSabado = dow === 6
  let descanso = 0
  if (!esSabado) {
    const configNomina = await fetchConfigNomina(env, headers, operador.cuenta_id)
    descanso = Number(configNomina?.nomina_horas_descanso != null ? configNomina.nomina_horas_descanso : 1.0)
  }
  let calculation
  try {
    calculation = calcularCamposAsistencia(
      mark.fecha,
      existing.row.hora_entrada,
      mark.hora,
      Number(config.horas_jornada) || 8,
      !!(existing.row.es_feriado || holiday.row),
      false,
      descanso
    )
  } catch (error) { return jsonError(error.message || 'Horas inválidas', 400, request) }
  const { horas_descanso: _hd, ...calcCampos } = calculation
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${existing.row.id}${nominaTenantFilter(operador.cuenta_id)}&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,es_feriado,es_ausencia,estado_marcaje,nota`, { method: 'PATCH', headers: { ...svcHeaders(env), Prefer: 'return=representation' }, body: JSON.stringify({ ...calcCampos, horas_descanso: descanso, hora_salida: mark.hora, estado_marcaje: existing.row.estado_marcaje === 'corregido' ? 'corregido' : 'completo', salida_marcada_en: mark.marcadoEn, salida_por: operador.id, salida_idempotency_key: idempotencyKey.trim(), registrado_por: operador.id, nota: nota || existing.row.nota || null }) })
  if (!response.ok) return jsonError('No se pudo registrar la salida', 409, request)
  const [registro] = await response.json()
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'MARCAR_SALIDA', entidadTipo: 'registro_asistencia', entidadId: existing.row.id, meta: { empleadoId, fecha: mark.fecha }, ip }).catch(() => {})
  return json({ ok: true, idempotente: false, registro }, 200, request)
}

export async function handleCorregirMarcaje(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!tieneCapacidad(operador, 'administrarNomina')) return jsonError('Tu rol no tiene permiso para corregir marcajes', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const {
    registroId,
    horaEntradaAnterior,
    horaSalidaAnterior,
    horaEntrada,
    horaSalida,
    motivo,
  } = body || {}
  if (!registroId || !isValidUuid(registroId)) return jsonError('registroId inválido', 400, request)
  const tieneHorasAnteriores = Object.prototype.hasOwnProperty.call(body || {}, 'horaEntradaAnterior')
    && Object.prototype.hasOwnProperty.call(body || {}, 'horaSalidaAnterior')
  if (!tieneHorasAnteriores
    || (horaEntradaAnterior !== null && !horaNominaValida(horaEntradaAnterior))
    || (horaSalidaAnterior !== null && !horaNominaValida(horaSalidaAnterior))) {
    return jsonError('Las horas originales del marcaje son inválidas', 400, request)
  }
  if (!horaNominaValida(horaEntrada)) return jsonError('La hora de entrada debe tener formato HH:MM', 400, request)
  if (horaSalida !== null && !horaNominaValida(horaSalida)) return jsonError('La hora de salida debe tener formato HH:MM', 400, request)
  if (!textoNominaValido(motivo, 500) || typeof motivo !== 'string' || motivo.trim().length < 3) {
    return jsonError('Indica el motivo de la corrección (mínimo 3 caracteres)', 400, request)
  }

  const recordResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${registroId}${nominaTenantFilter(operador.cuenta_id)}&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,horas_descanso,es_feriado,es_ausencia,estado_marcaje,entrada_idempotency_key,salida_idempotency_key&limit=1`, { headers })
  if (!recordResponse.ok) return jsonError('No se pudo consultar el marcaje', 500, request)
  const [registro] = await recordResponse.json()
  if (!registro) return jsonError('Marcaje no encontrado', 404, request)
  if (registro.es_ausencia || !registro.hora_entrada || !['entrada', 'completo', 'corregido'].includes(registro.estado_marcaje)) {
    return jsonError('Solo se pueden corregir marcajes reales; los horarios manuales y las ausencias no se modifican aquí', 409, request)
  }

  const entradaOriginal = horaNominaNormalizada(registro.hora_entrada)
  const salidaOriginal = horaNominaNormalizada(registro.hora_salida)
  if (!horaCoincideConOriginal(registro.hora_entrada, horaEntradaAnterior)
    || !horaCoincideConOriginal(registro.hora_salida, horaSalidaAnterior)) {
    return jsonError('El marcaje cambió desde que se abrió la corrección. Actualiza la lista e inténtalo de nuevo.', 409, request)
  }
  if ((registro.hora_salida === null) !== (horaSalida === null)) {
    return jsonError('La corrección solo puede ajustar horas ya marcadas; no registra ni elimina una salida', 400, request)
  }
  if (horaEntrada === entradaOriginal && horaSalida === salidaOriginal) return jsonError('No hay cambios que guardar', 400, request)

  const periodResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?desde=lte.${registro.fecha}&hasta=gte.${registro.fecha}&estado=neq.abierto${nominaTenantFilter(operador.cuenta_id)}&select=nombre,estado&limit=1`, { headers })
  if (!periodResponse.ok) return jsonError('No se pudo verificar el estado del período de nómina', 500, request)
  const [period] = await periodResponse.json()
  if (period) return jsonError(`No se puede corregir: el período está ${period.estado}`, 400, request)

  const configResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?empleado_id=eq.${registro.empleado_id}${nominaTenantFilter(operador.cuenta_id)}&select=horas_jornada&limit=1`, { headers })
  if (!configResponse.ok) return jsonError('No se pudo consultar la jornada del empleado', 500, request)
  const [configEmpleado] = await configResponse.json()
  if (!configEmpleado) return jsonError('El empleado no tiene configuración de nómina', 400, request)

  const cambios = {
    hora_entrada: horaEntrada,
    hora_salida: horaSalida,
    estado_marcaje: 'corregido',
    es_ausencia: false,
  }
  let horasDescansoAplicadas = null
  if (horaSalida !== null) {
    const esSabado = new Date(`${registro.fecha}T12:00:00`).getDay() === 6
    if (registro.horas_descanso !== null && registro.horas_descanso !== undefined) {
      horasDescansoAplicadas = Number(registro.horas_descanso)
      if (!Number.isFinite(horasDescansoAplicadas) || horasDescansoAplicadas < 0 || horasDescansoAplicadas > 12) {
        return jsonError('El descanso guardado en el marcaje no es válido', 400, request)
      }
    } else if (!esSabado) {
      const configNomina = await fetchConfigNomina(env, headers, operador.cuenta_id)
      horasDescansoAplicadas = Number(configNomina?.nomina_horas_descanso ?? 1.0)
    } else {
      horasDescansoAplicadas = 0
    }
    if (!Number.isFinite(horasDescansoAplicadas) || horasDescansoAplicadas < 0 || horasDescansoAplicadas > 12) {
      return jsonError('Las horas de descanso configuradas no son válidas', 400, request)
    }
    cambios.horas_descanso = horasDescansoAplicadas

    let calculation
    try {
      calculation = calcularCamposAsistencia(
        registro.fecha,
        horaEntrada,
        horaSalida,
        Number(configEmpleado.horas_jornada) || 8,
        !!registro.es_feriado,
        false,
        horasDescansoAplicadas
      )
    } catch (error) { return jsonError(error.message || 'Horas inválidas', 400, request) }
    const { horas_descanso: _horasDescanso, ...camposCalculados } = calculation
    Object.assign(cambios, camposCalculados)
  }

  // Compare-and-set con los valores leídos arriba: una segunda edición o un
  // marcaje concurrente no puede sobrescribir silenciosamente esta corrección.
  const entradaFilter = `&hora_entrada=eq.${encodeURIComponent(registro.hora_entrada)}`
  const salidaFilter = registro.hora_salida === null
    ? '&hora_salida=is.null'
    : `&hora_salida=eq.${encodeURIComponent(registro.hora_salida)}`
  const patchResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${registroId}${nominaTenantFilter(operador.cuenta_id)}${entradaFilter}${salidaFilter}&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,horas_descanso,es_ausencia,estado_marcaje`, {
    method: 'PATCH',
    headers: { ...svcHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify(cambios),
  })
  if (!patchResponse.ok) return jsonError('No se pudo guardar la corrección', 500, request)
  const [registroCorregido] = await patchResponse.json()
  if (!registroCorregido) return jsonError('El marcaje cambió mientras guardabas. Actualiza la lista y vuelve a intentarlo.', 409, request)

  await registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA',
    accion: 'CORREGIR_MARCAJE',
    entidadTipo: 'registro_asistencia',
    entidadId: registro.id,
    meta: {
      empleadoId: registro.empleado_id,
      fecha: registro.fecha,
      motivo: motivo.trim(),
      entrada: { antes: entradaOriginal, despues: horaEntrada },
      salida: { antes: salidaOriginal, despues: horaSalida },
      horasTrabajadas: {
        antes: Number(registro.horas_trabajadas || 0),
        despues: Number(registroCorregido.horas_trabajadas || 0),
      },
      horasDescansoAplicadas,
    },
    ip,
  }).catch(() => {})

  return json({ ok: true, registro: registroCorregido }, 200, request)
}

export async function handleGetFeriados(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
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
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
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

export async function handleEliminarFeriado(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, ip } = v
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { id } = body || {}
  if (!id || !isValidUuid(id)) return jsonError('id inválido', 400, request)
  const recordResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_feriados?id=eq.${id}${nominaTenantFilter(operador.cuenta_id)}&select=id,fecha,nombre&limit=1`, { headers: svcHeaders(env) })
  const [record] = recordResponse.ok ? await recordResponse.json() : []
  if (!record) return jsonError('Feriado no encontrado', 404, request)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_feriados?id=eq.${id}${nominaTenantFilter(operador.cuenta_id)}`, { method: 'DELETE', headers: svcHeaders(env, 'return=minimal') })
  if (!response.ok) return jsonError('Error al eliminar feriado', 500, request)
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'ELIMINAR_FERIADO', entidadTipo: 'nomina_feriado', entidadId: id, meta: { fecha: record.fecha, nombre: record.nombre }, ip }).catch(() => {})
  return json({ ok: true }, 200, request)
}

export async function handleGetHorarios(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
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
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
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
  // Migración 247: un horario permanente por (empleado, día). Un 409 aquí ya no es
  // un error genérico: ese día ya tiene horario y el cambio va en la ficha.
  if (!response.ok) {
    return response.status === 409
      ? jsonError('Ese día ya tiene un horario permanente para esta persona. Edítalo en «Días que trabaja» de su ficha.', 409, request)
      : jsonError('Error al crear horario', 500, request)
  }
  const [schedule] = await response.json()
  return json({ ok: true, horario: schedule }, 201, request)
}
