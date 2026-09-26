import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import worker from '../worker.js'

const REF = 'wishglzpmcshyvlgpjxj'
const SUPABASE_URL = `https://${REF}.supabase.co`
const PERIOD_FROM = '2026-09-21'
const PERIOD_TO = '2026-09-27'
const ROUND4 = value => Math.round(Number(value) * 10_000) / 10_000

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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function closeEnough(actual, expected, label) {
  assert(Math.abs(Number(actual) - expected) < 0.00011, `${label}: got ${actual}, expected ${expected}.`)
}

function timestampForLocalTime(date, hour, minute, timeZone) {
  const wanted = `${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const center = new Date(`${date}T12:00:00Z`).getTime()
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 1) {
    const candidate = new Date(center + offset * 60_000)
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map(part => [part.type, part.value]))
    if (`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}` === wanted) {
      return candidate.toISOString()
    }
  }
  throw new Error(`Could not resolve ${wanted} in ${timeZone}.`)
}

async function readJson(response, label) {
  const text = await response.text()
  let payload
  try { payload = text ? JSON.parse(text) : null } catch { throw new Error(`${label} did not return JSON (HTTP ${response.status}).`) }
  return { status: response.status, payload }
}

async function main() {
  const frontend = readEnv('.env.staging.local')
  const localWorker = readEnv('.dev.vars.staging')
  assert(frontend.VITE_SUPABASE_URL === SUPABASE_URL && localWorker.SUPABASE_URL === SUPABASE_URL,
    'Refusing to run: both frontend and Worker must point to the expected staging project.')
  assert(frontend.VITE_SUPABASE_ANON_KEY?.startsWith('sb_publishable_') && localWorker.SUPABASE_SERVICE_KEY?.startsWith('sb_secret_'),
    'Refusing to run: expected separately named staging API keys.')

  const loginResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: frontend.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: frontend.STAGING_TEST_EMAIL, password: frontend.STAGING_TEST_PASSWORD }),
  })
  assert(loginResponse.ok, `Staging login failed (${loginResponse.status}).`)
  const session = await loginResponse.json()
  const accountId = session.user?.id
  assert(accountId, 'The staging login did not yield an account ID.')

  const env = {
    SUPABASE_URL: localWorker.SUPABASE_URL,
    SUPABASE_ANON_KEY: localWorker.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: localWorker.SUPABASE_SERVICE_KEY,
    NOMINA_TIMEZONE: localWorker.NOMINA_TIMEZONE || 'America/Caracas',
    NOMINA_ALLOWED_ORIGINS: localWorker.NOMINA_ALLOWED_ORIGINS || '',
  }
  const workerRequest = (path, { method = 'GET', body, now } = {}) => worker.fetch(new Request(`http://127.0.0.1:8789${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), now ? { ...env, NOMINA_NOW: now } : env)
  const serviceRequest = (path, init = {}) => fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: localWorker.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${localWorker.SUPABASE_SERVICE_KEY}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const getRows = async path => {
    const response = await serviceRequest(path)
    assert(response.ok, `Could not read staging fixture preflight (${response.status}).`)
    return response.json()
  }
  const readHandler = async path => {
    const result = await readJson(await workerRequest(path), path)
    assert(result.status === 200, `${path} returned ${result.status}.`)
    return result.payload
  }
  const submit = async (path, body, now) => readJson(await workerRequest(path, { method: 'POST', body, now }), path)

  const operatorResult = await readHandler('/api/auth/operators')
  const operators = operatorResult.operators || []
  assert(operators.length === 1 && operators[0].nombre === 'Operador QA Staging',
    'Staging must contain exactly the expected synthetic operator.')
  const switched = await submit('/api/auth/switch-operator', {
    operator_id: operators[0].id,
    pin: frontend.STAGING_TEST_PIN,
  })
  assert(switched.status === 200, `Could not select the synthetic staging operator (${switched.status}).`)
  const profile = (await readHandler('/api/auth/me')).profile
  assert(profile?.cuenta_id === accountId && profile?.nombre === 'Operador QA Staging', 'Staging operator/account mismatch.')

  const employeeResponse = await readHandler('/api/nomina/empleados')
  const employees = Array.isArray(employeeResponse) ? employeeResponse : employeeResponse.empleados
  assert(Array.isArray(employees), 'Unexpected employee response from staging Worker.')
  assert(employees.length === 1 && employees[0].nombre === 'Empleado Sintético Staging',
    'Staging tenant contains unexpected employees; refusing all writes.')
  const employee = employees[0]
  const periods = await readHandler('/api/nomina/periodos')
  const period = periods.find(row => row.nombre === 'Período sintético staging'
    && row.desde === PERIOD_FROM && row.hasta === PERIOD_TO)
  assert(period?.estado === 'abierto', 'The expected synthetic weekly period must be open.')

  const attendanceBefore = await readHandler(`/api/nomina/asistencia?desde=${PERIOD_FROM}&hasta=${PERIOD_TO}`)
  assert(Array.isArray(attendanceBefore.registros) && attendanceBefore.registros.length === 0,
    'The synthetic week must be attendance-empty before deterministic tests.')
  const lineBefore = await readHandler(`/api/nomina/lineas?periodoId=${period.id}`)
  assert(Array.isArray(lineBefore) && lineBefore.length === 0,
    'The synthetic period must have no existing lines before deterministic tests.')

  const configs = await getRows(`/rest/v1/nomina_config_empleado?cuenta_id=eq.${accountId}&empleado_id=eq.${employee.id}&select=salario_dia_usd,horas_jornada,controla_asistencia,activo&limit=2`)
  assert(configs.length === 1 && configs[0].activo === true && configs[0].controla_asistencia === true,
    'The synthetic employee must have one active attendance-controlled payroll config.')
  const dailyRate = Number(configs[0].salario_dia_usd)
  const workdayHours = Number(configs[0].horas_jornada)
  assert(dailyRate === 40 && workdayHours === 8, 'Refusing to calculate until the synthetic rate/jornada are exactly $40/day and 8 hours.')

  const businessConfigs = await getRows(`/rest/v1/configuracion_negocio?cuenta_id=eq.${accountId}&select=nomina_factor_hora_extra,nomina_factor_sabado,nomina_factor_feriado,nomina_monto_hora_extra_usd,nomina_monto_sabado_usd,nomina_monto_feriado_usd,nomina_feriado_modo,nomina_horas_descanso&limit=1`)
  const settings = businessConfigs[0] || {
    nomina_factor_hora_extra: 1.5,
    nomina_factor_sabado: 1.25,
    nomina_factor_feriado: 2,
    nomina_feriado_modo: 'factor',
    nomina_horas_descanso: 1,
  }
  const breakHours = Number(settings.nomina_horas_descanso ?? 1)
  assert(Number.isFinite(breakHours) && breakHours >= 0 && breakHours <= 12,
    'Staging payroll break configuration is invalid.')

  const weekSchedules = await getRows(`/rest/v1/nomina_horarios?cuenta_id=eq.${accountId}&empleado_id=eq.${employee.id}&semana_ciclo=is.null&fecha_hasta=is.null&select=dia_semana,trabaja,dia_semana,fecha_desde,hora_inicio,hora_fin,horas_jornada,cuenta_id,creado_por`)
  assert(weekSchedules.length === 7 && weekSchedules.filter(row => row.trabaja).length === 6,
    'The synthetic fixture must expose exactly six permanent work days before the migration check.')
  const [existingSchedule] = weekSchedules
  const duplicateSchedule = await serviceRequest('/rest/v1/nomina_horarios', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      empleado_id: employee.id,
      dia_semana: existingSchedule.dia_semana,
      fecha_desde: existingSchedule.fecha_desde,
      hora_inicio: existingSchedule.hora_inicio,
      hora_fin: existingSchedule.hora_fin,
      horas_jornada: existingSchedule.horas_jornada,
      trabaja: existingSchedule.trabaja,
      cuenta_id: accountId,
      creado_por: operators[0]?.id,
    }),
  })
  assert(duplicateSchedule.status === 409,
    `Migration 247 must reject a duplicate permanent day (got ${duplicateSchedule.status}).`)
  const scheduleCountAfterConflict = await getRows(`/rest/v1/nomina_horarios?cuenta_id=eq.${accountId}&empleado_id=eq.${employee.id}&semana_ciclo=is.null&fecha_hasta=is.null&select=dia_semana&limit=20`)
  assert(scheduleCountAfterConflict.length === 7, 'Rejected duplicate schedule must not alter the synthetic week.')

  const holidays = await readHandler(`/api/nomina/calendario/feriados?desde=${PERIOD_FROM}&hasta=${PERIOD_TO}`)
  const holiday = holidays.find(row => row.fecha === '2026-09-25' && row.nombre === 'Feriado sintético staging' && row.laborable === false)
  assert(holiday, 'Expected synthetic non-working holiday missing; refusing fixture writes.')

  const cfg = settings
  const factorExtra = Number.isFinite(Number(cfg.nomina_factor_hora_extra)) ? Math.max(1, Number(cfg.nomina_factor_hora_extra)) : 1.5
  const factorSabado = Number.isFinite(Number(cfg.nomina_factor_sabado)) ? Math.max(1, Number(cfg.nomina_factor_sabado)) : 1.25
  const factorFeriado = Number.isFinite(Number(cfg.nomina_factor_feriado)) ? Math.max(1, Number(cfg.nomina_factor_feriado)) : 2
  const extraFixed = Number.isFinite(Number(cfg.nomina_monto_hora_extra_usd)) && Number(cfg.nomina_monto_hora_extra_usd) > 0
  const saturdayFixed = Number.isFinite(Number(cfg.nomina_monto_sabado_usd)) && Number(cfg.nomina_monto_sabado_usd) > 0
  const holidayFixed = cfg.nomina_feriado_modo === 'monto_fijo'
    && Number.isFinite(Number(cfg.nomina_monto_feriado_usd)) && Number(cfg.nomina_monto_feriado_usd) > 0
  const attendedDays = 5
  const clockCorrectionMinutes = 15
  const correctedClockHours = ROUND4(10 - breakHours - clockCorrectionMinutes / 60)
  assert(correctedClockHours > workdayHours, 'Configured rest time leaves no overtime after the planned 15-minute clock correction.')
  const expectedNormalHours = ROUND4(32 + workdayHours)
  const expectedOvertimeHours = ROUND4(correctedClockHours - workdayHours + 2)
  const normalDaysPaid = attendedDays - (saturdayFixed ? 1 : 0) - (holidayFixed ? 1 : 0)
  const hourlyRate = dailyRate / workdayHours
  const expectedNormalPay = ROUND4(normalDaysPaid * dailyRate)
  const expectedOvertimePay = ROUND4(expectedOvertimeHours * (extraFixed ? Number(cfg.nomina_monto_hora_extra_usd) : hourlyRate * factorExtra))
  const expectedSaturdayPay = ROUND4(saturdayFixed ? Number(cfg.nomina_monto_sabado_usd) : dailyRate * (factorSabado - 1))
  const expectedHolidayPay = ROUND4(holidayFixed ? Number(cfg.nomina_monto_feriado_usd) : dailyRate * (factorFeriado - 1))
  const expectedGross = ROUND4(expectedNormalPay + expectedOvertimePay + expectedSaturdayPay + expectedHolidayPay)

  const runId = `staging-deterministic-${randomUUID()}`
  const notes = {
    clock: `${runId}-clock`,
    monday: `${runId}-monday`,
    thursday: `${runId}-thursday`,
    holiday: `${runId}-holiday`,
    saturday: `${runId}-saturday`,
    absence: `${runId}-absence`,
  }
  let mutationStarted = false
  let payrollLineId = null
  const checks = ['migration 247 rejects duplicate permanent schedule without mutation']
  const recordManual = async ({ fecha, horaEntrada = null, horaSalida = null, esFeriado = false, esAusencia = false, nota, horasDescanso = 0 }) => {
    const result = await submit('/api/nomina/asistencia/registrar', {
      empleadoId: employee.id,
      fecha,
      horaEntrada,
      horaSalida,
      esFeriado,
      esAusencia,
      nota,
      horasDescanso,
    })
    assert(result.status === 201, `Manual staging attendance on ${fecha} returned ${result.status}: ${result.payload?.error || 'unexpected response'}.`)
    assert(result.payload?.registro?.nota === nota, `Attendance marker was not persisted on ${fecha}.`)
    return result.payload.registro
  }

  try {
    // Deterministic negative validation requests are read-only by design.
    const badHours = await submit('/api/nomina/asistencia/registrar', {
      empleadoId: employee.id, fecha: '2026-09-21', horaEntrada: '08:00', horaSalida: '',
      esFeriado: false, esAusencia: false, nota: `${runId}-invalid-hours`, horasDescanso: 0,
    })
    assert(badHours.status === 400, `Missing manual checkout must fail validation, got ${badHours.status}.`)
    checks.push('reject incomplete manual hours')

    const wrongDayAbsence = await submit('/api/nomina/asistencia/registrar', {
      empleadoId: employee.id, fecha: '2026-09-27', horaEntrada: null, horaSalida: null,
      esFeriado: false, esAusencia: true, nota: `${runId}-invalid-sunday`, horasDescanso: 0,
    })
    assert(wrongDayAbsence.status === 400, `Sunday absence must be rejected, got ${wrongDayAbsence.status}.`)
    const nonworkingHolidayAbsence = await submit('/api/nomina/asistencia/registrar', {
      empleadoId: employee.id, fecha: '2026-09-25', horaEntrada: null, horaSalida: null,
      esFeriado: false, esAusencia: true, nota: `${runId}-invalid-holiday`, horasDescanso: 0,
    })
    assert(nonworkingHolidayAbsence.status === 400, `Non-working holiday absence must be rejected, got ${nonworkingHolidayAbsence.status}.`)
    checks.push('reject Sunday and non-working-holiday absences')

    mutationStarted = true
    const entry = await submit('/api/nomina/marcaje/entrada', {
      empleadoId: employee.id, idempotencyKey: `${runId}-entry`, nota: notes.clock,
    }, '2026-09-22T12:00:00.000Z')
    assert(entry.status === 201 && entry.payload?.registro?.hora_entrada,
      `Staging real clock-in failed (${entry.status}): ${entry.payload?.error || 'unexpected response'}.`)
    const clockedTime = String(entry.payload.registro.hora_entrada).slice(0, 5)
    assert(/^\d{2}:\d{2}$/.test(clockedTime), `Unexpected staging clock time ${clockedTime}.`)
    checks.push('real clock-in at deterministic local time')

    const openCalc = await submit('/api/nomina/periodos/calcular', { periodoId: period.id })
    assert(openCalc.status === 409 && openCalc.payload?.total_jornadas_abiertas === 1,
      `Payroll calculation must block one open jornada (got ${openCalc.status}).`)
    assert((await readHandler(`/api/nomina/lineas?periodoId=${period.id}`)).length === 0,
      'Open-jornada rejection must not create a payroll line.')
    const confirmedOpenCalc = await submit('/api/nomina/periodos/calcular', {
      periodoId: period.id, confirmarJornadasAbiertas: true,
    })
    assert(confirmedOpenCalc.status === 200 && confirmedOpenCalc.payload?.lineas_generadas === 1,
      `Explicit open-jornada confirmation should calculate without including the in-progress shift (${confirmedOpenCalc.status}).`)
    const openLines = await readHandler(`/api/nomina/lineas?periodoId=${period.id}`)
    assert(openLines.length === 1 && Number(openLines[0].total_bruto_usd) === 0
      && Number(openLines[0].dias_trabajados) === 0 && !openLines[0].pagado,
    'Confirmed open jornada must not be treated as worked time or a payable day.')
    payrollLineId = openLines[0].id
    const stillUnconfirmed = await submit('/api/nomina/periodos/calcular', { periodoId: period.id })
    assert(stillUnconfirmed.status === 409 && stillUnconfirmed.payload?.total_jornadas_abiertas === 1,
      'Confirmation is per calculation request and must not permanently bypass the open-jornada guard.')
    checks.push('block open jornada unless the calculation request explicitly confirms it')
    checks.push('confirmed open jornada creates only a zero/unpaid line and is never treated as worked')

    const entryAgain = await submit('/api/nomina/marcaje/entrada', {
      empleadoId: employee.id, idempotencyKey: `${runId}-entry`, nota: notes.clock,
    }, '2026-09-22T12:00:00.000Z')
    assert(entryAgain.status === 200 && entryAgain.payload?.idempotente === true,
      `Same clock-in idempotency key must not create another row (${entryAgain.status}: ${entryAgain.payload?.error || 'unexpected response'}).`)
    checks.push('clock-in idempotency')

    const [entryHour, entryMinute] = clockedTime.split(':').map(Number)
    const elapsedMinutes = entryHour * 60 + entryMinute + 10 * 60
    const exitTime = timestampForLocalTime(
      '2026-09-22', Math.floor(elapsedMinutes / 60), elapsedMinutes % 60,
      env.NOMINA_TIMEZONE,
    )
    const exit = await submit('/api/nomina/marcaje/salida', {
      empleadoId: employee.id, idempotencyKey: `${runId}-exit`, nota: notes.clock,
    }, exitTime)
    const expectedClockHours = ROUND4(10 - breakHours)
    assert(exit.status === 200, `Staging clock-out failed (${exit.status}).`)
    closeEnough(exit.payload?.registro?.horas_trabajadas, ROUND4(10 - breakHours), 'clocked hours before correction')
    closeEnough(exit.payload?.registro?.horas_normales, Math.min(10 - breakHours, workdayHours), 'clocked normal hours before correction')
    closeEnough(exit.payload?.registro?.horas_extra, Math.max(0, 10 - breakHours - workdayHours), 'clocked overtime before correction')
    checks.push('deterministic clock-out hours and overtime')

    // A correction with stale original hours must conflict; a valid correction
    // changes the input time by 15 minutes and recalculates hours/overtime.
    const clockRecord = exit.payload?.registro
    const originalClockIn = String(clockRecord?.hora_entrada || '').slice(0, 5)
    const originalClockOut = String(clockRecord?.hora_salida || '').slice(0, 5)
    assert(clockRecord?.id && originalClockIn === clockedTime && originalClockOut,
      'Clock-out must return the real synthetic record and both original times for correction testing.')
    const staleCorrection = await submit('/api/nomina/marcaje/corregir', {
      registroId: clockRecord.id,
      horaEntradaAnterior: originalClockIn === '00:00' ? '00:01' : '00:00',
      horaSalidaAnterior: originalClockOut,
      horaEntrada: '08:15',
      horaSalida: originalClockOut,
      motivo: `${runId}-stale-correction`,
    })
    assert(staleCorrection.status === 409, `Correction with stale original values must return 409, got ${staleCorrection.status}.`)
    const invalidCorrection = await submit('/api/nomina/marcaje/corregir', {
      registroId: clockRecord.id,
      horaEntradaAnterior: originalClockIn,
      horaSalidaAnterior: originalClockOut,
      horaEntrada: '08:15',
      horaSalida: originalClockOut,
      motivo: 'x',
    })
    assert(invalidCorrection.status === 400, `Correction with a too-short reason must return 400, got ${invalidCorrection.status}.`)
    const corrected = await submit('/api/nomina/marcaje/corregir', {
      registroId: clockRecord.id,
      horaEntradaAnterior: originalClockIn,
      horaSalidaAnterior: originalClockOut,
      horaEntrada: '08:15',
      horaSalida: originalClockOut,
      motivo: `${runId}-valid-correction`,
    })
    assert(corrected.status === 200, `Valid 15-minute staging correction failed (${corrected.status}: ${corrected.payload?.error || 'unexpected response'}).`)
    assert(corrected.payload?.registro?.estado_marcaje === 'corregido'
      && String(corrected.payload?.registro?.hora_entrada).slice(0, 5) === '08:15'
      && String(corrected.payload?.registro?.hora_salida).slice(0, 5) === originalClockOut,
    'Valid correction did not persist the adjusted entry and preserve the original exit.')
    closeEnough(corrected.payload?.registro?.horas_trabajadas, correctedClockHours, 'corrected clock hours')
    closeEnough(corrected.payload?.registro?.horas_normales, workdayHours, 'corrected normal hours')
    closeEnough(corrected.payload?.registro?.horas_extra, correctedClockHours - workdayHours, 'corrected overtime')
    checks.push('reject stale/invalid corrections and recalculate a valid 15-minute clock correction')

    // Stale compare-and-set in the manual endpoint must not overwrite the clock row.
    const staleEdit = await submit('/api/nomina/asistencia/registrar', {
      empleadoId: employee.id, fecha: '2026-09-22', horaEntrada: '08:00', horaSalida: '17:00',
      esFeriado: false, esAusencia: false, nota: `${runId}-stale`, horasDescanso: 0,
      registroIdEsperado: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', estadoMarcajeEsperado: 'manual',
    })
    assert(staleEdit.status === 409, `Stale manual compare-and-set should conflict, got ${staleEdit.status}.`)
    checks.push('reject stale attendance edit against a real clock record')

    await recordManual({ fecha: '2026-09-21', horaEntrada: '08:00', horaSalida: '17:00', nota: notes.monday, horasDescanso: 1 })
    await recordManual({ fecha: '2026-09-24', horaEntrada: '08:00', horaSalida: '17:00', nota: notes.thursday, horasDescanso: 1 })
    await recordManual({ fecha: '2026-09-25', horaEntrada: '08:00', horaSalida: '17:00', esFeriado: true, nota: notes.holiday, horasDescanso: 1 })
    await recordManual({ fecha: '2026-09-26', horaEntrada: '08:00', horaSalida: '18:00', nota: notes.saturday, horasDescanso: 0 })
    await recordManual({ fecha: '2026-09-23', nota: notes.absence, esAusencia: true, horasDescanso: 0 })
    checks.push('manual weekday, holiday, Saturday overtime, and absence records')

    const attendance = await readHandler(`/api/nomina/asistencia?desde=${PERIOD_FROM}&hasta=${PERIOD_TO}`)
    const rows = attendance.registros || []
    assert(rows.length === 6, `Expected exactly five worked days plus one absence, got ${rows.length}.`)
    const byDate = new Map(rows.map(row => [row.fecha, row]))
    for (const date of ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']) {
      assert(byDate.has(date), `Missing deterministic staging attendance for ${date}.`)
    }
    assert(!byDate.has('2026-09-27'), 'No attendance should exist on synthetic Sunday.')
    assert(byDate.get('2026-09-22').estado_marcaje === 'corregido', 'Clock record should retain its corrected status.')
    assert(String(byDate.get('2026-09-22').hora_entrada).slice(0, 5) === '08:15', 'Corrected clock-in time should be 08:15.')
    assert(byDate.get('2026-09-23').es_ausencia === true, 'Wednesday should be explicitly absent.')
    assert(byDate.get('2026-09-25').es_feriado === true, 'Friday work must carry the holiday flag.')
    assert(byDate.get('2026-09-26').es_sabado === true && Number(byDate.get('2026-09-26').horas_extra) === 2,
      'Saturday should carry two overtime hours.')
    closeEnough(rows.reduce((sum, row) => sum + Number(row.horas_normales || 0), 0), expectedNormalHours, 'weekly normal hours')
    closeEnough(rows.reduce((sum, row) => sum + Number(row.horas_extra || 0), 0), expectedOvertimeHours, 'weekly overtime hours')
    checks.push('verify tenant-scoped six-row weekly attendance and hour totals')

    const calculate = await submit('/api/nomina/periodos/calcular', { periodoId: period.id })
    assert(calculate.status === 200 && calculate.payload?.lineas_generadas === 1,
      `Non-zero staging payroll calculation failed (${calculate.status}).`)
    const lines = await readHandler(`/api/nomina/lineas?periodoId=${period.id}`)
    assert(lines.length === 1 && lines[0].empleado?.nombre === 'Empleado Sintético Staging',
      'Calculation must yield exactly the synthetic employee line.')
    const line = lines[0]
    payrollLineId = line.id
    assert(!line.pagado, 'Test payroll line must remain unpaid.')
    closeEnough(line.dias_trabajados, attendedDays, 'worked days')
    closeEnough(line.dias_ausencia, 1, 'absence days')
    closeEnough(line.dias_sabado, 1, 'Saturday count')
    closeEnough(line.dias_feriado, 1, 'holiday count')
    closeEnough(line.horas_normales, expectedNormalHours, 'payroll normal hours')
    closeEnough(line.horas_extra, expectedOvertimeHours, 'payroll overtime hours')
    closeEnough(line.monto_normal_usd, expectedNormalPay, 'normal pay')
    closeEnough(line.monto_extra_usd, expectedOvertimePay, 'overtime pay')
    closeEnough(line.monto_sabado_usd, expectedSaturdayPay, 'Saturday premium')
    closeEnough(line.monto_feriado_usd, expectedHolidayPay, 'holiday premium')
    closeEnough(line.total_bruto_usd, expectedGross, 'gross payroll')
    closeEnough(line.total_neto_usd, expectedGross, 'net payroll')
    checks.push('recalculate confirmed open-jornada line after correction and compute exact overtime/payroll')

    const calculateAgain = await submit('/api/nomina/periodos/calcular', { periodoId: period.id })
    assert(calculateAgain.status === 200, `Second calculation failed (${calculateAgain.status}).`)
    const repeated = await readHandler(`/api/nomina/lineas?periodoId=${period.id}`)
    assert(repeated.length === 1 && repeated[0].id === payrollLineId,
      'Repeated calculation must update/reuse the same payroll line, not duplicate it.')
    closeEnough(repeated[0].total_bruto_usd, expectedGross, 'idempotent gross payroll')
    checks.push('payroll calculation idempotency')

    const stillOpen = (await readHandler('/api/nomina/periodos')).find(row => row.id === period.id)
    assert(stillOpen?.estado === 'abierto', 'The synthetic period must remain open; closing is out of test scope.')
    checks.push('period remains open and no payroll was paid')
  } finally {
    if (mutationStarted) {
      // Restrict cleanup to this test's random note prefix, synthetic employee and staging tenant.
      const markerUrl = new URL(`${SUPABASE_URL}/rest/v1/registro_asistencia`)
      markerUrl.searchParams.set('cuenta_id', `eq.${accountId}`)
      markerUrl.searchParams.set('empleado_id', `eq.${employee.id}`)
      markerUrl.searchParams.set('nota', `like.${runId}*`)
      markerUrl.searchParams.set('select', 'id,nota')
      const findRows = await serviceRequest(`${markerUrl.pathname}${markerUrl.search}`)
      assert(findRows.ok, `Cleanup preflight for synthetic attendance failed (${findRows.status}).`)
      const ownedRows = await findRows.json()
      assert(ownedRows.every(row => row.nota?.startsWith(runId)), 'Cleanup query returned a row without this test run marker; refusing delete.')
      if (ownedRows.length) {
        const deleteUrl = new URL(`${SUPABASE_URL}/rest/v1/registro_asistencia`)
        deleteUrl.searchParams.set('id', `in.(${ownedRows.map(row => row.id).join(',')})`)
        deleteUrl.searchParams.set('cuenta_id', `eq.${accountId}`)
        deleteUrl.searchParams.set('empleado_id', `eq.${employee.id}`)
        const deleted = await serviceRequest(`${deleteUrl.pathname}${deleteUrl.search}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
        assert(deleted.ok, `Could not clean synthetic attendance rows (${deleted.status}).`)
      }
      const remaining = await serviceRequest(`${markerUrl.pathname}${markerUrl.search}`)
      assert(remaining.ok && (await remaining.json()).length === 0, 'Staging attendance cleanup verification failed.')

      // This period had no lines at preflight; remove only its one unpaid synthetic test line.
      const lineUrl = new URL(`${SUPABASE_URL}/rest/v1/nomina_lineas`)
      lineUrl.searchParams.set('cuenta_id', `eq.${accountId}`)
      lineUrl.searchParams.set('periodo_id', `eq.${period.id}`)
      lineUrl.searchParams.set('empleado_id', `eq.${employee.id}`)
      lineUrl.searchParams.set('pagado', 'eq.false')
      if (payrollLineId) lineUrl.searchParams.set('id', `eq.${payrollLineId}`)
      lineUrl.searchParams.set('select', 'id')
      const linesToClean = await serviceRequest(`${lineUrl.pathname}${lineUrl.search}`)
      assert(linesToClean.ok, `Could not inspect the synthetic test payroll line (${linesToClean.status}).`)
      const lineIds = (await linesToClean.json()).map(row => row.id)
      if (lineIds.length) {
        assert(!payrollLineId || lineIds.every(id => id === payrollLineId), 'Cleanup found an unexpected payroll line; refusing delete.')
        const deleteLineUrl = new URL(`${SUPABASE_URL}/rest/v1/nomina_lineas`)
        deleteLineUrl.searchParams.set('cuenta_id', `eq.${accountId}`)
        deleteLineUrl.searchParams.set('periodo_id', `eq.${period.id}`)
        deleteLineUrl.searchParams.set('empleado_id', `eq.${employee.id}`)
        deleteLineUrl.searchParams.set('pagado', 'eq.false')
        deleteLineUrl.searchParams.set('id', `in.(${lineIds.join(',')})`)
        const deletedLines = await serviceRequest(`${deleteLineUrl.pathname}${deleteLineUrl.search}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
        assert(deletedLines.ok, `Could not clean synthetic payroll line (${deletedLines.status}).`)
      }
      const postCleanupAttendance = await readHandler(`/api/nomina/asistencia?desde=${PERIOD_FROM}&hasta=${PERIOD_TO}`)
      assert(postCleanupAttendance.registros.length === 0, 'Attendance test rows remain after cleanup.')
      const postCleanupRows = await getRows(`/rest/v1/registro_asistencia?cuenta_id=eq.${accountId}&empleado_id=eq.${employee.id}&fecha=gte.${PERIOD_FROM}&fecha=lte.${PERIOD_TO}&select=id,nota&limit=100`)
      assert(postCleanupRows.length === 0, 'Synthetic payroll week was not restored to zero attendance rows.')
      const postCleanupLines = await readHandler(`/api/nomina/lineas?periodoId=${period.id}`)
      assert(postCleanupLines.length === 0, 'Test payroll line remains after cleanup.')
      const postCleanupPeriod = (await readHandler('/api/nomina/periodos')).find(row => row.id === period.id)
      assert(postCleanupPeriod?.estado === 'abierto', 'Synthetic open period was not preserved.')
    }
  }

  console.log(JSON.stringify({
    target: 'isolated-staging',
    deterministicChecks: checks,
    checkCount: checks.length,
    expectedGrossUsd: expectedGross,
    expectedNormalHours: expectedNormalHours,
    expectedOvertimeHours: expectedOvertimeHours,
    attendanceAfterCleanup: 0,
    payrollLinesAfterCleanup: 0,
    fixturePeriodPreservedOpen: true,
    periodClosed: false,
    payrollPaid: false,
    productionTouched: false,
  }, null, 2))
}

main().catch(error => {
  console.error(`Staging deterministic test failed: ${error.message}`)
  process.exitCode = 1
})
