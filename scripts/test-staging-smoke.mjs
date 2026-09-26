import fs from 'node:fs'
import worker from '../worker.js'

const REF = 'wishglzpmcshyvlgpjxj'
const SUPABASE_URL = `https://${REF}.supabase.co`
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

async function main() {
  const frontend = readEnv('.env.staging.local')
  const localWorker = readEnv('.dev.vars.staging')
  if (frontend.VITE_SUPABASE_URL !== SUPABASE_URL || localWorker.SUPABASE_URL !== SUPABASE_URL) {
    throw new Error('Staging Worker smoke test refused: configured target does not match staging.')
  }
  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: frontend.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: frontend.STAGING_TEST_EMAIL, password: frontend.STAGING_TEST_PASSWORD }),
  })
  if (!login.ok) throw new Error(`Staging login failed (${login.status}).`)
  const session = await login.json()
  if (!session.access_token || !session.user?.id) throw new Error('Staging login response is incomplete.')
  const env = {
    SUPABASE_URL: localWorker.SUPABASE_URL,
    SUPABASE_ANON_KEY: localWorker.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: localWorker.SUPABASE_SERVICE_KEY,
    NOMINA_TIMEZONE: localWorker.NOMINA_TIMEZONE,
    NOMINA_ALLOWED_ORIGINS: localWorker.NOMINA_ALLOWED_ORIGINS,
  }
  const request = (path, { method = 'GET', body, now = null } = {}) => worker.fetch(new Request(`http://127.0.0.1:8789${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), now ? { ...env, NOMINA_NOW: now } : env)
  const check = async path => {
    const response = await request(path)
    const text = await response.text()
    if (response.status !== 200) throw new Error(`${path} returned ${response.status}; expected 200.`)
    try { return JSON.parse(text) } catch { throw new Error(`${path} returned a non-JSON response.`) }
  }
  const unauthenticatedProfile = await worker.fetch(new Request('http://127.0.0.1:8789/api/auth/me'), env)
  if (unauthenticatedProfile.status !== 401) throw new Error(`Unauthenticated profile returned ${unauthenticatedProfile.status}, expected 401.`)

  const operatorsResult = await check('/api/auth/operators')

  const operators = operatorsResult.operators || []
  if (operators.length !== 1 || operators[0].nombre !== 'Operador QA Staging') throw new Error('Worker operator listing failed.')
  const switched = await request('/api/auth/switch-operator', {
    method: 'POST', body: { operator_id: operators[0].id, pin: frontend.STAGING_TEST_PIN },
  })
  if (switched.status !== 200) throw new Error(`Staging PIN selection failed (${switched.status}).`)
  const profile = (await check('/api/auth/me')).profile
  if (profile?.nombre !== 'Operador QA Staging' || profile?.cuenta_id !== session.user.id) throw new Error('Staging profile mismatch.')
  const employeeResult = await check('/api/nomina/empleados')
  const employees = Array.isArray(employeeResult) ? employeeResult : employeeResult.empleados
  const employee = employees?.find(row => row.nombre === 'Empleado Sintético Staging')
  if (!employee) throw new Error('Worker did not return the synthetic employee.')

  const duplicateVendedor = await fetch(`${SUPABASE_URL}/rest/v1/nomina_config_empleado?cuenta_id=eq.${session.user.id}&empleado_id=eq.${employee.id}&select=empleado_id,pos_vendedor_id`, {
    headers: { apikey: localWorker.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${localWorker.SUPABASE_SERVICE_KEY}` },
  })
  if (!duplicateVendedor.ok) throw new Error(`Could not inspect POS link isolation (${duplicateVendedor.status}).`)
  const configs = await duplicateVendedor.json()
  if (configs.length !== 1 || configs[0].pos_vendedor_id) throw new Error('Synthetic payroll employee unexpectedly contains a POS vendor link.')
  const attendanceResult = await check('/api/nomina/asistencia?desde=2026-09-21&hasta=2026-09-27')
  if (!Array.isArray(attendanceResult.registros) || attendanceResult.registros.length) throw new Error('Staging week was not empty initially.')
  const holidays = await check('/api/nomina/calendario/feriados?desde=2026-09-21&hasta=2026-09-27')
  if (!holidays.some(row => row.fecha === '2026-09-25' && row.laborable === false)) throw new Error('Staging holiday was not returned.')

  let periods = await check('/api/nomina/periodos')
  let stagingPeriod = Array.isArray(periods)
    ? periods.find(row => row.nombre === 'Período sintético staging' && row.desde === '2026-09-21' && row.hasta === '2026-09-27')
    : null
  if (!stagingPeriod) {
    const created = await request('/api/nomina/periodos/crear', {
      method: 'POST', body: { nombre: 'Período sintético staging', desde: '2026-09-21', hasta: '2026-09-27', tipo: 'semanal' },
    })
    if (created.status !== 201) throw new Error(`Could not restore the synthetic staging week (${created.status}).`)
    stagingPeriod = (await created.json()).periodo
  }
  if (stagingPeriod.estado !== 'abierto') throw new Error('Synthetic staging period must remain open for test.')
  const commissionAttack = await request('/api/nomina/aplicar-comisiones-pos', {
    method: 'POST', body: { periodoId: stagingPeriod.id, aplicaciones: [{ empleadoId: employee.id, comisionesUsd: 999999, despachosIds: ['forged-dispatch'] }] },
  })
  if (commissionAttack.status !== 409) throw new Error(`Staging accepted a forged commission without an active POS link (${commissionAttack.status}).`)

  const linesBefore = await check(`/api/nomina/lineas?periodoId=${stagingPeriod.id}`)
  if (linesBefore.length) throw new Error('Refusing to touch pre-existing payroll lines in the synthetic period.')
  let createdAttendanceId = null
  let payrollLineId = null
  let mutationsStarted = false
  try {
    const saturday = '2026-09-26T13:00:00.000Z'
    mutationsStarted = true
    const absence = await request('/api/nomina/marcaje/ausencia', { method: 'POST', body: { empleadoId: employee.id, quitar: false }, now: saturday })
    if (absence.status === 201) {
      const result = await absence.json()
      createdAttendanceId = result.registro?.id || null
    }
    if (absence.status !== 201) throw new Error(`Staging Saturday absence failed (${absence.status}).`)
    const absentRows = await check('/api/nomina/asistencia?desde=2026-09-26&hasta=2026-09-26')
    if (absentRows.registros?.length !== 1 || absentRows.registros[0].es_ausencia !== true) throw new Error('Absence not created.')
    createdAttendanceId ||= absentRows.registros[0].id
    const reversed = await request('/api/nomina/marcaje/ausencia', { method: 'POST', body: { empleadoId: employee.id, quitar: true }, now: saturday })
    if (reversed.status !== 200) throw new Error(`Staging absence reversal failed (${reversed.status}).`)
    createdAttendanceId = null
    if ((await check('/api/nomina/asistencia?desde=2026-09-26&hasta=2026-09-26')).registros?.length) throw new Error('Reversed absence remained in DB.')

    const sunday = await request('/api/nomina/marcaje/ausencia', { method: 'POST', body: { empleadoId: employee.id, quitar: false }, now: '2026-09-27T13:00:00.000Z' })
    const holiday = await request('/api/nomina/marcaje/ausencia', { method: 'POST', body: { empleadoId: employee.id, quitar: false }, now: '2026-09-25T13:00:00.000Z' })
    if (sunday.status !== 400 || holiday.status !== 400) throw new Error(`Non-working absence accepted (${sunday.status}/${holiday.status}).`)
    if ((await check('/api/nomina/asistencia?desde=2026-09-21&hasta=2026-09-27')).registros?.length) throw new Error('Absence tests left attendance rows behind.')

    const calc = await request('/api/nomina/periodos/calcular', { method: 'POST', body: { periodoId: stagingPeriod.id } })
    if (calc.status !== 200) throw new Error(`Staging payroll calculation failed (${calc.status}).`)
    const lines = await check(`/api/nomina/lineas?periodoId=${stagingPeriod.id}`)
    if (Array.isArray(lines) && lines.length === 1) payrollLineId = lines[0].id
    if (!Array.isArray(lines) || lines.length !== 1 || lines[0].empleado?.nombre !== 'Empleado Sintético Staging') throw new Error('Expected one synthetic payroll line.')
    const line = lines[0]
    if (Number(line.total_bruto_usd) !== 0 || Number(line.total_neto_usd) !== 0 || line.pagado) throw new Error('Smoke-test payroll line must be zero and unpaid.')
    const recalc = await request('/api/nomina/periodos/calcular', { method: 'POST', body: { periodoId: stagingPeriod.id } })
    if (recalc.status !== 200) throw new Error(`Idempotent recalculation failed (${recalc.status}).`)
    const recalcLines = await check(`/api/nomina/lineas?periodoId=${stagingPeriod.id}`)
    if (recalcLines.length !== 1 || recalcLines[0].id !== line.id) throw new Error('Recalculation duplicated/replaced the line.')
  } finally {
    if (mutationsStarted) {
      const headers = { apikey: localWorker.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${localWorker.SUPABASE_SERVICE_KEY}` }
      const attendanceUrl = new URL(`${SUPABASE_URL}/rest/v1/registro_asistencia`)
      attendanceUrl.searchParams.set('cuenta_id', `eq.${session.user.id}`)
      attendanceUrl.searchParams.set('empleado_id', `eq.${employee.id}`)
      attendanceUrl.searchParams.set('fecha', 'gte.2026-09-21')
      attendanceUrl.searchParams.append('fecha', 'lte.2026-09-27')
      attendanceUrl.searchParams.set('select', 'id,fecha,hora_entrada,hora_salida,es_ausencia,estado_marcaje')
      const attendanceResponse = await fetch(attendanceUrl, { headers })
      if (!attendanceResponse.ok) throw new Error(`Could not inspect synthetic attendance cleanup (${attendanceResponse.status}).`)
      const attendanceRows = await attendanceResponse.json()
      if (attendanceRows.length) {
        if (attendanceRows.length !== 1 || attendanceRows[0].fecha !== '2026-09-26'
          || attendanceRows[0].es_ausencia !== true || attendanceRows[0].estado_marcaje !== 'manual'
          || attendanceRows[0].hora_entrada || attendanceRows[0].hora_salida
          || (createdAttendanceId && attendanceRows[0].id !== createdAttendanceId)) {
          throw new Error('Cleanup found unexpected attendance; refusing to delete it.')
        }
        const deleteAttendanceUrl = new URL(`${SUPABASE_URL}/rest/v1/registro_asistencia`)
        deleteAttendanceUrl.searchParams.set('cuenta_id', `eq.${session.user.id}`)
        deleteAttendanceUrl.searchParams.set('empleado_id', `eq.${employee.id}`)
        deleteAttendanceUrl.searchParams.set('id', `eq.${attendanceRows[0].id}`)
        deleteAttendanceUrl.searchParams.set('es_ausencia', 'eq.true')
        deleteAttendanceUrl.searchParams.set('estado_marcaje', 'eq.manual')
        const deletedAttendance = await fetch(deleteAttendanceUrl, { method: 'DELETE', headers: { ...headers, Prefer: 'return=minimal' } })
        if (!deletedAttendance.ok) throw new Error(`Could not clean synthetic attendance (${deletedAttendance.status}).`)
      }
      const verifyAttendance = await fetch(attendanceUrl, { headers })
      if (!verifyAttendance.ok || (await verifyAttendance.json()).length) throw new Error('Synthetic attendance cleanup did not restore an empty week.')

      const lineUrl = new URL(`${SUPABASE_URL}/rest/v1/nomina_lineas`)
      lineUrl.searchParams.set('cuenta_id', `eq.${session.user.id}`)
      lineUrl.searchParams.set('periodo_id', `eq.${stagingPeriod.id}`)
      lineUrl.searchParams.set('empleado_id', `eq.${employee.id}`)
      lineUrl.searchParams.set('select', 'id,pagado,total_bruto_usd,total_neto_usd,comisiones_pos_usd')
      const lineResponse = await fetch(lineUrl, { headers })
      if (!lineResponse.ok) throw new Error(`Could not inspect synthetic payroll cleanup (${lineResponse.status}).`)
      const generatedLines = await lineResponse.json()
      if (generatedLines.length) {
        const generatedLine = generatedLines[0]
        if (generatedLines.length !== 1 || generatedLine.pagado !== false
          || Number(generatedLine.total_bruto_usd) !== 0 || Number(generatedLine.total_neto_usd) !== 0
          || Number(generatedLine.comisiones_pos_usd || 0) !== 0
          || (payrollLineId && generatedLine.id !== payrollLineId)) {
          throw new Error('Cleanup found a non-test payroll line; refusing to delete it.')
        }
        const deleteLineUrl = new URL(`${SUPABASE_URL}/rest/v1/nomina_lineas`)
        deleteLineUrl.searchParams.set('cuenta_id', `eq.${session.user.id}`)
        deleteLineUrl.searchParams.set('periodo_id', `eq.${stagingPeriod.id}`)
        deleteLineUrl.searchParams.set('empleado_id', `eq.${employee.id}`)
        deleteLineUrl.searchParams.set('id', `eq.${generatedLine.id}`)
        deleteLineUrl.searchParams.set('pagado', 'eq.false')
        const deletedLine = await fetch(deleteLineUrl, { method: 'DELETE', headers: { ...headers, Prefer: 'return=minimal' } })
        if (!deletedLine.ok) throw new Error(`Could not clean synthetic payroll line (${deletedLine.status}).`)
      }
      const verifyLine = await fetch(lineUrl, { headers })
      if (!verifyLine.ok || (await verifyLine.json()).length) throw new Error('Synthetic payroll cleanup did not restore an empty period.')
      periods = await check('/api/nomina/periodos')
      if (!periods.some(row => row.id === stagingPeriod.id && row.estado === 'abierto')) throw new Error('Staging fixture period was not preserved.')
    }
  }

  console.log(JSON.stringify({
    target: 'staging-only', login: login.status, operators: operators.length,
    pinSelection: switched.status, unauthenticatedProfile: '401', profile: 'PASS', employees: employees.length,

    initialAttendanceRows: 0, reversibleSaturdayAbsence: 'PASS',
    forgedCommissionWithoutPOSLink: 'REJECTED',
    SundayAndHolidayAbsencesRejected: 'PASS', finalAttendanceRows: 0,
    zeroValuePayrollCalculation: 'PASS', repeatedCalculationIdempotent: 'PASS',
    generatedLineCleanup: 'PASS', openFixturePeriodPreserved: 'PASS', payrollPayment: false,
  }, null, 2))
}

main().catch(error => { console.error(`Staging API smoke test failed: ${error.message}`); process.exitCode = 1 })
