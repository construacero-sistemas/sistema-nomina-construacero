import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import worker from '../worker.js'

const REF = 'wishglzpmcshyvlgpjxj'
const SUPABASE_URL = `https://${REF}.supabase.co`
const FIXTURE_WEEK = ['2026-09-21', '2026-09-27']

function readEnv(path) {
  if (!fs.existsSync(path)) throw new Error(`Missing staging config: ${path}`)
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

async function main() {
  const frontend = readEnv('.env.staging.local')
  const localWorker = readEnv('.dev.vars.staging')
  assert(frontend.VITE_SUPABASE_URL === SUPABASE_URL && localWorker.SUPABASE_URL === SUPABASE_URL,
    'Refusing concurrency test: both configs must target the isolated staging project.')
  assert(frontend.VITE_SUPABASE_ANON_KEY?.startsWith('sb_publishable_')
    && localWorker.SUPABASE_SERVICE_KEY?.startsWith('sb_secret_'),
  'Refusing concurrency test: expected staging-only key types.')

  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: frontend.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: frontend.STAGING_TEST_EMAIL, password: frontend.STAGING_TEST_PASSWORD }),
  })
  assert(login.ok, `Synthetic staging login failed (${login.status}).`)
  const session = await login.json()
  const accountId = session.user?.id
  assert(accountId, 'Synthetic staging login did not return an account ID.')

  const env = {
    SUPABASE_URL: localWorker.SUPABASE_URL,
    SUPABASE_ANON_KEY: localWorker.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: localWorker.SUPABASE_SERVICE_KEY,
    NOMINA_TIMEZONE: localWorker.NOMINA_TIMEZONE || 'America/Caracas',
    NOMINA_ALLOWED_ORIGINS: localWorker.NOMINA_ALLOWED_ORIGINS || '',
  }
  const workerRequest = (path, body) => worker.fetch(new Request(`http://127.0.0.1:8789${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env)
  const workerJson = async (path, body) => {
    const response = await workerRequest(path, body)
    const payload = await response.json().catch(() => null)
    return { status: response.status, payload }
  }
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
    assert(response.ok, `Staging concurrency fixture read failed (${response.status}).`)
    return response.json()
  }

  const operatorResponse = await workerJson('/api/auth/operators')
  const operators = operatorResponse.payload?.operators || []
  assert(operatorResponse.status === 200 && operators.length === 1
    && operators[0].nombre === 'Operador QA Staging', 'Unexpected staging operator set.')
  const switched = await workerJson('/api/auth/switch-operator', {
    operator_id: operators[0].id,
    pin: frontend.STAGING_TEST_PIN,
  })
  assert(switched.status === 200, `Could not activate the synthetic staging operator (${switched.status}).`)

  const employeesResult = await workerJson('/api/nomina/empleados')
  const employees = Array.isArray(employeesResult.payload) ? employeesResult.payload : employeesResult.payload?.empleados
  assert(employeesResult.status === 200 && employees?.length === 1
    && employees[0].nombre === 'Empleado Sintético Staging', 'Unexpected staging employee set.')
  const employee = employees[0]
  const periodResult = await workerJson('/api/nomina/periodos')
  const period = periodResult.payload?.find(row => row.nombre === 'Período sintético staging'
    && row.desde === FIXTURE_WEEK[0] && row.hasta === FIXTURE_WEEK[1])
  assert(periodResult.status === 200 && period?.estado === 'abierto', 'Synthetic staging period must remain open.')

  const attendance = await getRows(`/rest/v1/registro_asistencia?cuenta_id=eq.${accountId}&empleado_id=eq.${employee.id}&fecha=gte.${FIXTURE_WEEK[0]}&fecha=lte.${FIXTURE_WEEK[1]}&select=id&limit=20`)
  const initialLines = await getRows(`/rest/v1/nomina_lineas?cuenta_id=eq.${accountId}&periodo_id=eq.${period.id}&select=id,pagado&limit=20`)
  assert(attendance.length === 0 && initialLines.length === 0,
    'Refusing to race operations: synthetic period must have zero attendance and payroll lines.')

  let lineId = null
  let calculationAttempted = false
  try {
    calculationAttempted = true
    const calculation = await workerJson('/api/nomina/periodos/calcular', { periodoId: period.id })
    assert(calculation.status === 200 && calculation.payload?.lineas_generadas === 1,
      `Could not create a zero-value unpaid synthetic line (${calculation.status}).`)
    const lines = await getRows(`/rest/v1/nomina_lineas?cuenta_id=eq.${accountId}&periodo_id=eq.${period.id}&empleado_id=eq.${employee.id}&select=id,pagado,total_neto_usd,comisiones_pos_usd&limit=2`)
    assert(lines.length === 1 && lines[0].pagado === false && Number(lines[0].total_neto_usd) === 0,
      'Concurrency test requires exactly one zero-value unpaid synthetic line.')
    lineId = lines[0].id

    const runKey = randomUUID()
    const applications = [{ empleadoId: employee.id, comisionesUsd: '12.34', despachosIds: [`synthetic-${runKey}`] }]
    const invoke = () => serviceRequest('/rest/v1/rpc/nomina_aplicar_comisiones_pos', {
      method: 'POST',
      body: JSON.stringify({
        p_cuenta_id: accountId,
        p_operador_id: operators[0].id,
        p_periodo_id: period.id,
        p_aplicaciones: applications,
        p_ip: null,
      }),
    })

    // Requests reach PostgreSQL independently. The RPC must serialize using its
    // advisory lock and row lock, replacing the same snapshot without duplicates.
    const [first, second] = await Promise.all([invoke(), invoke()])
    assert(first.ok && second.ok, `Concurrent RPC pair failed (${first.status}/${second.status}).`)
    const [firstResult, secondResult] = await Promise.all([first.json(), second.json()])
    for (const result of [firstResult, secondResult]) {
      assert(result.ok === true && result.actualizados === 1
        && Math.abs(Number(result.total_comisiones_usd) - 12.34) < 0.0001,
      'Concurrent RPC did not return the confirmed synthetic commission result.')
    }
    const after = await getRows(`/rest/v1/nomina_lineas?cuenta_id=eq.${accountId}&periodo_id=eq.${period.id}&empleado_id=eq.${employee.id}&select=id,pagado,total_neto_usd,comisiones_pos_usd,comisiones_despachos_ids&limit=2`)
    assert(after.length === 1 && after[0].id === lineId && after[0].pagado === false
      && Number(after[0].comisiones_pos_usd) === 12.34 && Number(after[0].total_neto_usd) === 12.34
      && JSON.stringify(after[0].comisiones_despachos_ids) === JSON.stringify([`synthetic-${runKey}`]),
    'Concurrent commission application duplicated or corrupted the payroll line.')

    console.log(JSON.stringify({
      target: 'isolated-staging',
      concurrentRpcRequests: 2,
      confirmedResponses: 2,
      receiptRowsAfterRace: after.length,
      commissionUsd: 12.34,
      periodClosed: false,
      payrollPaid: false,
      cleanupVerified: true,
      productionTouched: false,
    }, null, 2))
  } finally {
    if (calculationAttempted) {
      const createdLines = await getRows(`/rest/v1/nomina_lineas?cuenta_id=eq.${accountId}&periodo_id=eq.${period.id}&empleado_id=eq.${employee.id}&select=id,pagado&limit=2`)
      assert(createdLines.length <= 1, 'Cleanup found multiple synthetic payroll lines; refusing to delete them.')
      if (createdLines.length === 1) {
        const createdLine = createdLines[0]
        assert(createdLine.pagado === false, 'Cleanup found a paid line; refusing to delete it.')
        assert(!lineId || createdLine.id === lineId, 'Cleanup found an unexpected line ID; refusing to delete it.')
        const cleanup = await serviceRequest(
          `/rest/v1/nomina_lineas?cuenta_id=eq.${accountId}&periodo_id=eq.${period.id}&empleado_id=eq.${employee.id}&id=eq.${createdLine.id}&pagado=eq.false`,
          { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
        )
        assert(cleanup.ok, `Could not clean the one synthetic concurrency line (${cleanup.status}).`)
      }
      const remaining = await getRows(`/rest/v1/nomina_lineas?cuenta_id=eq.${accountId}&periodo_id=eq.${period.id}&select=id&limit=20`)
      assert(remaining.length === 0, 'Synthetic concurrency line remains after cleanup.')
      const periodAfter = (await workerJson('/api/nomina/periodos')).payload?.find(row => row.id === period.id)
      assert(periodAfter?.estado === 'abierto', 'Concurrency test changed the synthetic period state.')
    }
  }
}

main().catch(error => {
  console.error(`Staging concurrency test failed: ${error.message}`)
  process.exitCode = 1
})
