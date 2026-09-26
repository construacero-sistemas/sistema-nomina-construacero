// server/handlers/__tests__/nomina.asistencia.lectura.test.js
// F-11: la lectura de asistencia se pagina y avisa si se corta en el techo. Antes
// una sola página de 500 filas dejaba fuera los últimos días de la semana sin
// decirlo (a partir de ~71 empleados).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(OPERADORES.administracion)),
}))

const H = await import('../nomina.js')
const A = await import('../nomina.asistencia.js')
let mock
afterEach(() => { mock?.restore(); vi.clearAllMocks() })

const URL_ASISTENCIA = 'http://worker.test/api/nomina/asistencia?desde=2026-08-01&hasta=2026-08-07'

function fila(indice) {
  return {
    id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-03',
    hora_entrada: '08:00:00', hora_salida: '17:00:00', horas_trabajadas: 8,
    horas_normales: 8, horas_extra: 0, es_ausencia: false, estado_marcaje: 'completo', nota: `fila-${indice}`,
  }
}

describe('lectura paginada de asistencia', () => {
  it('pide una segunda página cuando la primera viene llena', async () => {
    const primera = Array.from({ length: A.ASISTENCIA_POR_PAGINA }, (_, i) => fila(i))
    mock = installFetchMock([
      { match: '/registro_asistencia', respond: (url) => (url.includes('offset=0') ? primera : [fila(600)]) },
    ])
    const { status, body } = await readResponse(await H.handleGetAsistencia(makeRequest(undefined, { url: URL_ASISTENCIA }), ENV))

    expect(status).toBe(200)
    expect(body.registros).toHaveLength(A.ASISTENCIA_POR_PAGINA + 1)
    expect(body.truncado).toBe(false)
    expect(mock.calls).toHaveLength(2)
    // La página es acotada (el guardarraíl de egress no admite pedir mil filas).
    expect(Number(new URL(mock.calls[0].url).searchParams.get('limit'))).toBe(A.ASISTENCIA_POR_PAGINA)
    expect(mock.calls[1].url).toContain(`offset=${A.ASISTENCIA_POR_PAGINA}`)
    // Orden estable para que el offset no repita ni salte filas.
    expect(mock.calls[0].url).toContain('order=fecha.asc,empleado_id.asc')
    expect(mock.calls[0].url).toContain(`cuenta_id=eq.${OPERADORES.administracion.cuenta_id}`)
  })

  it('una sola página deja de pedir y no marca truncado', async () => {
    mock = installFetchMock([{ match: '/registro_asistencia', respond: [fila(1)] }])
    const { status, body } = await readResponse(await H.handleGetAsistencia(makeRequest(undefined, { url: URL_ASISTENCIA }), ENV))
    expect(status).toBe(200)
    expect(body).toMatchObject({ truncado: false })
    expect(body.registros).toHaveLength(1)
    expect(mock.calls).toHaveLength(1)
  })

  it('si se alcanza el techo de paginación, avisa con truncado en vez de mentir con un rango completo', async () => {
    const llena = Array.from({ length: A.ASISTENCIA_POR_PAGINA }, (_, i) => fila(i))
    mock = installFetchMock([{ match: '/registro_asistencia', respond: llena }])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { status, body } = await readResponse(await H.handleGetAsistencia(makeRequest(undefined, { url: URL_ASISTENCIA }), ENV))
    warn.mockRestore()

    expect(status).toBe(200)
    expect(body.truncado).toBe(true)
    expect(body.registros).toHaveLength(A.ASISTENCIA_POR_PAGINA * A.ASISTENCIA_MAX_PAGINAS)
    expect(mock.calls).toHaveLength(A.ASISTENCIA_MAX_PAGINAS)
  })

  it('un error en la segunda página no devuelve media lectura como si fuera todo', async () => {
    const llena = Array.from({ length: A.ASISTENCIA_POR_PAGINA }, (_, i) => fila(i))
    mock = installFetchMock([
      { match: '/registro_asistencia', respond: (url) => (url.includes('offset=0') ? llena : { __raw: { message: 'boom' }, ok: false, status: 500 }) },
    ])
    const { status, body } = await readResponse(await H.handleGetAsistencia(makeRequest(undefined, { url: URL_ASISTENCIA }), ENV))
    expect(status).toBe(500)
    expect(body.error).toMatch(/asistencia/i)
  })
})
