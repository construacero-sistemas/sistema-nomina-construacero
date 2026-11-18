// server/handlers/nomina.marcaje-deshacer.js
// M-6 de docs/PLAN_MARCAJE_BOTONES_UX.md: deshacer un toque equivocado en «Marcar
// entrada» o «Marcar salida» sin motivo, pero con rastro completo en auditoría.
// Tres candados: (1) solo con la clave de idempotencia de ESA acción, que tiene
// únicamente el dispositivo que la hizo; (2) solo durante VENTANA_DESHACER_SEGUNDOS
// según la hora del servidor; (3) escritura condicional (G-3): si la fila cambió
// desde la lectura, 409. Pasada la ventana quedan «Corregir» y «Anular entrada».
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { tieneCapacidad } from '../lib/permissions.js'
import { registrarAuditoria } from '../lib/audit.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { VENTANA_DESHACER_SEGUNDOS } from '../lib/marcajeReglas.js'
import { filtroIgual, svcHeaders, tenantGuard } from './nomina.shared.js'
import { idempotencyKeyValida, nowInNominaZone, periodoBloqueadoParaFecha } from './nomina.asistencia.js'

const CAMPOS = 'id,empleado_id,fecha,hora_entrada,hora_salida,es_ausencia,estado_marcaje,horas_trabajadas,horas_normales,horas_extra,horas_descanso,entrada_marcada_en,entrada_idempotency_key,salida_marcada_en,salida_idempotency_key,nota'
const MENSAJE_FUERA_DE_PLAZO = 'Ya pasó el tiempo para deshacer con un toque. Usa «Corregir marcaje» o «Anular entrada».'

function dentroDeLaVentana(marcadaEn, ahora) {
  const instante = Date.parse(marcadaEn || '')
  if (!Number.isFinite(instante)) return false
  const segundos = (ahora.getTime() - instante) / 1000
  // Unos segundos de margen negativo por relojes desfasados entre réplicas.
  return segundos >= -5 && segundos <= VENTANA_DESHACER_SEGUNDOS
}

export async function handleDeshacerMarcaje(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  if (!tieneCapacidad(operador, 'administrarNomina')) return jsonError('Tu rol no tiene permiso para deshacer marcajes', 403, request)
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const { registroId, tipo, idempotencyKey } = body || {}
  if (!registroId || !isValidUuid(registroId)) return jsonError('registroId inválido', 400, request)
  if (tipo !== 'entrada' && tipo !== 'salida') return jsonError('tipo inválido: debe ser entrada o salida', 400, request)
  if (!idempotencyKeyValida(idempotencyKey)) return jsonError('idempotencyKey inválida', 400, request)
  const clave = idempotencyKey.trim()

  const tenantFilter = nominaTenantFilter(operador.cuenta_id)
  const lectura = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${registroId}${tenantFilter}&select=${CAMPOS}&limit=1`, { headers })
  if (!lectura.ok) return jsonError('No se pudo consultar el marcaje', 500, request)
  const [registro] = await lectura.json()
  if (!registro) return jsonError('Marcaje no encontrado', 404, request)

  const mark = nowInNominaZone(env)
  if (registro.fecha !== mark.fecha) return jsonError('Solo se puede deshacer un marcaje de la fecha operativa de hoy', 400, request)
  const periodo = await periodoBloqueadoParaFecha(env, headers, operador, registro.fecha)
  if (periodo) return jsonError(`No se puede deshacer: el período está ${periodo.estado}`, 400, request)

  const claveDeLaAccion = tipo === 'entrada' ? registro.entrada_idempotency_key : registro.salida_idempotency_key
  if (!claveDeLaAccion || claveDeLaAccion !== clave) {
    return jsonError('Solo el equipo que hizo el marcaje puede deshacerlo con un toque. Usa «Corregir marcaje».', 403, request)
  }
  const ahora = new Date(mark.marcadoEn)
  let escritura
  let cambios = null
  if (tipo === 'entrada') {
    if (registro.es_ausencia || registro.hora_salida || registro.estado_marcaje !== 'entrada') {
      return jsonError('Esa entrada ya tiene salida o fue corregida: no se deshace con un toque.', 409, request)
    }
    if (!dentroDeLaVentana(registro.entrada_marcada_en, ahora)) return jsonError(MENSAJE_FUERA_DE_PLAZO, 409, request)
    escritura = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${registro.id}${tenantFilter}&estado_marcaje=eq.entrada${filtroIgual('entrada_idempotency_key', clave)}&hora_salida=is.null&es_ausencia=eq.false&select=id`, {
      method: 'DELETE', headers: { ...svcHeaders(env), Prefer: 'return=representation' },
    })
  } else {
    if (registro.es_ausencia || !registro.hora_salida || !['completo', 'corregido'].includes(registro.estado_marcaje)) {
      return jsonError('Esa jornada no tiene una salida que deshacer.', 409, request)
    }
    if (!dentroDeLaVentana(registro.salida_marcada_en, ahora)) return jsonError(MENSAJE_FUERA_DE_PLAZO, 409, request)
    cambios = {
      hora_salida: null, horas_trabajadas: 0, horas_normales: 0, horas_extra: 0, horas_descanso: null,
      estado_marcaje: registro.estado_marcaje === 'corregido' ? 'corregido' : 'entrada',
      salida_marcada_en: null, salida_por: null, salida_idempotency_key: null, registrado_por: operador.id,
    }
    escritura = await fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?id=eq.${registro.id}${tenantFilter}${filtroIgual('estado_marcaje', registro.estado_marcaje)}${filtroIgual('salida_idempotency_key', clave)}${filtroIgual('hora_salida', registro.hora_salida)}&es_ausencia=eq.false&select=id,empleado_id,fecha,hora_entrada,hora_salida,horas_trabajadas,horas_normales,horas_extra,es_feriado,es_ausencia,estado_marcaje,nota`, {
      method: 'PATCH', headers: { ...svcHeaders(env), Prefer: 'return=representation' }, body: JSON.stringify(cambios),
    })
  }
  if (!escritura.ok) return jsonError('No se pudo deshacer el marcaje', 500, request)
  const [resultado] = await escritura.json()
  if (!resultado) return jsonError('El marcaje cambió mientras deshacías. Actualiza la lista.', 409, request)

  await registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'NOMINA',
    accion: tipo === 'entrada' ? 'DESHACER_ENTRADA' : 'DESHACER_SALIDA',
    entidadTipo: 'registro_asistencia',
    entidadId: registro.id,
    meta: { empleadoId: registro.empleado_id, fecha: registro.fecha, antes: registro, ...(cambios ? { despues: cambios } : {}) },
    ip,
  }).catch(() => {})

  return json({ ok: true, tipo, registro: tipo === 'entrada' ? null : resultado }, 200, request)
}
