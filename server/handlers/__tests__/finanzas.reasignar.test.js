// server/handlers/__tests__/finanzas.reasignar.test.js
// E2E del endpoint bulk de re-asignación de cuenta de custodia. Sin red real.
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

const IDS_MOV = [IDS.linea, IDS.linea2]
const ACC_FILTRO = `cuenta_id=eq.${OPERADORES.administracion.cuenta_id}`

describe('finanzas — reasignación masiva de cuenta', () => {
  it('reasigna un lote de movimientos activos a cuenta_origen y devuelve el total', async () => {
    let patchBody = null
    mock = installFetchMock([
      {
        match: 'finanzas_movimientos?id=in.',
        method: 'PATCH',
        respond: (url, init) => {
          patchBody = JSON.parse(init.body)
          expect(url).toContain(ACC_FILTRO)
          expect(url).toContain('estado=eq.activo')
          return IDS_MOV.map(id => ({ id, cuenta_origen: patchBody.cuenta_origen }))
        },
      },
    ])
    const response = await H.handleReasignarCuentaMovimientos(
      makeRequest({ ids: IDS_MOV, cuenta_origen: 'Banco BNC' }),
      ENV,
    )
    const { status, body } = await readResponse(response)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.actualizados).toBe(2)
    expect(patchBody).toEqual({ cuenta_origen: 'Banco BNC' })
  })

  it('rechaza lotes vacíos y cuenta_origen vacío', async () => {
    mock = installFetchMock([])
    const r1 = await H.handleReasignarCuentaMovimientos(makeRequest({ ids: [], cuenta_origen: 'X' }), ENV)
    expect((await readResponse(r1)).status).toBe(400)
    const r2 = await H.handleReasignarCuentaMovimientos(makeRequest({ ids: [IDS.linea], cuenta_origen: '' }), ENV)
    expect((await readResponse(r2)).status).toBe(400)
  })

  it('rechaza ids con formato inválido', async () => {
    mock = installFetchMock([])
    const response = await H.handleReasignarCuentaMovimientos(
      makeRequest({ ids: ['no-uuid'], cuenta_origen: 'Banco BNC' }),
      ENV,
    )
    expect((await readResponse(response)).status).toBe(400)
  })

  it('rechaza lotes de más de 100 movimientos', async () => {
    mock = installFetchMock([])
    const ids = Array.from({ length: 101 }, (_, i) => `${IDS.linea.slice(0, -1)}${i % 10}`)
    const response = await H.handleReasignarCuentaMovimientos(
      makeRequest({ ids, cuenta_origen: 'Banco BNC' }),
      ENV,
    )
    expect((await readResponse(response)).status).toBe(400)
  })

  it('deniega a roles no administradores', async () => {
    operadorActual = OPERADORES.vendedor
    mock = installFetchMock([])
    const response = await H.handleReasignarCuentaMovimientos(
      makeRequest({ ids: IDS_MOV, cuenta_origen: 'Banco BNC' }),
      ENV,
    )
    expect((await readResponse(response)).status).toBe(403)
  })
})
