// server/handlers/nomina.hoja.js
// GET /api/nomina/periodos/hoja?periodoId=… — «Hoja semanal» (docs/PLAN_HOJA_SEMANAL.md).
// SOLO LECTURA: arma la vista de la planilla de la contadora con los recibos ya
// calculados del período. No escribe nada; el descuento manual se agrega por el
// endpoint de ajuste que ya existe (`/api/nomina/lineas/ajustar`).
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { requireCapacidad } from '../lib/permissions.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { diasLaborablesResueltos, fetchDiasLaborablesPorEmpleado } from '../lib/nominaHorarios.js'
import { reglasLeyDeConfig } from '../lib/nominaReglasLey.js'
import { BONO_SEMANAL_USD, armarHojaSemanal } from '../lib/nominaHoja.js'
import { fetchConfigNomina, tenantGuard } from './nomina.shared.js'

const CAMPOS_LINEA = 'id,empleado_id,salario_dia_usd_snap,dias_trabajados,dias_descanso,horas_extra,' +
  'monto_normal_usd,monto_extra_usd,monto_sabado_usd,monto_feriado_usd,bonos_usd,comisiones_pos_usd,' +
  'deducciones_usd,total_bruto_usd,total_neto_usd,pagado,tasa_pago_usd_ves,total_pagado_bs,' +
  'empleado:clientes!empleado_id(id,nombre)'
const CAMPOS_ASISTENCIA = 'empleado_id,fecha,horas_normales,horas_extra,es_sabado,es_domingo,es_feriado,es_ausencia,' +
  'horas_trabajadas,estado_marcaje,hora_entrada,hora_salida'

export async function handleGetHojaSemanal(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegado = requireCapacidad(operador, 'verNomina', request)
  if (denegado) return denegado
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError

  const periodoId = new URL(request.url).searchParams.get('periodoId')
  if (!periodoId || !isValidUuid(periodoId)) return jsonError('periodoId inválido', 400, request)
  const cuenta = nominaTenantFilter(operador.cuenta_id)

  const periodoResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}${cuenta}&select=id,nombre,desde,hasta,estado&limit=1`, { headers })
  if (!periodoResponse.ok) return jsonError('No se pudo leer el período', 500, request)
  const [periodo] = await periodoResponse.json()
  if (!periodo) return jsonError('Período no encontrado', 404, request)

  const urlLineas = campos => `${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}${cuenta}&select=${campos}&limit=500`
  const [primeraLectura, asistenciaResponse, horarios, config] = await Promise.all([
    fetch(urlLineas(CAMPOS_LINEA), { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?fecha=gte.${periodo.desde}&fecha=lte.${periodo.hasta}${cuenta}&select=${CAMPOS_ASISTENCIA}&limit=5000`, { headers }),
    fetchDiasLaborablesPorEmpleado(env, headers, operador.cuenta_id, { fecha: periodo.hasta }),
    fetchConfigNomina(env, headers, operador.cuenta_id),
  ])
  // Igual que el listado de recibos: si a la base le falta la migración 262
  // (dias_descanso), se lee sin esa columna y la hoja sigue funcionando.
  let lineasResponse = primeraLectura
  if (lineasResponse.status === 400 && (await lineasResponse.text().catch(() => '')).includes('dias_descanso')) {
    lineasResponse = await fetch(urlLineas(CAMPOS_LINEA.replace(',dias_descanso', '')), { headers })
  }
  if (!lineasResponse.ok) return jsonError('No se pudieron leer los recibos del período', 500, request)
  if (!asistenciaResponse.ok) return jsonError('No se pudo leer la asistencia del período', 500, request)
  // Sin la semana laboral no se distingue un día laborable de un descanso trabajado.
  if (!horarios.ok) return jsonError('No se pudieron leer los días que trabaja cada persona', 500, request)

  const lineas = await lineasResponse.json() ?? []
  const asistencias = await asistenciaResponse.json() ?? []
  const reglas = reglasLeyDeConfig(config)
  const diasPorEmpleado = new Map(lineas.map(linea => {
    const resuelto = horarios.porEmpleado.get(linea.empleado_id) || diasLaborablesResueltos([], periodo.hasta, reglas.diasLaborablesDefault)
    return [linea.empleado_id, resuelto.dias]
  }))

  const { filas, totales } = armarHojaSemanal({
    lineas, asistencias, diasPorEmpleado, divisor: reglas.divisorMensual, bonoSemanal: BONO_SEMANAL_USD,
  })
  return json({ periodo, bonoSemanal: BONO_SEMANAL_USD, filas, totales }, 200, request)
}
