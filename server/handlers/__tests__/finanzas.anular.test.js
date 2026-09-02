// server/handlers/__tests__/finanzas.anular.test.js
// E2E del flujo de anulación de movimientos financieros: sin red ni secretos reales.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../finanzas.js')
let mock

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

const activeMovement = {
  id: IDS.linea,
  fecha: '2026-08-18', tipo: 'egreso', categoria: 'Proveedores', concepto: 'Cemento',
  monto: 100, moneda: 'USD', tasa_ves: 120, monto_ves: 12000,
  fuente_tasa: 'MANUAL', estado: 'activo', creado_en: '2026-08-18T12:00:00Z',
}

const anulacionInput = {
  id: IDS.linea,
  motivo: 'Registro duplicado',
  idempotencyKey: 'anulacion-test-000000001',
}

describe('finanzas — anulación de movimientos', () => {
  it('anula un movimiento activo sin borrarlo y registra el motivo', async () => {
    let patch
    mock = installFetchMock([
      { match: `finanzas_movimientos?id=eq.${IDS.linea}`, method: 'GET', respond: [activeMovement] },
      {
        match: `finanzas_movimientos?id=eq.${IDS.linea}`,
        method: 'PATCH',
        respond: (url, init) => {
          patch = JSON.parse(init.body)
          return [{ ...activeMovement, ...patch }]
        },
      },
    ])
    const response = await H.handleAnularFinanzasMovimiento(makeRequest(anulacionInput), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(result.body.idempotente).toBe(false)
    expect(result.body.movimiento.estado).toBe('anulado')
    expect(patch.estado).toBe('anulado')
    expect(patch.motivo_anulacion).toBe('Registro duplicado')
    expect(patch.anulado_por).toBe(OPERADORES.administracion.id)
    expect(mock.calls.some(call => call.method === 'DELETE')).toBe(false)
  })

  it('la segunda anulación del mismo movimiento es idempotente y no escribe de nuevo', async () => {
    const alreadyAnulled = { ...activeMovement, estado: 'anulado', motivo_anulacion: 'Registro duplicado' }
    mock = installFetchMock([
      { match: `finanzas_movimientos?id=eq.${IDS.linea}`, method: 'GET', respond: [alreadyAnulled] },
    ])
    const response = await H.handleAnularFinanzasMovimiento(makeRequest(anulacionInput), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.idempotente).toBe(true)
    expect(result.body.movimiento.estado).toBe('anulado')
    expect(mock.calls.some(call => call.method === 'PATCH')).toBe(false)
  })

  it('rechaza un motivo demasiado corto antes de tocar Supabase', async () => {
    mock = installFetchMock([])
    const response = await H.handleAnularFinanzasMovimiento(
      makeRequest({ ...anulacionInput, motivo: 'no' }),
      ENV,
    )
    const result = await readResponse(response)

    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/motivo/i)
    expect(mock.calls).toHaveLength(0)
  })

  it('rechaza una idempotency key inválida antes de leer el movimiento', async () => {
    mock = installFetchMock([])
    const response = await H.handleAnularFinanzasMovimiento(
      makeRequest({ ...anulacionInput, idempotencyKey: 'corta' }),
      ENV,
    )
    const result = await readResponse(response)

    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/idempotency/i)
    expect(mock.calls).toHaveLength(0)
  })

  it('devuelve 404 cuando el movimiento pertenece a otra cuenta (aislamiento de tenant)', async () => {
    mock = installFetchMock([
      // La lectura está filtrada por cuenta: otra cuenta no ve el movimiento.
      { match: `finanzas_movimientos?id=eq.${IDS.linea}`, method: 'GET', respond: [] },
    ])
    const response = await H.handleAnularFinanzasMovimiento(makeRequest(anulacionInput), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(404)
    expect(mock.calls.some(call => call.method === 'PATCH')).toBe(false)
  })

  it('bloquea la anulación para roles que no son administración', async () => {
    operadorActual = OPERADORES.vendedor
    mock = installFetchMock([])
    const response = await H.handleAnularFinanzasMovimiento(makeRequest(anulacionInput), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(403)
    expect(mock.calls).toHaveLength(0)
  })
})
