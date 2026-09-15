// Handler/RPC contract tests only. Database effects are verified by scripts/test-db.mjs.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'
import { registrarAuditoria } from '../../lib/audit.js'

let operadorActual = OPERADORES.administracion
vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn(async () => authOk(operadorActual)) }))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))
const H = await import('../nomina.lineas.js')
let mock

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

const payment = {
  operationId: IDS.registro, lineaIds: [IDS.linea], cuentaCustodiaId: IDS.config,
  tasaBcv: '400', tasaUsdVes: '400', fuenteTasa: 'BCV', metodoPago: 'Efectivo $', referencia: 'REC-001',
}
const reversal = { operationId: IDS.empleado2, lineaId: IDS.linea, motivo: 'Incorrect payment' }
function confirmed(tipo, clave, resultado, operationId = IDS.periodo) {
  return { ok: true, estado: 'confirmada', operationId, idempotencyKey: clave, tipo, resultado, ...resultado }
}
function rpc(respond) {
  return { match: '/rpc/finanzas_operar', method: 'POST', respond }
}

function expectSingleRpc(tipo, clave) {
  expect(mock.calls).toHaveLength(1)
  expect(mock.calls[0]).toMatchObject({ method: 'POST', body: {
    p_cuenta_id: OPERADORES.administracion.cuenta_id, p_operador_id: OPERADORES.administracion.id,
    p_tipo: tipo, p_clave: clave, p_ip: '127.0.0.1',
  } })
  expect(mock.calls[0].url).toBe(`${ENV.SUPABASE_URL}/rest/v1/rpc/finanzas_operar`)
  expect(registrarAuditoria).not.toHaveBeenCalled()
}

describe('payroll finance atomic RPC contract', () => {
  it('forwards the full settlement snapshot and returns confirmed assignment links', async () => {
    const result = confirmed('pagar_nomina', payment.operationId, {
      recibos_pagados: 1, total_usd: '450.000000', asignacionIds: [IDS.empleado], movimientoIds: [IDS.linea2],
    })
    mock = installFetchMock([rpc(result)])
    const response = await readResponse(await H.handlePagarLineas(makeRequest(payment), ENV))
    expect(response).toEqual({ status: 200, body: result })
    expectSingleRpc('pagar_nomina', payment.operationId)
    expect(mock.calls[0].body.p_payload).toEqual({
      lineaIds: [IDS.linea], cuentaCustodiaId: IDS.config, tasaBcv: '400', tasaUsdVes: '400',
      fuenteTasa: 'BCV', metodoPago: 'Efectivo $', referencia: 'REC-001', observacionTasa: null,
      zonaHoraria: 'America/Caracas',
    })
    expect(mock.calls[0].headers.Authorization).toBe(`Bearer ${ENV.SUPABASE_SERVICE_KEY}`)
  })

  it('accepts a confirmed zero-value receipt assignment without inventing a ledger entry', async () => {
    const result = confirmed('pagar_nomina', payment.operationId, {
      recibos_pagados: 1, total_usd: '0.000000', asignacionIds: [IDS.empleado], movimientoIds: [],
    })
    mock = installFetchMock([rpc(result)])
    expect(await readResponse(await H.handlePagarLineas(makeRequest(payment), ENV))).toEqual({ status: 200, body: result })
    expectSingleRpc('pagar_nomina', payment.operationId)
    expect(mock.calls[0].body.p_payload).not.toHaveProperty('total_usd')
  })

  it('reverses exactly the selected receipt through its explicit relation', async () => {
    const result = confirmed('revertir_nomina', reversal.operationId, {
      lineaId: IDS.linea, asignacionId: IDS.empleado, movimientoId: IDS.linea2, total_usd: '450.000000', reversionContable: true,
    })
    mock = installFetchMock([rpc(result)])
    expect(await readResponse(await H.handleRevertirPagoLinea(makeRequest(reversal), ENV))).toEqual({ status: 200, body: result })
    expectSingleRpc('revertir_nomina', reversal.operationId)
    expect(mock.calls[0].body.p_payload).toEqual({ lineaId: IDS.linea, motivo: reversal.motivo, zonaHoraria: 'America/Caracas' })
  })

  it.each([
    ['unpaid receipt', 'PT409', 409],
    ['legacy receipt without an assignment', 'PT422', 422],
    ['receipt from another tenant', 'PT404', 404],
  ])('propagates the RPC rejection for %s without independent writes', async (_scenario, code, status) => {
    mock = installFetchMock([rpc({ __raw: { code, message: 'Private SQL detail' }, ok: false, status })])
    const result = await readResponse(await H.handleRevertirPagoLinea(makeRequest(reversal), ENV))
    expect(result.status).toBe(status)
    expect(result.body).toMatchObject({ code })
    expect(result.body).not.toHaveProperty('ok', true)
    expect(result.body.error).not.toContain('Private SQL detail')
    expectSingleRpc('revertir_nomina', reversal.operationId)
  })

  it('returns the stored replay result for the same normalized request without additional writes', async () => {
    const result = confirmed('pagar_nomina', payment.operationId, { recibos_pagados: 1, total_usd: '450.000000' })
    mock = installFetchMock([rpc(result)])
    const first = await readResponse(await H.handlePagarLineas(makeRequest(payment), ENV))
    const replay = await readResponse(await H.handlePagarLineas(makeRequest({ ...payment, tasaBcv: '400.00000000', lineaIds: [IDS.linea, IDS.linea] }), ENV))
    expect(first).toEqual({ status: 200, body: result })
    expect(replay).toEqual(first)
    expect(mock.calls).toHaveLength(2)
    expect(mock.calls[0].body).toEqual(mock.calls[1].body)
    expect(mock.calls.every(call => call.url.endsWith('/rpc/finanzas_operar') && call.method === 'POST')).toBe(true)
    expect(registrarAuditoria).not.toHaveBeenCalled()
  })

  it.each(['PGRST202', '42P01'])('fails closed for missing financial capability %s', async code => {
    mock = installFetchMock([rpc({ __raw: { code }, ok: false, status: 404 })])
    const result = await readResponse(await H.handlePagarLineas(makeRequest(payment), ENV))
    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({ code: 'FINANCIAL_UPDATE_REQUIRED' })
    expectSingleRpc('pagar_nomina', payment.operationId)
  })

  it('reports unknown outcome after connection loss without retrying or falling back', async () => {
    mock = installFetchMock([rpc(() => { throw new Error('Connection lost after request') })])
    const result = await readResponse(await H.handlePagarLineas(makeRequest(payment), ENV))
    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({ code: 'OPERATION_RESULT_UNKNOWN' })
    expectSingleRpc('pagar_nomina', payment.operationId)
  })
})
