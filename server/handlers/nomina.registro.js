// server/handlers/nomina.registro.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { calcularCamposAsistencia } from '../lib/nominaUtils.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { empleadosLibresEseDia, fetchDiasLaborablesEmpleado, fetchDiasLaborablesPorEmpleado, trabajaEnFecha } from '../lib/nominaHorarios.js'
import { requireCapacidad } from '../lib/permissions.js'
import { booleanNominaValido, construirPayloadAsistenciaManual, fechaNominaValida, horaNominaValida, svcHeaders, tenantGuard, textoNominaValido, fetchConfigNomina, fetchConfigsConControl } from './nomina.shared.js'
import { fetchFeriadoDelDia, validarFeriadoSolicitado } from './nomina.asistencia.js'

async function periodForDate(env, headers, operador, fecha) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?desde=lte.${fecha}&hasta=gte.${fecha}&estado=neq.abierto${nominaTenantFilter(operador.cuenta_id)}&select=id,nombre,estado&limit=1`, { headers })
  if (!response.ok) return { error: true, period: null }
  const [period] = await response.json()
  return { error: false, period: period || null }
}

function periodoCheckError(request) {
  return jsonError('No se pudo comprobar el estado del período de nómina', 500, request)
}

function periodoBloqueado(periodCheck) {
  return periodCheck.period
}

function conflictoRegistro(request) {
  return jsonError('El registro cambió o ya existe. Actualiza la asistencia antes de volver a intentar.', 409, request)
}

export async function handleRegistrarAsistencia(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, fecha, horaEntrada, horaSalida, esFeriado, esAusencia, nota, horasDescanso, registroIdEsperado, estadoMarcajeEsperado } = body || {}
  if (!empleadoId || !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (!booleanNominaValido(esFeriado) || !booleanNominaValido(esAusencia)) return jsonError('esFeriado y esAusencia deben ser booleanos', 400, request)
  if (!fechaNominaValida(fecha)) return jsonError('fecha inválida (YYYY-MM-DD)', 400, request)
  // Un registro manual de horas exige entrada Y salida: sin salida la fila se pagaba
  // como día completo con 0 h (contrato en server/lib/nominaUtils.js). La ausencia es
  // la única forma válida de guardar una jornada sin horas.
  if (esAusencia !== true && (!horaNominaValida(horaEntrada) || !horaNominaValida(horaSalida))) {
    return jsonError('Indica la hora de entrada y la de salida (HH:MM), o marca la jornada como ausencia', 400, request)
  }
  if (!textoNominaValido(nota, 500)) return jsonError('nota inválida', 400, request)
  if (registroIdEsperado !== undefined && registroIdEsperado !== null && !isValidUuid(registroIdEsperado)) return jsonError('registroIdEsperado inválido', 400, request)
  if (estadoMarcajeEsperado !== undefined && estadoMarcajeEsperado !== null && estadoMarcajeEsperado !== 'manual') return jsonError('Solo se pueden editar registros manuales desde este formulario', 400, request)
  const periodCheck = await periodForDate(env, headers, operador, fecha)
  if (periodCheck.error) return periodoCheckError(request)
  const period = periodoBloqueado(periodCheck)
  if (period) return jsonError(`No se puede editar asistencia: el período "${period.nombre}" está ${period.estado}`, 400, request)
  const holiday = await validarFeriadoSolicitado(env, headers, operador, fecha, esFeriado)
  if (holiday.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)
  if (esFeriado && !holiday.row) return jsonError('El feriado debe estar registrado en el calendario laboral', 400, request)
  const { ok: configOk, rows: configRows } = await fetchConfigsConControl(env, headers, {
    filtros: `empleado_id=eq.${empleadoId}${nominaTenantFilter(operador.cuenta_id)}`,
    select: 'horas_jornada',
  })
  if (!configOk) return jsonError('No se pudo verificar la configuración del empleado', 500, request)
  const [config] = configRows
  if (!config) return jsonError('El empleado no tiene configuración de nómina', 400, request)
  if (config.controla_asistencia === false) return jsonError('Este perfil no tiene control de asistencia. Actívalo en su ficha de Empleados para registrar horas.', 400, request)
  // F-10: una ausencia solo tiene sentido en un día que le toca trabajar, igual que
  // en el reloj real. Antes «Manual nómina» podía inventar faltas en un día libre o
  // en un feriado no laborable; el registro de HORAS sí sigue permitido en cualquier
  // fecha (cargar historia) porque no afirma que la persona faltó.
  if (esAusencia === true) {
    const { ok: diasOk, dias } = await fetchDiasLaborablesEmpleado(env, headers, operador.cuenta_id, empleadoId, fecha)
    if (!diasOk) return jsonError('No se pudieron verificar sus días laborables', 500, request)
    if (!trabajaEnFecha(dias, fecha)) {
      return jsonError('Ese día es libre para esta persona según sus días laborables: una ausencia aquí no corresponde.', 400, request)
    }
    // Un feriado NO laborable se comporta como día libre (mismo criterio que el reloj
    // real). Si el registro ya viene marcado como feriado, esa fila basta.
    let feriado = holiday.row
    if (!feriado) {
      const consulta = await fetchFeriadoDelDia(env, headers, operador, fecha)
      if (consulta.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)
      feriado = consulta.row
    }
    if (feriado && feriado.laborable === false) {
      return jsonError(`Ese día es feriado (${feriado.nombre || 'feriado'}) y no es laborable: una ausencia aquí no corresponde.`, 400, request)
    }
  }

  let descanso = 0
  if (horasDescanso !== undefined && horasDescanso !== null) {
    const num = Number(horasDescanso)
    if (!Number.isFinite(num) || num < 0 || num > 12) {
      return jsonError('horasDescanso inválida (debe estar entre 0 y 12)', 400, request)
    }
    descanso = num
  } else {
    const dow = new Date(`${fecha}T12:00:00`).getDay()
    const esSabado = dow === 6
    if (!esSabado) {
      const configNomina = await fetchConfigNomina(env, headers, operador.cuenta_id)
      descanso = Number(configNomina?.nomina_horas_descanso != null ? configNomina.nomina_horas_descanso : 1.0)
    }
  }

  let calculation
  try {
    calculation = calcularCamposAsistencia(
      fecha,
      horaEntrada || null,
      horaSalida || null,
      Number(config.horas_jornada) || 8,
      !!(holiday.row || esFeriado),
      !!esAusencia,
      descanso
    )
  } catch (error) { return jsonError(error.message || 'Horas inválidas', 400, request) }

  const payload = construirPayloadAsistenciaManual({
    empleadoId, fecha, horaEntrada, horaSalida, esAusencia, esFeriado: holiday.row || esFeriado,
    nota, descanso, operador, calculation,
  })
  const existingResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?empleado_id=eq.${empleadoId}&fecha=eq.${fecha}${nominaTenantFilter(operador.cuenta_id)}&select=id,estado_marcaje,hora_entrada,hora_salida,es_ausencia&limit=1`, { headers })
  if (!existingResponse.ok) return jsonError('No se pudo comprobar si ya existe un registro', 500, request)
  const [existing] = await existingResponse.json()
  if (registroIdEsperado !== undefined && (existing?.id || null) !== registroIdEsperado) return conflictoRegistro(request)
  if (estadoMarcajeEsperado !== undefined && (existing?.estado_marcaje || null) !== estadoMarcajeEsperado) return conflictoRegistro(request)

  let response
  if (existing) {
    if (existing.estado_marcaje !== 'manual') {
      return jsonError('Este día tiene un marcaje real del reloj. No puede reemplazarse con asistencia manual.', 409, request)
    }
    const entradaEsperada = existing.hora_entrada === null ? '&hora_entrada=is.null' : `&hora_entrada=eq.${encodeURIComponent(existing.hora_entrada)}`
    const salidaEsperada = existing.hora_salida === null ? '&hora_salida=is.null' : `&hora_salida=eq.${encodeURIComponent(existing.hora_salida)}`
    const ausenciaEsperada = `&es_ausencia=eq.${existing.es_ausencia}`
    response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${existing.id}&estado_marcaje=eq.manual${entradaEsperada}${salidaEsperada}${ausenciaEsperada}${nominaTenantFilter(operador.cuenta_id)}&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,es_sabado,es_domingo,es_feriado,es_ausencia,horas_descanso,estado_marcaje,nota`, {
      method: 'PATCH',
      headers: { ...svcHeaders(env), Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    })
  } else {
    response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,es_sabado,es_domingo,es_feriado,es_ausencia,horas_descanso,estado_marcaje,nota`, {
      method: 'POST',
      headers: { ...svcHeaders(env), Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    })
  }
  if (!response.ok) return jsonError('No se pudo guardar la asistencia. Actualiza los datos e inténtalo de nuevo.', response.status === 409 ? 409 : 500, request)
  const [row] = await response.json()
  if (!row) return conflictoRegistro(request)
  return json({ ok: true, registro: row }, existing ? 200 : 201, request)
}

export async function handleRegistrarAsistenciaMasivo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { fecha, horaEntrada, horaSalida, esFeriado, empleadoIds, horasDescanso } = body || {}
  if (!booleanNominaValido(esFeriado)) return jsonError('esFeriado inválido', 400, request)
  if (!fechaNominaValida(fecha)) return jsonError('fecha inválida (YYYY-MM-DD)', 400, request)
  // Mismo contrato que el registro individual: el horario previsto se carga con las
  // dos horas; una fila sin horas se liquidaba como día completo con 0 h trabajadas.
  if (!horaNominaValida(horaEntrada) || !horaNominaValida(horaSalida)) return jsonError('Indica la hora de entrada y la de salida (HH:MM) del horario previsto', 400, request)
  const periodCheck = await periodForDate(env, headers, operador, fecha)
  if (periodCheck.error) return periodoCheckError(request)
  const period = periodoBloqueado(periodCheck)
  if (period) return jsonError(`No se puede editar asistencia: el período "${period.nombre}" está ${period.estado}`, 400, request)
  if (!Array.isArray(empleadoIds) || !empleadoIds.length || empleadoIds.length > 500
    || empleadoIds.some(id => !isValidUuid(id)) || new Set(empleadoIds).size !== empleadoIds.length) {
    return jsonError('Selecciona entre 1 y 500 empleados válidos para aplicar el horario', 400, request)
  }
  const holiday = await validarFeriadoSolicitado(env, headers, operador, fecha, esFeriado)
  if (holiday.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)
  if (esFeriado && !holiday.row) return jsonError('El feriado debe estar registrado en el calendario laboral', 400, request)

  let descanso = 0
  if (horasDescanso !== undefined && horasDescanso !== null) {
    const num = Number(horasDescanso)
    if (!Number.isFinite(num) || num < 0 || num > 12) {
      return jsonError('horasDescanso inválida (debe estar entre 0 y 12)', 400, request)
    }
    descanso = num
  } else {
    const dow = new Date(`${fecha}T12:00:00`).getDay()
    const esSabado = dow === 6
    if (!esSabado) {
      const configNomina = await fetchConfigNomina(env, headers, operador.cuenta_id)
      descanso = Number(configNomina?.nomina_horas_descanso != null ? configNomina.nomina_horas_descanso : 1.0)
    }
  }

  const idsFilter = `&empleado_id=in.(${empleadoIds.join(',')})`
  const configLectura = await fetchConfigsConControl(env, headers, {
    filtros: `activo=eq.true${nominaTenantFilter(operador.cuenta_id)}${idsFilter}`,
    select: 'empleado_id,horas_jornada',
    limit: 500,
  })
  if (!configLectura.ok) return jsonError('Error al leer empleados', 500, request)
  const employees = configLectura.rows
  if (employees.length !== empleadoIds.length || new Set(employees.map(employee => employee.empleado_id)).size !== empleadoIds.length) return jsonError('La lista de empleados activos cambió. Actualiza la plantilla y vuelve a revisar la vista previa.', 409, request)
  // La carga masiva nunca escribe asistencia para perfiles sin control de asistencia.
  if (employees.some(employee => employee.controla_asistencia === false)) return jsonError('La selección incluye perfiles sin control de asistencia. Quítalos de la lista y vuelve a aplicar el horario.', 409, request)
  // Y tampoco para quien no trabaja ese día (p. ej. el sábado de quien no viene):
  // cargar horario previsto o marcar falta ahí inventaría jornadas y ausencias.
  const diasResueltos = await fetchDiasLaborablesPorEmpleado(env, headers, operador.cuenta_id, { empleadoIds })
  if (!diasResueltos.ok) return jsonError('No se pudieron verificar los días laborables de la selección', 500, request)
  const libres = empleadosLibresEseDia(empleadoIds, diasResueltos.porEmpleado, fecha)
  if (libres.length) {
    return jsonError(`Ese día es libre para ${libres.length} de los ${empleadoIds.length} empleados seleccionados. Quítalos de la selección: la carga masiva solo escribe en los días laborables de cada uno.`, 409, request)
  }
  const existingResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?fecha=eq.${fecha}${nominaTenantFilter(operador.cuenta_id)}&empleado_id=in.(${empleadoIds.join(',')})&select=empleado_id,estado_marcaje&limit=500`, { headers })
  if (!existingResponse.ok) return jsonError('No se pudo comprobar qué empleados ya tienen registro', 500, request)
  const [existing] = await existingResponse.json()
  if (existing) return jsonError('Al menos un empleado ya tiene registro para esta fecha. No se modificó ninguno; actualiza y revisa la vista previa.', 409, request)
  let rows
  try {
    rows = employees.map(employee => {
      const calc = calcularCamposAsistencia(
        fecha,
        horaEntrada || null,
        horaSalida || null,
        Number(employee.horas_jornada) || 8,
        !!(holiday.row || esFeriado),
        false,
        descanso
      )
      const { horas_descanso: _hd, ...calcCampos } = calc
      return {
        empleado_id: employee.empleado_id,
        fecha,
        hora_entrada: horaEntrada || null,
        hora_salida: horaSalida || null,
        ...calcCampos,
        horas_descanso: descanso,
        estado_marcaje: 'manual',
        registrado_por: operador.id,
        cuenta_id: operador.cuenta_id,
      }
    })
  } catch (error) { return jsonError(error.message || 'Horas inválidas', 400, request) }
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia`, { method: 'POST', headers: svcHeaders(env, 'return=minimal'), body: JSON.stringify(rows) })
  if (!response.ok) return jsonError('No se pudo aplicar el horario. Puede que un registro haya cambiado; actualiza y revisa antes de reintentar.', response.status === 409 ? 409 : 500, request)
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'ASISTENCIA_MASIVA', entidadTipo: 'registro_asistencia', entidadId: null, meta: { fecha, empleados: rows.length, hora_entrada: horaEntrada, hora_salida: horaSalida }, ip }).catch(() => {})
  return json({ ok: true, registros: rows.length }, 200, request)
}

export async function handleEliminarAsistencia(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { id } = body || {}
  if (!id || !isValidUuid(id)) return jsonError('id inválido', 400, request)
  const recordResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${id}${nominaTenantFilter(operador.cuenta_id)}&select=fecha&limit=1`, { headers })
  const [record] = recordResponse.ok ? await recordResponse.json() : []
  if (!record) return jsonError('Registro no encontrado', 404, request)
  const periodCheck = await periodForDate(env, headers, operador, record.fecha)
  if (periodCheck.error) return periodoCheckError(request)
  const period = periodoBloqueado(periodCheck)
  if (period) return jsonError(`No se puede eliminar: el período "${period.nombre}" está ${period.estado}`, 400, request)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${id}${nominaTenantFilter(operador.cuenta_id)}`, { method: 'DELETE', headers: svcHeaders(env, 'return=minimal') })
  if (!response.ok) return jsonError('Error al eliminar registro', 500, request)
  return json({ ok: true }, 200, request)
}
