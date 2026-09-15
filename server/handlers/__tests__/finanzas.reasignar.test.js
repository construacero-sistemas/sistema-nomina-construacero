import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'
let operadorActual = OPERADORES.administracion, mock
vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn(async () => authOk(operadorActual)), supaServiceHeaders: () => ({}) }))
const { handleReasignarCuentaMovimientos: assign } = await import('../finanzas.js')
afterEach(() => { mock?.restore(); operadorActual = OPERADORES.administracion; vi.clearAllMocks() })
const payload = { ids: [IDS.linea, IDS.linea2], cuentaCustodiaId: IDS.config }
describe('Explicit custody assignment boundary', () => {
  it('uses one atomic RPC with UUID, tenant, actor and complete selection', async () => {
    const result = { ok: true, actualizados: 2, cuentaCustodiaId: IDS.config }
    mock = installFetchMock([{ match: '/rpc/finanzas_asignar_custodia', method: 'POST', respond: result }])
    expect(await readResponse(await assign(makeRequest(payload), ENV))).toEqual({ status: 200, body: result })
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].body).toEqual({ p_cuenta_id: OPERADORES.administracion.cuenta_id, p_operador_id: OPERADORES.administracion.id,
      p_ids: payload.ids, p_custodia_id: IDS.config, p_ip: '127.0.0.1' })
  })
  it.each([
    { ...payload, ids: [] }, { ...payload, ids: ['bad'] }, { ...payload, ids: Array(101).fill(IDS.linea) },
    { ids: [IDS.linea], cuenta_origen: 'Legacy name' }, { ...payload, cuentaCustodiaId: '' },
  ])('rejects invalid selection or legacy name instead of UUID', async body => {
    mock = installFetchMock([])
    expect((await readResponse(await assign(makeRequest(body), ENV))).status).toBe(400)
    expect(mock.calls).toHaveLength(0)
  })
  it.each([['PT409', 409], ['PT404', 404], ['PT422', 422]])('propagates %s without claiming partial success', async (code, status) => {
    mock = installFetchMock([{ match: '/rpc/finanzas_asignar_custodia', respond: { __raw: { code }, ok: false, status } }])
    const result = await readResponse(await assign(makeRequest(payload), ENV))
    expect(result.status).toBe(status); expect(result.body.code).toBe(code); expect(result.body.ok).not.toBe(true)
    expect(mock.calls).toHaveLength(1)
  })
  it('denies non-administrative roles before any read or write', async () => {
    operadorActual = OPERADORES.vendedor; mock = installFetchMock([])
    expect((await readResponse(await assign(makeRequest(payload), ENV))).status).toBe(403)
    expect(mock.calls).toHaveLength(0)
  })
})
