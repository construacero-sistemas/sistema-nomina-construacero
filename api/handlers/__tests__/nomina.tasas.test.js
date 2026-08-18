import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion
vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn(async () => authOk(operadorActual)) }))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))
const H = await import('../nomina.js')
let mock
afterEach(() => { mock?.restore(); operadorActual = OPERADORES.administracion; vi.clearAllMocks() })

describe('snapshots de tasas por tenant', () => {
  it('lista snapshots con rango y cuenta', async () => {
    mock = installFetchMock([{ match: '/nomina_tasas_snapshot', respond: [] }])
    const req = makeRequest(undefined, { url: 'http://worker.test/api/nomina/tasas-snapshots?desde=2026-08-01&hasta=2026-08-31' })
    const res = await H.handleGetTasasSnapshots(req, ENV)
    expect((await readResponse(res)).status).toBe(200)
    expect(mock.calls[0].url).toContain(`cuenta_id=eq.${OPERADORES.administracion.cuenta_id}`)
    expect(mock.calls[0].url).toContain('limit=500')
  })

  it('crea snapshot no aprobado para no cerrar con una tasa no validada', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', method: 'GET', respond: [{ id: IDS.periodo }] },
      { match: '/nomina_tasas_snapshot', method: 'POST', respond: [{ id: IDS.registro, aprobado: false }] },
    ])
    const res = await H.handleCrearTasaSnapshot(makeRequest({
      fecha: '2026-08-08', monedaOrigen: 'USD', valor: 100, fuente: 'BCV', periodoId: IDS.periodo,
    }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(201)
    expect(body.requiere_aprobacion).toBe(true)
    const post = mock.calls.find(call => call.method === 'POST' && call.url.includes('/nomina_tasas_snapshot'))
    expect(post.body.aprobado).toBe(false)
  })
})
