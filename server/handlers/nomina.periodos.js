// server/handlers/nomina.periodos.js
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { calcularLineaNomina, esJornadaAbierta } from '../lib/nominaUtils.js'
import { nominaTenantFilter } from '../lib/nominaTenant.js'
import { diasLaborablesResueltos, fetchDiasLaborablesPorEmpleado } from '../lib/nominaHorarios.js'
import { reglasLeyDeConfig } from '../lib/nominaReglasLey.js'
import { contarDescansosTrabajados, repartoSemana, semanasDelPeriodo } from '../lib/nominaHoja.js'
import { requireCapacidad } from '../lib/permissions.js'
import { COLUMNAS_SEMANA, nombreSemana, rangoSemana, semanaDeConfig } from '../lib/nominaSemana.js'
import { fechaNominaValida, fechaOperativaNomina, fetchConfigNomina, r4, svcHeaders, tenantGuard, textoNominaValido } from './nomina.shared.js'

export async function handleGetPeriodos(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoVer = requireCapacidad(operador, 'verNomina', request)
  if (denegadoVer) return denegadoVer
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const account = nominaTenantFilter(operador.cuenta_id)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?order=desde.desc${account}&select=id,nombre,desde,hasta,tipo,estado&limit=500`, { headers })
  if (!response.ok) return jsonError('Error al leer períodos', 500, request)
  const periods = await response.json()
  if (!periods.length) return json(periods, 200, request)
  const lineResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=in.(${periods.map(period => period.id).join(',')})${account}&select=periodo_id,total_bruto_usd,total_neto_usd,deducciones_usd,pagado`, { headers })
  if (lineResponse.ok) {
    const aggregate = new Map()
    for (const line of await lineResponse.json()) {
      const totals = aggregate.get(line.periodo_id) || { empleados: 0, bruto: 0, neto: 0, deducciones: 0, pagados: 0 }
      totals.empleados += 1
      totals.bruto += Number(line.total_bruto_usd || 0)
      totals.neto += Number(line.total_neto_usd || 0)
      totals.deducciones += Number(line.deducciones_usd || 0)
      if (line.pagado) totals.pagados += 1
      aggregate.set(line.periodo_id, totals)
    }
    for (const period of periods) {
      const totals = aggregate.get(period.id) || { empleados: 0, bruto: 0, neto: 0, deducciones: 0, pagados: 0 }
      period.total_empleados = totals.empleados
      period.total_bruto_usd = r4(totals.bruto)
      period.total_neto_usd = r4(totals.neto)
      period.total_deducciones_usd = r4(totals.deducciones)
      period.lineas_pagadas = totals.pagados
    }
  }
  return json(periods, 200, request)
}

export async function handleCrearPeriodo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers } = v
  const denegadoAdmin = requireCapacidad(operador, 'administrarNomina', request)
  if (denegadoAdmin) return denegadoAdmin
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

// Modo automático (por defecto): asegura que exista el período de la semana en
// curso (jueves → miércoles salvo que se configure otro día). Idempotente: si ya
// hay un período que toca esas fechas, no crea nada. En modo manual no hace nada.
export async function handleAsegurarSemanaActual(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  const denegadoAdmin = requireCapacidad(operador, 'administrarNomina', request)
  if (denegadoAdmin) return denegadoAdmin
  const tenantError = tenantGuard(operador, request)
  if (tenantError) return tenantError
  const account = nominaTenantFilter(operador.cuenta_id)
  // Si la base aún no tiene las columnas (migración 264), se usan los predeterminados.
  let config = {}
  const cfgRes = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?limit=1${account}&select=${COLUMNAS_SEMANA.join(',')}`, { headers })
  if (cfgRes.ok) [config = {}] = await cfgRes.json()
  const { modo, inicio } = semanaDeConfig(config)
  if (modo !== 'automatico') return json({ ok: true, modo, creado: false, periodo: null }, 200, request)

  const { desde, hasta } = rangoSemana(fechaOperativaNomina(env), inicio)
  const overlap = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?desde=lte.${hasta}&hasta=gte.${desde}${account}&select=id,nombre,desde,hasta,tipo,estado&order=desde.asc&limit=1`, { headers })
  if (!overlap.ok) return jsonError('Error al leer períodos', 500, request)
  const [existente] = await overlap.json()
  if (existente) return json({ ok: true, modo, creado: false, periodo: existente }, 200, request)

  const nombre = nombreSemana(desde, hasta)
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos`, { method: 'POST', headers: svcHeaders(env), body: JSON.stringify({ nombre, desde, hasta, tipo: 'semanal', estado: 'abierto', cuenta_id: operador.cuenta_id }) })
  if (!response.ok) return jsonError('No se pudo crear el período de la semana', 500, request)
  const [period] = await response.json()
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'CREAR_PERIODO_AUTOMATICO', entidadTipo: 'nomina_periodo', entidadId: period?.id, meta: { periodo: nombre, desde, hasta }, ip }).catch(() => {})
  return json({ ok: true, modo, creado: true, periodo: period }, 201, request)
}

export async function handleCalcularPeriodo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  const denegadoAdmin = requireCapacidad(operador, 'administrarNomina', request)
  if (denegadoAdmin) return denegadoAdmin
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
  const [configResponse, payrollConfig, attendanceResponse, previousResponse, horarios, feriadosResponse] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/nomina_config_empleado?activo=eq.true${account}&select=empleado_id,cargo,salario_dia_usd,horas_jornada,controla_asistencia,fecha_ingreso`, { headers }),
    fetchConfigNomina(env, headers, operador.cuenta_id),
    // El contrato del motor (lib/nominaUtils.js) exige estas columnas: sin ellas el
    // resultado de una línea cambiaría según qué pidió el llamador. `horas_trabajadas`
    // ya no decide el pago, pero `estado_marcaje`/`hora_entrada`/`hora_salida` sí
    // identifican las jornadas abiertas que bloquean el cálculo (409 más abajo).
    fetch(`${env.SUPABASE_URL}/rest/v1/registro_asistencia?fecha=gte.${period.desde}&fecha=lte.${period.hasta}${account}&select=empleado_id,fecha,horas_normales,horas_extra,es_sabado,es_domingo,es_feriado,es_ausencia,ausencia_justificada,horas_trabajadas,estado_marcaje,hora_entrada,hora_salida`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}${account}&select=empleado_id,bonos_usd,deducciones_usd,nota_bonos,nota_deducciones,comisiones_pos_usd,comisiones_despachos_ids,pagado`, { headers }),
    // Art. 119: para pagar el descanso hay que saber qué días trabaja cada quien
    // (vigentes al cierre del período) y cuáles son feriados no laborables.
    fetchDiasLaborablesPorEmpleado(env, headers, operador.cuenta_id, { fecha: period.hasta }),
    fetch(`${env.SUPABASE_URL}/rest/v1/nomina_feriados?fecha=gte.${period.desde}&fecha=lte.${period.hasta}${account}&select=fecha,laborable&limit=400`, { headers }),
  ])
  if (!configResponse.ok) return jsonError('Error al leer empleados', 500, request)
  if (!attendanceResponse.ok) return jsonError('Error al leer asistencia', 500, request)
  if (!previousResponse.ok) return jsonError('Error al leer líneas existentes', 500, request)
  // Sin semana laboral o feriados no se puede saber qué descanso pagar: mejor no
  // calcular que liquidar sin el descanso que exige la ley.
  if (!horarios.ok) return jsonError('No se pudieron leer los días que trabaja cada persona', 500, request)
  if (!feriadosResponse.ok) return jsonError('No se pudieron leer los feriados del período', 500, request)
  const feriados = await feriadosResponse.json()
  const hoy = fechaOperativaNomina(env)
  // Reglas de la ley editables en Configuración (migración 263).
  const reglas = reglasLeyDeConfig(payrollConfig)
  const employees = await configResponse.json()
  const attendance = await attendanceResponse.json()
  const previous = await previousResponse.json()
  if (!employees.length) return jsonError('No hay empleados activos con configuración de nómina', 400, request)
  // Jornadas abiertas: nadie cobra ni queda como ausente hasta que el operador
  // corrija el marcaje o confirme explícitamente que se liquidan sin pago.
  const jornadasAbiertas = attendance.filter(esJornadaAbierta)
  if (jornadasAbiertas.length && body?.confirmarJornadasAbiertas !== true) {
    const ids = [...new Set(jornadasAbiertas.map(jornada => jornada.empleado_id))]
    const nombres = new Map()
    const nombresResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/clientes?tipo_cliente=eq.personal&id=in.(${ids.join(',')})${account}&select=id,nombre`, { headers })
    if (nombresResponse.ok) {
      for (const persona of await nombresResponse.json()) nombres.set(persona.id, persona.nombre)
    }
    const detalle = [...jornadasAbiertas]
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
      .slice(0, 50)
      .map(jornada => ({
        empleado_id: jornada.empleado_id,
        empleado_nombre: nombres.get(jornada.empleado_id) || null,
        fecha: jornada.fecha,
        hora_entrada: jornada.hora_entrada || null,
      }))
    return json({
      error: `Hay ${jornadasAbiertas.length} jornada(s) con entrada y sin salida. Corrige el marcaje o confirma el cálculo: sin esa confirmación no se liquidan.`,
      jornadas_abiertas: detalle,
      total_jornadas_abiertas: jornadasAbiertas.length,
    }, 409, request)
  }
  const byEmployee = new Map()
  for (const row of attendance) {
    if (!byEmployee.has(row.empleado_id)) byEmployee.set(row.empleado_id, [])
    byEmployee.get(row.empleado_id).push(row)
  }
  const previousByEmployee = new Map(previous.map(row => [row.empleado_id, row]))
  // Bono semanal (regla del usuario, 19/11/2026): sale de la semana y no se suma.
  // Cada recibo guarda el bono y el sueldo semanal que le tocaron (migración 268).
  const diasPorEmpleado = new Map(employees.map(config => [config.empleado_id,
    (horarios.porEmpleado.get(config.empleado_id) || diasLaborablesResueltos([], null, reglas.diasLaborablesDefault)).dias]))
  const descansosTrabajados = contarDescansosTrabajados(attendance, diasPorEmpleado)
  const semanas = semanasDelPeriodo(period.desde, period.hasta)
  const lines = employees.map(config => {
    const old = previousByEmployee.get(config.empleado_id) || {}
    const calculation = calcularLineaNomina(
      byEmployee.get(config.empleado_id) || [],
      config,
      payrollConfig,
      Number(old.bonos_usd || 0),
      Number(old.deducciones_usd || 0),
      Number(old.comisiones_pos_usd || 0),
      // Quien no lleva control de asistencia no tiene faltas que evaluar: se
      // conserva su cálculo anterior, sin descanso automático.
      config.controla_asistencia === false ? null : {
        desde: period.desde,
        hasta: period.hasta,
        diasLaborables: (horarios.porEmpleado.get(config.empleado_id) || diasLaborablesResueltos([], null, reglas.diasLaborablesDefault)).dias,
        feriados,
        hoy,
        fechaIngreso: config.fecha_ingreso || null,
        descansoRemunerado: reglas.descansoRemunerado,
        faltasPierde: reglas.faltasPierdeDescanso,
      },
    )
    const reparto = repartoSemana({
      linea: calculation,
      diasDescansoTrabajados: descansosTrabajados.get(config.empleado_id) || 0,
      bonoSemanal: reglas.bonoSemanalUsd,
      semanas,
    })
    return {
      periodo_id: periodoId,
      empleado_id: config.empleado_id,
      ...calculation,
      bono_semanal_usd: reparto.bono,
      sueldo_semanal_usd: reparto.sueldo,
      nota_bonos: old.nota_bonos || null,
      nota_deducciones: old.nota_deducciones || null,
      comisiones_despachos_ids: old.comisiones_despachos_ids || [],
      cuenta_id: operador.cuenta_id,
    }
  })
  const paidIds = new Set(previous.filter(row => row.pagado).map(row => row.empleado_id))
  const activeIds = new Set(employees.map(employee => employee.empleado_id))
  const obsoleteIds = previous.filter(row => !row.pagado && !activeIds.has(row.empleado_id)).map(row => row.empleado_id)
  const toInsert = lines.filter(line => !paidIds.has(line.empleado_id))
  if (toInsert.length) {
    const upsert = filas => fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?on_conflict=periodo_id,empleado_id`, { method: 'POST', headers: svcHeaders(env, 'resolution=merge-duplicates,return=minimal'), body: JSON.stringify(filas) })
    let insertResponse = await upsert(toInsert)
    // Columnas informativas que una base atrasada puede no tener: 262 (dias_descanso)
    // y 268 (bono y sueldo semanal). El dinero ya va en los montos: se guarda sin ellas.
    let filas = toInsert
    for (let intento = 0; intento < 2 && !insertResponse.ok; intento += 1) {
      const detalle = await insertResponse.text().catch(() => '')
      if (detalle.includes('bono_semanal_usd') || detalle.includes('sueldo_semanal_usd')) {
        console.warn('[nomina] Falta la migración 268 (bono semanal); se guarda sin el reparto sueldo/bono')
        filas = filas.map(({ bono_semanal_usd: _b, sueldo_semanal_usd: _s, ...resto }) => resto)
      } else if (detalle.includes('dias_descanso')) {
        console.warn('[nomina] Falta la migración 262 (dias_descanso); se guarda sin el conteo de descanso')
        filas = filas.map(({ dias_descanso: _omitido, ...resto }) => resto)
      } else break
      insertResponse = await upsert(filas)
    }
    if (!insertResponse.ok) return jsonError('No se pudieron generar las líneas de nómina', 500, request)
  }
  if (obsoleteIds.length) {
    const deleteResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}${account}&empleado_id=in.(${obsoleteIds.join(',')})`, { method: 'DELETE', headers: svcHeaders(env, 'return=minimal') })
    if (!deleteResponse.ok) return jsonError('No se pudieron retirar líneas obsoletas', 500, request)
  }
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'CALCULAR_PERIODO', entidadTipo: 'nomina_periodo', entidadId: periodoId,    meta: { periodo: period.nombre, lineas: toInsert.length, preservadas: paidIds.size, obsoletas: obsoleteIds.length, jornadas_abiertas: jornadasAbiertas.length }, ip }).catch(() => {})
  return json({ ok: true, lineas_generadas: toInsert.length, lineas_preservadas: paidIds.size }, 200, request)
}

export async function handleCerrarPeriodo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  const denegadoAdmin = requireCapacidad(operador, 'administrarNomina', request)
  if (denegadoAdmin) return denegadoAdmin
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
  // Congelar la tasa del cierre: si el llamador envía `tasas` (la observación del
  // mercado en este momento), se guarda como snapshot del período ANTES de cerrar.
  // Si el snapshot no se puede escribir, el período NO se cierra (fail-closed):
  // un período cerrado siempre conserva la tasa con la que se cerró.
  const tasasCierre = []
  if (body.tasas !== undefined) {
    if (!body.tasas || typeof body.tasas !== 'object' || Array.isArray(body.tasas)) return jsonError('tasas inválidas', 400, request)
    const fuentes = { usd: ['USD', 'BCV'], eur: ['EUR', 'EURO'], usdt: ['USDT', 'USDT'] }
    for (const [clave, [moneda, fuente]] of Object.entries(fuentes)) {
      const bruto = body.tasas[clave]
      if (bruto === undefined || bruto === null || bruto === '') continue
      const valor = Number(bruto)
      if (!Number.isFinite(valor) || valor <= 0 || valor > 10000000) return jsonError(`Tasa ${clave} inválida para congelar`, 400, request)
      tasasCierre.push({
        fecha: fechaOperativaNomina(env),
        moneda_origen: moneda,
        moneda_destino: 'VES',
        valor,
        fuente,
        observado_en: new Date().toISOString(),
        aprobado: true,
        aprobado_por: operador.id,
        periodo_id: periodoId,
        cuenta_id: operador.cuenta_id,
      })
    }
    if (tasasCierre.length) {
      const freeze = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_tasas_snapshot?on_conflict=cuenta_id,fecha,moneda_origen,fuente,periodo_id`, { method: 'POST', headers: svcHeaders(env, 'resolution=merge-duplicates,return=minimal'), body: JSON.stringify(tasasCierre) })
      if (!freeze.ok) return jsonError('No se pudo congelar la tasa del período; no se cerró', 500, request)
    }
  }
  const update = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}${account}`, { method: 'PATCH', headers: svcHeaders(env, 'return=minimal'), body: JSON.stringify({ estado: 'cerrado', cerrado_en: new Date().toISOString(), cerrado_por: operador.id }) })
  if (!update.ok) return jsonError('Error al cerrar período', 500, request)
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'CERRAR_PERIODO', entidadTipo: 'nomina_periodo', entidadId: periodoId, meta: { periodo: period.nombre, tasas_congeladas: tasasCierre.length }, ip }).catch(() => {})
  return json({ ok: true, tasa_congelada: tasasCierre.length > 0 }, 200, request)
}

export async function handleReabrirPeriodo(request, env) {
  const v = await validateOperator(request, env)
  if (v.error) return v.error
  const { operador, headers, ip } = v
  const denegadoAdmin = requireCapacidad(operador, 'administrarNomina', request)
  if (denegadoAdmin) return denegadoAdmin
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
  const denegadoAdmin = requireCapacidad(operador, 'administrarNomina', request)
  if (denegadoAdmin) return denegadoAdmin
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
  const deleteLines = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_lineas?periodo_id=eq.${periodoId}${account}`, { method: 'DELETE', headers: svcHeaders(env, 'return=minimal') })
  if (!deleteLines.ok) return jsonError('No se pudieron eliminar los recibos. Los recibos con historial de pago se conservan; revisa el estado del período.', 409, request)
  const deletePeriod = await fetch(`${env.SUPABASE_URL}/rest/v1/nomina_periodos?id=eq.${periodoId}${account}`, { method: 'DELETE', headers: svcHeaders(env, 'return=minimal') })
  if (!deletePeriod.ok) return jsonError('Error al eliminar período', 500, request)
  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), { usuarioId: operador.id, usuarioNombre: operador.nombre, usuarioRol: operador.rol, cuentaId: operador.cuenta_id, categoria: 'NOMINA', accion: 'ELIMINAR_PERIODO', entidadTipo: 'nomina_periodo', entidadId: periodoId, meta: { periodo: period.nombre }, ip }).catch(() => {})
  return json({ ok: true }, 200, request)
}
