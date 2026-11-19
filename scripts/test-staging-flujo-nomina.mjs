// scripts/test-staging-flujo-nomina.mjs
// Prueba de punta a punta del flujo de nómina contra STAGING (19/11/2026), con la
// API real (worker.js) y la base de staging. Usa una semana sintética propia
// (jueves 01/10 → miércoles 07/10/2026) y la deja limpia al terminar.
//
// Recorre: asistencia (trabajo, hora extra, falta sin justificativo, falta con
// justificativo) → cálculo automático al abrir (soloSiCambio) → recibo (descanso,
// bono y sueldo semanal) → hoja semanal → recibos del trabajador → cerrar = marcar
// todo pagado → reabrir → limpieza. Las credenciales se leen de la configuración
// de staging y nunca se imprimen.
import fs from 'node:fs'
import worker from '../worker.js'

const REF = 'wishglzpmcshyvlgpjxj'
const SUPABASE_URL = `https://${REF}.supabase.co`
const PERIODO = { nombre: 'Flujo E2E staging', desde: '2026-10-01', hasta: '2026-10-07', tipo: 'semanal' }
const DIAS = {
  jue: '2026-10-01', vie: '2026-10-02', sab: '2026-10-03', dom: '2026-10-04',
  lun: '2026-10-05', mar: '2026-10-06', mie: '2026-10-07',
}

function readEnv(path) {
  const values = {}
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const text = line.trim()
    if (!text || text.startsWith('#')) continue
    const index = text.indexOf('=')
    if (index < 1) continue
    let value = text.slice(index + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value)
    values[text.slice(0, index)] = value
  }
  return values
}

const resultados = []
function paso(nombre, ok, detalle = '') {
  resultados.push({ nombre, ok })
  console.log(`${ok ? '  OK  ' : ' FALLA'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) throw new Error(`Falló: ${nombre}${detalle ? ` (${detalle})` : ''}`)
}
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01

async function main() {
  const frontend = readEnv('.env.staging.local')
  const localWorker = readEnv('.dev.vars.staging')
  if (frontend.VITE_SUPABASE_URL !== SUPABASE_URL || localWorker.SUPABASE_URL !== SUPABASE_URL) {
    throw new Error('Prueba rechazada: la configuración no apunta a staging.')
  }
  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: frontend.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: frontend.STAGING_TEST_EMAIL, password: frontend.STAGING_TEST_PASSWORD }),
  })
  if (!login.ok) throw new Error(`No se pudo iniciar sesión en staging (${login.status}).`)
  const session = await login.json()
  const env = {
    SUPABASE_URL: localWorker.SUPABASE_URL,
    SUPABASE_ANON_KEY: localWorker.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: localWorker.SUPABASE_SERVICE_KEY,
    NOMINA_TIMEZONE: localWorker.NOMINA_TIMEZONE,
    NOMINA_ALLOWED_ORIGINS: localWorker.NOMINA_ALLOWED_ORIGINS,
  }
  const servicio = { apikey: localWorker.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${localWorker.SUPABASE_SERVICE_KEY}` }
  const api = async (path, { method = 'GET', body } = {}) => {
    const res = await worker.fetch(new Request(`http://127.0.0.1:8789${path}`, {
      method,
      headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env)
    const text = await res.text()
    let data = null
    try { data = JSON.parse(text) } catch { data = text }
    return { status: res.status, data }
  }

  console.log('\nFlujo de nómina de punta a punta (staging)\n')
  const operadores = (await api('/api/auth/operators')).data?.operators || []
  const cambio = await api('/api/auth/switch-operator', { method: 'POST', body: { operator_id: operadores[0]?.id, pin: frontend.STAGING_TEST_PIN } })
  paso('Iniciar sesión y elegir operador con PIN', cambio.status === 200, `operadores: ${operadores.length}`)

  const empleados = (await api('/api/nomina/empleados')).data
  const empleado = (Array.isArray(empleados) ? empleados : empleados?.empleados || []).find(e => e.nombre === 'Empleado Sintético Staging')
  paso('Encontrar al empleado sintético', Boolean(empleado))
  const configs = (await api('/api/nomina/config-empleados')).data
  const cfgEmp = (Array.isArray(configs) ? configs : configs?.configs || []).find(c => c.empleado_id === empleado.id)
  const salarioDia = Number(cfgEmp?.salario_dia_usd)
  paso('Leer su ficha de nómina', salarioDia > 0, `sueldo diario $${salarioDia}`)
  const horario = await (await fetch(`${SUPABASE_URL}/rest/v1/nomina_horarios?empleado_id=eq.${empleado.id}&select=dia_semana,trabaja`, { headers: servicio })).json()
  const trabaja = new Set(horario.filter(h => h.trabaja).map(h => h.dia_semana))
  paso('Su semana es de lunes a sábado (la prueba cuenta con eso)', [1, 2, 3, 4, 5, 6].every(d => trabaja.has(d)) && !trabaja.has(0))
  const config = (await api('/api/config')).data
  const cfg = config?.config || config
  const bonoSemanal = Number(cfg?.nomina_bono_semanal_usd ?? 35)
  paso('Leer reglas de pago (bono y faltas)', Number(cfg?.nomina_faltas_pierde_descanso ?? 0) === 0, `bono $${bonoSemanal}, faltas que quitan descanso: ${cfg?.nomina_faltas_pierde_descanso}`)

  let periodo = ((await api('/api/nomina/periodos')).data || []).find(p => p.nombre === PERIODO.nombre)
  if (!periodo) {
    const creado = await api('/api/nomina/periodos/crear', { method: 'POST', body: PERIODO })
    paso('Crear la semana sintética jueves 01/10 → miércoles 07/10', creado.status === 201, `status ${creado.status}`)
    periodo = creado.data.periodo
  } else {
    paso('Reusar la semana sintética', periodo.estado === 'abierto', `estado ${periodo.estado}`)
  }
  const lineasPrevias = (await api(`/api/nomina/lineas?periodoId=${periodo.id}`)).data
  if (Array.isArray(lineasPrevias) && lineasPrevias.some(l => l.pagado)) throw new Error('La semana sintética tiene recibos pagados: no se toca.')

  const asistenciaIds = []
  try {
    // ── Asistencia ──────────────────────────────────────────────────────────
    const registrar = body => api('/api/nomina/asistencia/registrar', { method: 'POST', body: { empleadoId: empleado.id, horasDescanso: 1, ...body } })
    const r1 = await registrar({ fecha: DIAS.jue, horaEntrada: '08:00', horaSalida: '17:00' })
    const r2 = await registrar({ fecha: DIAS.vie, esAusencia: true, ausenciaJustificada: false })
    const r3 = await registrar({ fecha: DIAS.lun, esAusencia: true, ausenciaJustificada: true, nota: 'Reposo médico' })
    const r4 = await registrar({ fecha: DIAS.mar, horaEntrada: '08:00', horaSalida: '18:00' })
    const r5 = await registrar({ fecha: DIAS.mie, horaEntrada: '08:00', horaSalida: '17:00' })
    // El empleado sintético trabaja de lunes a sábado (su descanso es el domingo).
    const r6 = await registrar({ fecha: DIAS.sab, horaEntrada: '08:00', horaSalida: '12:00', horasDescanso: 0 })
    const todos = [r1, r2, r3, r4, r5, r6]
    for (const r of todos) if (r.data?.registro?.id) asistenciaIds.push(r.data.registro.id)
    paso('Registrar la semana: 4 días trabajados (uno con 1 h extra), 1 falta sin justificativo y 1 con justificativo',
      todos.every(r => r.status === 201 || r.status === 200), todos.map(r => r.status).join('/'))
    paso('La falta justificada queda guardada como justificada', r3.data?.registro?.ausencia_justificada === true && r2.data?.registro?.ausencia_justificada === false)
    const domingo = await registrar({ fecha: DIAS.dom, esAusencia: true })
    paso('No deja registrar una falta en domingo (día libre)', domingo.status === 400, `status ${domingo.status}`)

    // ── Cálculo automático al abrir el período ──────────────────────────────
    const auto = await api('/api/nomina/periodos/calcular', { method: 'POST', body: { periodoId: periodo.id, soloSiCambio: true } })
    paso('Al abrir el período, los recibos se calculan solos', auto.status === 200 && !auto.data?.sin_cambios, `generados: ${auto.data?.lineas_generadas}`)
    const auto2 = await api('/api/nomina/periodos/calcular', { method: 'POST', body: { periodoId: periodo.id, soloSiCambio: true } })
    paso('Al volver a abrirlo sin cambios, no reescribe nada', auto2.status === 200 && auto2.data?.sin_cambios === true)

    const lineas = (await api(`/api/nomina/lineas?periodoId=${periodo.id}`)).data
    const linea = lineas.find(l => l.empleado_id === empleado.id)
    paso('Hay recibo para el empleado', Boolean(linea))
    // Trabaja de lunes a sábado: semana = (4 trabajados + domingo + falta justificada) × sueldo diario.
    const semana = 6 * salarioDia
    paso('Días trabajados = 4 y faltas sin justificativo = 1', Number(linea.dias_trabajados) === 4 && Number(linea.dias_ausencia) === 1,
      `trabajados ${linea.dias_trabajados}, faltas ${linea.dias_ausencia}`)
    paso('La falta sin justificativo descuenta solo ese día (el domingo se paga) y la justificada se paga',
      Number(linea.dias_descanso) === 2 && cerca(linea.monto_normal_usd, semana), `días pagados sin trabajar ${linea.dias_descanso}, monto normal $${linea.monto_normal_usd} (esperado $${semana})`)
    const extraEsperada = (salarioDia / 8) * Number(cfg?.nomina_factor_hora_extra || 1.5)
    const extraFija = Number(cfg?.nomina_monto_hora_extra_usd) > 0 ? Number(cfg.nomina_monto_hora_extra_usd) : null
    paso('La hora extra se paga aparte', cerca(linea.horas_extra, 1) && cerca(linea.monto_extra_usd, extraFija ?? extraEsperada),
      `${linea.horas_extra} h = $${linea.monto_extra_usd}`)
    const bonoEsperado = Math.min(bonoSemanal, semana)
    paso('El recibo guarda el bono semanal (sale de la semana, no se suma)',
      cerca(linea.bono_semanal_usd, bonoEsperado) && cerca(linea.sueldo_semanal_usd, semana - bonoEsperado)
      && cerca(linea.total_bruto_usd, ['monto_normal_usd', 'monto_extra_usd', 'monto_sabado_usd', 'monto_feriado_usd', 'bonos_usd', 'comisiones_pos_usd']
        .reduce((total, campo) => total + Number(linea[campo] || 0), 0)),
      `sueldo $${linea.sueldo_semanal_usd} + bono $${linea.bono_semanal_usd} = semana $${semana}; bruto $${linea.total_bruto_usd} (incluye recargo de sábado $${linea.monto_sabado_usd})`)

    // ── Hoja semanal ────────────────────────────────────────────────────────
    const hoja = (await api(`/api/nomina/periodos/hoja?periodoId=${periodo.id}`)).data
    const fila = hoja?.filas?.find(f => f.empleadoId === empleado.id)
    paso('La hoja semanal reparte igual que el recibo', fila && cerca(fila.bonoSemanal, bonoEsperado) && cerca(fila.sueldoSemanal, semana - bonoEsperado) && cerca(fila.totalACobrar, linea.total_bruto_usd),
      `hoja: sueldo $${fila?.sueldoSemanal} + bono $${fila?.bonoSemanal}, total $${fila?.totalACobrar}`)

    // ── Recibos del trabajador ──────────────────────────────────────────────
    const recibos = await api(`/api/nomina/empleados/recibos?empleadoId=${empleado.id}`)
    const reciboFicha = recibos.data?.recibos?.find(r => r.id === linea.id)
    paso('La ficha del trabajador lista el recibo con su período', recibos.status === 200 && reciboFicha?.periodo?.nombre === PERIODO.nombre && reciboFicha.pagado === false)

    // ── Cerrar = marcar todo pagado ─────────────────────────────────────────
    const cierre = await api('/api/nomina/periodos/cerrar', { method: 'POST', body: { periodoId: periodo.id, tasas: { usd: 236.5 } } })
    paso('«Cerrar y marcar pagado» cierra la semana', cierre.status === 200 && cierre.data?.pagado === true, `status ${cierre.status}, recibos marcados ${cierre.data?.recibos_marcados}`)
    const pagadas = (await api(`/api/nomina/lineas?periodoId=${periodo.id}`)).data
    const pagada = pagadas.find(l => l.id === linea.id)
    paso('Todos los recibos quedan pagados con la tasa del cierre', pagadas.every(l => l.pagado) && cerca(pagada.tasa_pago_usd_ves, 236.5)
      && cerca(pagada.total_pagado_bs, Number(pagada.total_neto_usd) * 236.5), `Bs ${pagada.total_pagado_bs}`)
    const periodoPagado = ((await api('/api/nomina/periodos')).data || []).find(p => p.id === periodo.id)
    paso('El período pasa a «pagado» (Historial)', periodoPagado?.estado === 'pagado')
    const recierre = await api('/api/nomina/periodos/cerrar', { method: 'POST', body: { periodoId: periodo.id } })
    paso('No deja cerrarlo dos veces', recierre.status === 400, `status ${recierre.status}`)
    const fichaPagada = (await api(`/api/nomina/empleados/recibos?empleadoId=${empleado.id}`)).data?.recibos?.find(r => r.id === linea.id)
    paso('La ficha del trabajador lo muestra pagado', fichaPagada?.pagado === true)
    const recalc = await api('/api/nomina/periodos/calcular', { method: 'POST', body: { periodoId: periodo.id, soloSiCambio: true } })
    paso('Un período pagado no se recalcula al abrirlo', recalc.status === 400, `status ${recalc.status}`)

    // ── Reabrir si se cerró por error ───────────────────────────────────────
    const reabrir = await api('/api/nomina/periodos/reabrir', { method: 'POST', body: { periodoId: periodo.id } })
    const tras = (await api(`/api/nomina/lineas?periodoId=${periodo.id}`)).data
    paso('«Reabrir período» deshace la marca de pagado', reabrir.status === 200 && tras.every(l => !l.pagado && l.tasa_pago_usd_ves == null), `status ${reabrir.status}`)
  } finally {
    // ── Limpieza: deja staging como estaba ──────────────────────────────────
    const borrarAsistencia = await fetch(`${SUPABASE_URL}/rest/v1/registro_asistencia?empleado_id=eq.${empleado.id}&fecha=gte.${PERIODO.desde}&fecha=lte.${PERIODO.hasta}`, { method: 'DELETE', headers: { ...servicio, Prefer: 'return=minimal' } })
    const estado = ((await api('/api/nomina/periodos')).data || []).find(p => p.id === periodo.id)?.estado
    if (estado === 'pagado') await api('/api/nomina/periodos/reabrir', { method: 'POST', body: { periodoId: periodo.id } })
    // La tasa congelada al cerrar queda ligada al período y la base no deja borrarlo
    // con ella (protege el historial); en esta semana de prueba se retira primero.
    await fetch(`${SUPABASE_URL}/rest/v1/nomina_tasas_snapshot?periodo_id=eq.${periodo.id}`, { method: 'DELETE', headers: { ...servicio, Prefer: 'return=minimal' } })
    const eliminar = await api('/api/nomina/periodos/eliminar', { method: 'POST', body: { periodoId: periodo.id } })
    console.log(`\nLimpieza: asistencia ${borrarAsistencia.ok ? 'borrada' : `NO borrada (${borrarAsistencia.status})`}, semana sintética ${eliminar.status === 200 ? 'eliminada' : `NO eliminada (${eliminar.status})`}`)
  }
  const fallas = resultados.filter(r => !r.ok).length
  console.log(`\n${resultados.length - fallas}/${resultados.length} pasos aprobados`)
  if (fallas) process.exitCode = 1
}

main().catch(error => {
  console.error(`\n${error.message}`)
  process.exitCode = 1
})
