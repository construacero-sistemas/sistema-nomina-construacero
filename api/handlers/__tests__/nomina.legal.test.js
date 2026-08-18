import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion
vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn(async () => authOk(operadorActual)) }))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))
const H = await import('../nomina.js')
let mock
afterEach(() => { mock?.restore(); operadorActual = OPERADORES.administracion; vi.clearAllMocks() })

describe('reglas legales por tenant', () => {
  it('lista reglas sin permitir acceso cruzado', async () => {
    mock = installFetchMock([{ match: '/nomina_reglas_legal', respond: [] }])
    const res = await H.handleGetReglasLegales(makeRequest(), ENV)
    expect((await readResponse(res)).status).toBe(200)
    expect(mock.calls[0].url).toContain(`cuenta_id=eq.${OPERADORES.administracion.cuenta_id}`)
  })

  it('crea la regla inactiva y exige aprobación posterior', async () => {
    mock = installFetchMock([{ match: '/nomina_reglas_legal', method: 'POST', respond: [{ id: IDS.registro, activo: false }] }])
    const res = await H.handleCrearReglaLegal(makeRequest({
      codigo: 'FAOV', nombre: 'Aporte vivienda', tipo: 'porcentaje', unidad: 'porcentaje', valor: 3,
      fechaDesde: '2026-01-01', version: '2026.1', fuente: 'pendiente de validación',
    }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(201)
    expect(body.requiere_aprobacion).toBe(true)
    expect(mock.calls[0].body.activo).toBe(false)
  })
})
