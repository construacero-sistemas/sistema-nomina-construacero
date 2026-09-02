// server/handlers/__tests__/nomina.periodos-guardas.test.js
// Guardas de creación de períodos: solapamiento, límite de 31 días, fechas inválidas.
// Sin red ni secretos reales (mismo harness que el resto de la suite).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../nomina.periodos.js')
let mock

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

const existingPeriod = {
  id: IDS.periodo, nombre: 'S1 agosto', desde: '2026-08-01', hasta: '2026-08-07',
  tipo: 'semanal', estado: 'abierto', cuenta_id: OPERADORES.administracion.cuenta_id,
}

describe('nómina — guardas de períodos', () => {
  it('rechaza un período que se solapa con uno existente', async () => {
    mock = installFetchMock([
      { match: 'nomina_periodos?desde=lte.', method: 'GET', respond: [existingPeriod] },
    ])
    const res = await H.handleCrearPeriodo(
      makeRequest({ nombre: 'S2 agosto', desde: '2026-08-05', hasta: '2026-08-12', tipo: 'semanal' }),
      ENV,
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(body.error).toMatch(/solapan/i)
    expect(body.error).toContain('S1 agosto')
  })

  it('rechaza un período mayor a 31 días', async () => {
    mock = installFetchMock([
      { match: 'nomina_periodos?desde=lte.', method: 'GET', respond: [] },
    ])
    const res = await H.handleCrearPeriodo(
      makeRequest({ nombre: 'Trimestre', desde: '2026-08-01', hasta: '2026-11-30', tipo: 'mensual' }),
      ENV,
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(body.error).toMatch(/31 días/i)
  })

  it('rechaza fechas invertidas (hasta < desde)', async () => {
    mock = installFetchMock([])
    const res = await H.handleCrearPeriodo(
      makeRequest({ nombre: 'Invertido', desde: '2026-08-10', hasta: '2026-08-01', tipo: 'semanal' }),
      ENV,
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(body.error).toMatch(/posterior/i)
  })

  it('rechaza fechas con formato inválido', async () => {
    mock = installFetchMock([])
    const res = await H.handleCrearPeriodo(
      makeRequest({ nombre: 'Formato malo', desde: '10/08/2026', hasta: '2026-08-20', tipo: 'semanal' }),
      ENV,
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(body.error).toMatch(/fechas/i)
  })

  it('rechaza nombre vacío o demasiado largo', async () => {
    mock = installFetchMock([])
    const res = await H.handleCrearPeriodo(
      makeRequest({ nombre: '   ', desde: '2026-08-01', hasta: '2026-08-07', tipo: 'semanal' }),
      ENV,
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(body.error).toMatch(/nombre/i)
  })

  it('crea el período con tipo por defecto cuando el tipo es desconocido', async () => {
    let posted
    mock = installFetchMock([
      { match: 'nomina_periodos?desde=lte.', method: 'GET', respond: [] },
      {
        match: 'nomina_periodos',
        method: 'POST',
        respond: (url, init) => {
          posted = JSON.parse(init.body)
          return [{ id: IDS.periodo, ...posted }]
        },
      },
    ])
    const res = await H.handleCrearPeriodo(
      makeRequest({ nombre: 'S3 agosto', desde: '2026-08-15', hasta: '2026-08-21', tipo: 'anual' }),
      ENV,
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(201)
    expect(body.ok).toBe(true)
    expect(posted.tipo).toBe('semanal')
    expect(posted.estado).toBe('abierto')
    expect(posted.cuenta_id).toBe(OPERADORES.administracion.cuenta_id)
  })

  it('un jefe (no admin) no puede crear períodos', async () => {
    operadorActual = OPERADORES.jefe
    mock = installFetchMock([])
    const res = await H.handleCrearPeriodo(
      makeRequest({ nombre: 'S4', desde: '2026-08-15', hasta: '2026-08-21', tipo: 'semanal' }),
      ENV,
    )
    const { status } = await readResponse(res)
    expect(status).toBe(403)
  })
})
