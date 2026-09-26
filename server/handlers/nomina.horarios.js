// server/handlers/nomina.horarios.js
// Semana laboral por empleado (qué días trabaja y con qué jornada) y la ausencia
// del día con su reversa. Extraído de nomina.asistencia.js para mantener cada
// dominio por debajo del límite de 600 líneas del guardarraíl de proyecto.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { requireCapacidad, tieneCapacidad } from '../lib/permissions.js'
import { registrarAuditoria } from '../lib/audit.js'
import { calcularCamposAsistencia } from '../lib/nominaUtils.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import {
  DIA_LABORABLE_MAX,
  DIA_LABORABLE_MIN,
  fetchDiasLaborablesEmpleado,
  trabajaEnFecha,
} from '../lib/nominaHorarios.js'
import {
  booleanNominaValido,
  construirPayloadAsistenciaManual,
  fechaOperativaNomina,
  horaNominaValida,
  svcHeaders,
  tenantGuard,
  textoNominaValido,
} from './nomina.shared.js'
import {
  fetchConfigActiva,
  fetchFeriadoDelDia,
  fetchRegistroDelDia,
  horaNominaNormalizada,
  nowInNominaZone,
  periodoBloqueadoParaFecha,
  sinControlDeAsistencia,
} from './nomina.asistencia.js'

// Fecha de vigencia de una semana laboral cargada desde la ficha del empleado: es
// su horario permanente (no un cambio programado), así que la matriz semanal se ve
// igual para cualquier semana que se consulte.
const FECHA_VIGENCIA_PERMANENTE = '2000-01-01'

// Reemplaza la semana laboral de una persona: qué días trabaja y con qué jornada
// cada uno. Es la fuente de verdad de "libre" / "pendiente" en asistencia y del
// guardarraíl de la carga masiva. Se escribe como horario permanente (semana_ciclo
// y fecha_hasta nulos) para que la matriz semanal sea estable en el tiempo.
export async function handleGuardarHorarioEmpleado(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  const denegadoAdmin = requireCapacidad(operador, 'gestionarUsuarios', request)
  if (denegadoAdmin) return denegadoAdmin
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, dias } = body || {}
  if (!empleadoId || !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (!Array.isArray(dias)) return jsonError('dias inválido: envía la lista de días laborables', 400, request)
  if (dias.length > DIA_LABORABLE_MAX) return jsonError('Demasiados días laborables para una semana', 400, request)

  const filas = []
  const vistos = new Set()
  for (const dia of dias) {
    const dow = Number(dia?.diaSemana)
    if (!Number.isInteger(dow) || dow < DIA_LABORABLE_MIN || dow > DIA_LABORABLE_MAX) {
      return jsonError('Los días laborables van de lunes a sábado: el domingo se paga como feriado', 400, request)
    }
    if (vistos.has(dow)) return jsonError('Hay días repetidos en la semana laboral', 400, request)
    vistos.add(dow)
    const horaInicio = horaNominaNormalizada(dia?.horaInicio)
    const horaFin = horaNominaNormalizada(dia?.horaFin)
    if (!horaNominaValida(horaInicio) || !horaNominaValida(horaFin)) return jsonError('Cada día laborable necesita entrada y salida válidas (HH:MM)', 400, request)
    if (horaFin <= horaInicio) return jsonError('La hora de salida debe ser posterior a la de entrada', 400, request)
    const horas = Number(dia?.horasJornada)
    if (!(Number.isFinite(horas) && horas > 0 && horas <= 24)) return jsonError('horasJornada inválida (debe estar entre 0 y 24)', 400, request)
    filas.push({ dia_semana: dow, hora_inicio: horaInicio, hora_fin: horaFin, horas_jornada: Math.round(horas * 100) / 100 })
  }
  if (!filas.length) return jsonError('Selecciona al menos un día laborable. Si esta persona no debe controlar asistencia, desactívalo en su ficha de Empleados.', 400, request)

  const config = await fetchConfigActiva(env, headers, operador, empleadoId)
  if (!config) return jsonError('El empleado no tiene configuración activa de nómina', 400, request)

  const tenantFilter = nominaTenantFilter(operador.cuenta_id)
  // F-9: este editor solo toca la semana YA vigente; un horario programado a futuro
  // (fecha_desde posterior a hoy) no se pisa ni se borra desde aquí.
  const hoy = fechaOperativaNomina(env)
  const semanaUrl = `${env.SUPABASE_URL}/rest/v1/nomina_horarios?empleado_id=eq.${empleadoId}&semana_ciclo=is.null&fecha_hasta=is.null&fecha_desde=lte.${hoy}${tenantFilter}`

  const actualResponse = await fetch(`${semanaUrl}&select=id,dia_semana`, { headers })
  if (!actualResponse.ok) return jsonError('No se pudo leer la semana laboral actual; no se cambió nada', 500, request)
  const actuales = await actualResponse.json() ?? []
  const idPorDia = new Map(actuales.map(fila => [Number(fila.dia_semana), fila.id]))

  // F-7: la semana se ESCRIBE antes de retirar nada y los días que ya existían se
  // actualizan en su propia fila (no se borra todo para volver a insertar). Si algo
  // falla, la persona conserva su semana anterior en la base.
  const valores = (fila, conEmpleado) => ({
    ...(conEmpleado ? { empleado_id: empleadoId } : {}),
    ...fila,
    semana_ciclo: null,
    grupo_rotacion: null,
    fecha_desde: FECHA_VIGENCIA_PERMANENTE,
    fecha_hasta: null,
    trabaja: true,
    cuenta_id: operador.cuenta_id,
    creado_por: operador.id,
  })
  const guardadas = []
  for (const fila of filas) {
    const existenteId = idPorDia.get(fila.dia_semana)
    const response = existenteId
      ? await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_horarios?id=eq.${existenteId}${tenantFilter}`, {
        method: 'PATCH',
        headers: svcHeaders(env, 'return=representation'),
        body: JSON.stringify(valores(fila, false)),
      })
      : await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_horarios`, {
        method: 'POST',
        headers: svcHeaders(env, 'return=representation'),
        body: JSON.stringify([valores(fila, true)]),
      })
    if (!response.ok) {
      // Nunca se retiró un día antes de escribir: si algo falla aquí, la persona
      // conserva todos los días que ya tenía (F-7).
      return jsonError('No se pudieron guardar los días laborables: no se retiró ningún día de su semana anterior. Vuelve a intentarlo.', response.status === 409 ? 409 : 500, request)
    }
    guardadas.push(...(await response.json() ?? []))
  }

  // Retirar solo los días que esa persona ya no trabaja. Si el retiro falla, la
  // semana nueva queda guardada y se avisa: el siguiente guardado no duplica nada
  // porque cada día se actualiza en su fila.
  const diasNuevos = new Set(filas.map(fila => fila.dia_semana))
  const aRetirar = actuales.filter(fila => !diasNuevos.has(Number(fila.dia_semana))).map(fila => fila.id)
  let aviso = null
  if (aRetirar.length) {
    const borrado = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_horarios?id=in.(${aRetirar.join(',')})${tenantFilter}`, { method: 'DELETE', headers: svcHeaders(env, 'return=minimal') })
    if (!borrado.ok) {
      aviso = 'La semana nueva se guardó, pero no se pudieron retirar los días anteriores. Vuelve a guardar para completar el cambio.'
    }
  }
  const diasLaborables = filas.map(fila => fila.dia_semana).sort((a, b) => a - b)
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'GUARDAR_DIAS_LABORABLES', entidadTipo: 'nomina_horario', entidadId: empleadoId, meta: { dias: diasLaborables }, ip }).catch(() => {})
  return json({ ok: true, dias_laborables: diasLaborables, horarios: guardadas, ...(aviso ? { aviso } : {}) }, 200, request)
}

// Ausencia de hoy con su reversa. Vive aquí (no en asistencia/eliminar) porque es
// una acción del reloj real: la opera quien marca entradas y salidas, y solo sobre
// días laborables. Nunca borra horas reales del reloj.
export async function handleMarcarAusencia(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!tieneCapacidad(operador, 'administrarNomina')) return jsonError('Tu rol no tiene permiso para registrar ausencias', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { empleadoId, quitar } = body || {}
  if (!empleadoId || !isValidUuid(empleadoId)) return jsonError('empleadoId inválido', 400, request)
  if (!booleanNominaValido(quitar)) return jsonError('quitar inválido', 400, request)

  const mark = nowInNominaZone(env)
  const period = await periodoBloqueadoParaFecha(env, headers, operador, mark.fecha)
  if (period) return jsonError(`No se puede registrar: el período está ${period.estado}`, 400, request)
  const config = await fetchConfigActiva(env, headers, operador, empleadoId)
  if (!config) return jsonError('El empleado no tiene configuración activa de nómina', 400, request)
  const sinControl = sinControlDeAsistencia(config, request)
  if (sinControl) return sinControl
  const existing = await fetchRegistroDelDia(env, headers, operador, empleadoId, mark.fecha)
  if (existing.error) return jsonError('Error al leer la asistencia del día', 500, request)
  const tenantFilter = nominaTenantFilter(operador.cuenta_id)

  if (quitar === true) {
    const registro = existing.row
    if (!registro) return jsonError('Hoy no hay ningún registro que deshacer', 404, request)
    if (!registro.es_ausencia) return jsonError('El registro de hoy no es una ausencia: las horas del reloj no se borran desde aquí, usa «Corregir marcaje».', 409, request)
    if (registro.estado_marcaje !== 'manual') return jsonError('Esa ausencia no es un registro manual y no se puede deshacer desde aquí.', 409, request)
    const borrado = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${registro.id}&es_ausencia=eq.true&estado_marcaje=eq.manual${tenantFilter}`, { method: 'DELETE', headers: svcHeaders(env, 'return=representation') })
    if (!borrado.ok) return jsonError('No se pudo deshacer la ausencia', 500, request)
    const [deshecha] = await borrado.json()
    if (!deshecha) return jsonError('La ausencia cambió o ya no existe. Actualiza los marcajes del día.', 409, request)
    registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'DESHACER_AUSENCIA', entidadTipo: 'registro_asistencia', entidadId: registro.id, meta: { empleadoId, fecha: mark.fecha }, ip }).catch(() => {})
    return json({ ok: true, deshecha: true }, 200, request)
  }

  if (existing.row) {
    if (existing.row.es_ausencia) return json({ ok: true, idempotente: true, ya_registrada: true }, 200, request)
    if (['entrada', 'completo', 'corregido'].includes(existing.row.estado_marcaje)) {
      return jsonError('Hoy ya tiene marcaje real del reloj. Corrígelo en «Corregir marcaje» en lugar de registrar una ausencia.', 409, request)
    }
    return jsonError('Hoy ya tiene un registro de asistencia. Edítalo o elimínalo antes de marcarlo como ausente.', 409, request)
  }

  const { ok: diasOk, dias } = await fetchDiasLaborablesEmpleado(env, headers, operador.cuenta_id, empleadoId)
  if (!diasOk) return jsonError('No se pudieron verificar sus días laborables', 500, request)
  if (!trabajaEnFecha(dias, mark.fecha)) {
    return jsonError('Hoy es día libre de esta persona según sus días laborables: una ausencia aquí no corresponde.', 400, request)
  }
  const holiday = await fetchFeriadoDelDia(env, headers, operador, mark.fecha)
  if (holiday.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)
  // Un feriado NO laborable es como el día libre: nadie está obligado a asistir, así
  // que una ausencia ahí sería una falta inventada (F-6 del plan de flujo de nómina).
  // Un feriado laborable sí espera asistencia (recargo al trabajar) y admite su
  // ausencia, igual que cualquier otro día de trabajo.
  if (holiday.row && holiday.row.laborable === false) {
    return jsonError(`Hoy es feriado (${holiday.row.nombre || 'feriado'}) y no es laborable: una ausencia aquí no corresponde.`, 400, request)
  }

  let calculation
  try {
    calculation = calcularCamposAsistencia(mark.fecha, null, null, Number(config.horas_jornada) || 8, !!holiday.row, true, 0)
  } catch (error) { return jsonError(error.message || 'Horas inválidas', 400, request) }
  const payload = construirPayloadAsistenciaManual({
    empleadoId, fecha: mark.fecha, horaEntrada: null, horaSalida: null,
    esAusencia: true, esFeriado: !!holiday.row, nota: null, descanso: 0, operador, calculation,
  })
  const creado = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?select=id,empleado_id,fecha,horas_trabajadas,es_ausencia,estado_marcaje,nota`, {
    method: 'POST', headers: { ...svcHeaders(env), Prefer: 'return=representation' }, body: JSON.stringify(payload),
  })
  if (!creado.ok) return jsonError('No se pudo registrar la ausencia. Actualiza los marcajes del día e inténtalo de nuevo.', creado.status === 409 ? 409 : 500, request)
  const [registro] = await creado.json()
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'MARCAR_AUSENCIA', entidadTipo: 'registro_asistencia', entidadId: registro?.id || null, meta: { empleadoId, fecha: mark.fecha }, ip }).catch(() => {})
  return json({ ok: true, registro }, 201, request)
}

// Anula una entrada errónea de hoy y conserva el mismo registro como ausencia
// manual. Solo admite jornadas abiertas: una salida ya marcada requiere revisión
// contable específica y nunca debe borrarse por este atajo.
export async function handleAnularEntradaComoAusencia(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!tieneCapacidad(operador, 'administrarNomina')) return jsonError('Tu rol no tiene permiso para corregir marcajes', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { registroId, motivo } = body || {}
  if (!registroId || !isValidUuid(registroId)) return jsonError('registroId inválido', 400, request)
  if (typeof motivo !== 'string' || !textoNominaValido(motivo, 500) || motivo.trim().length < 3) {
    return jsonError('Indica el motivo de la anulación (mínimo 3 caracteres)', 400, request)
  }

  const tenantFilter = nominaTenantFilter(operador.cuenta_id)
  const registroResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${registroId}${tenantFilter}&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,horas_descanso,es_sabado,es_domingo,es_feriado,es_ausencia,estado_marcaje,entrada_marcada_en,entrada_por,entrada_idempotency_key,salida_marcada_en,salida_por,salida_idempotency_key,nota&limit=1`, { headers })
  if (!registroResponse.ok) return jsonError('No se pudo consultar el marcaje', 500, request)
  const [registro] = await registroResponse.json()
  if (!registro) return jsonError('Marcaje no encontrado', 404, request)

  const mark = nowInNominaZone(env)
  if (registro.fecha !== mark.fecha) return jsonError('Solo se puede anular una entrada de la fecha operativa de hoy', 400, request)
  if (registro.es_ausencia || !registro.hora_entrada || registro.hora_salida
    || !['entrada', 'corregido'].includes(registro.estado_marcaje)) {
    return jsonError('Solo se puede anular una entrada real que siga sin salida. Los marcajes completos requieren una revisión aparte.', 409, request)
  }

  const periodoResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?desde=lte.${registro.fecha}&hasta=gte.${registro.fecha}&estado=neq.abierto${tenantFilter}&select=nombre,estado&limit=1`, { headers })
  if (!periodoResponse.ok) return jsonError('No se pudo verificar el estado del período de nómina', 500, request)
  const [periodo] = await periodoResponse.json()
  if (periodo) return jsonError(`No se puede anular: el período está ${periodo.estado}`, 400, request)

  const config = await fetchConfigActiva(env, headers, operador, registro.empleado_id)
  if (!config) return jsonError('El empleado no tiene configuración activa de nómina', 400, request)
  const sinControl = sinControlDeAsistencia(config, request)
  if (sinControl) return sinControl

  const { ok: diasOk, dias } = await fetchDiasLaborablesEmpleado(env, headers, operador.cuenta_id, registro.empleado_id, registro.fecha)
  if (!diasOk) return jsonError('No se pudieron verificar sus días laborables', 500, request)
  if (!trabajaEnFecha(dias, registro.fecha)) {
    return jsonError('Ese día es libre según la ficha del empleado: no corresponde registrarlo como ausencia.', 400, request)
  }
  const holiday = await fetchFeriadoDelDia(env, headers, operador, registro.fecha)
  if (holiday.error) return jsonError('No se pudo consultar el calendario laboral', 500, request)
  if (holiday.row && holiday.row.laborable === false) {
    return jsonError(`Ese día fue feriado (${holiday.row.nombre || 'feriado'}) no laborable: no corresponde registrarlo como ausencia.`, 400, request)
  }

  let calculoAusencia
  try {
    calculoAusencia = calcularCamposAsistencia(registro.fecha, null, null, Number(config.horas_jornada) || 8, !!holiday.row, true, 0)
  } catch (error) { return jsonError(error.message || 'No se pudo calcular la ausencia', 400, request) }

  // Conserva el registro (y su vínculo de auditoría) como ausencia en lugar de
  // borrarlo y recrearlo. Los datos del reloj original quedan copiados al evento
  // de auditoría; los campos operativos se limpian para que no se paguen horas.
  const cambios = {
    hora_entrada: null,
    hora_salida: null,
    horas_trabajadas: 0,
    horas_normales: 0,
    horas_extra: 0,
    horas_descanso: 0,
    estado_marcaje: 'manual',
    es_sabado: calculoAusencia.es_sabado,
    es_domingo: calculoAusencia.es_domingo,
    es_feriado: calculoAusencia.es_feriado,
    es_ausencia: true,
    entrada_marcada_en: null,
    entrada_por: null,
    entrada_idempotency_key: null,
    salida_marcada_en: null,
    salida_por: null,
    salida_idempotency_key: null,
    nota: motivo.trim(),
    registrado_por: operador.id,
  }
  const entradaFiltro = `&hora_entrada=eq.${encodeURIComponent(registro.hora_entrada)}`
  const patch = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${registro.id}${tenantFilter}&estado_marcaje=eq.${encodeURIComponent(registro.estado_marcaje)}${entradaFiltro}&hora_salida=is.null&es_ausencia=eq.false&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,estado_marcaje,es_ausencia,nota`, {
    method: 'PATCH',
    headers: { ...svcHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify(cambios),
  })
  if (!patch.ok) return jsonError('No se pudo anular la entrada', 500, request)
  const [ausencia] = await patch.json()
  if (!ausencia) return jsonError('El marcaje cambió mientras confirmabas. Actualiza la lista e inténtalo de nuevo.', 409, request)

  await registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA',
    accion: 'ANULAR_ENTRADA_MARCAR_AUSENCIA',
    entidadTipo: 'registro_asistencia',
    entidadId: registro.id,
    meta: {
      empleadoId: registro.empleado_id,
      fecha: registro.fecha,
      motivo: motivo.trim(),
      entradaAnulada: {
        hora: registro.hora_entrada,
        marcadaEn: registro.entrada_marcada_en || null,
        marcadaPor: registro.entrada_por || null,
        idempotencyKey: registro.entrada_idempotency_key || null,
      },
      horasAnuladas: {
        trabajadas: Number(registro.horas_trabajadas || 0),
        normales: Number(registro.horas_normales || 0),
        extra: Number(registro.horas_extra || 0),
      },
      estadoNuevo: 'ausencia',
    },
    ip,
  }).catch(() => {})

  return json({ ok: true, registro: ausencia }, 200, request)
}
