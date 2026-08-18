import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion
vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn(async () => authOk(operadorActual)) }))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))
const H = await import('../nomina.js')
let mock
afterEach(() => { mock?.restore(); operadorActual = OPERADORES.administracion; vi.clearAllMocks() })

describe('conceptos de nómina por tenant', () => {
  it('lista conceptos solo de la cuenta del operador', async () => {
    mock = installFetchMock([{ match: '/nomina_conceptos', respond: [] }])
    const res = await H.handleGetConceptos(makeRequest(), ENV)
    expect((await readResponse(res)).status).toBe(200)
    expect(mock.calls[0].url).toContain(`cuenta_id=eq.${OPERADORES.administracion.cuenta_id}`)
  })

  it('crea un concepto validado y versionable', async () => {
    mock = installFetchMock([{ match: '/nomina_conceptos', method: 'POST', respond: [{ id: IDS.registro }] }])
    const res = await H.handleCrearConcepto(makeRequest({
      codigo: 'BONO_TRANSPORTE', nombre: 'Bono transporte', tipo: 'ingreso',
      monedaDefault: 'VES', fechaDesde: '2026-01-01', imponible: false,
    }), ENV)
    expect((await readResponse(res)).status).toBe(201)
    expect(mock.calls[0].body.cuenta_id).toBe(OPERADORES.administracion.cuenta_id)
  })
})
