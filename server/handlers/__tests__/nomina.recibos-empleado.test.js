// Mejora del 19/11/2026: recibos de un trabajador desde su ficha (paginado).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ENV, OPERADORES, IDS, makeRequest, readResponse, installFetchMock, authOk } from './_harness'
let operadorActual = OPERADORES.administracion
vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn(async () => authOk(operadorActual)) }))
const H = await import('../nomina.js')
let mock
afterEach(() => { mock?.restore(); vi.clearAllMocks(); operadorActual = OPERADORES.administracion })

const pedir = query => H.handleGetRecibosEmpleado(makeRequest(undefined, { url: `http://worker.test/api/nomina/empleados/recibos?${query}` }), ENV)

describe('recibos de un trabajador', () => {
  it('lee 10 por página, del más reciente al más antiguo, con su período y filtrado por cuenta', async () => {
    const filas = Array.from({ length: 11 }, (_, i) => ({ id: `l-${i}`, total_neto_usd: 50, periodo: { nombre: `S${i}` } }))
    mock = installFetchMock([{ match: '/nomina_lineas', respond: filas }])
    const { status, body } = await readResponse(await pedir(`empleadoId=${IDS.empleado}&pagina=2`))
    expect(status).toBe(200)
    expect(body.recibos).toHaveLength(10)
    expect(body.hayMas).toBe(true)
    expect(body.pagina).toBe(2)
    const url = decodeURIComponent(mock.calls[0].url)
    expect(url).toContain(`empleado_id=eq.${IDS.empleado}`)
    expect(url).toContain(`cuenta_id=eq.${OPERADORES.administracion.cuenta_id}`)
    expect(url).toContain('order=periodo(desde).desc')
    expect(url).toContain('limit=11')
    expect(url).toContain('offset=10')
    expect(url).toContain('periodo:nomina_periodos!periodo_id(')
  })

  it('rechaza un empleadoId inválido sin consultar la base', async () => {
    mock = installFetchMock([])
    const { status } = await readResponse(await pedir('empleadoId=abc'))
    expect(status).toBe(400)
    expect(mock.calls).toHaveLength(0)
  })
})
