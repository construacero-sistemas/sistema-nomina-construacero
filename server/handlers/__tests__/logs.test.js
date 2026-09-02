// server/handlers/__tests__/logs.test.js
// Endpoint de logging del frontend: tenant fijado por JWT, nunca por el body.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, OPERADORES, installFetchMock, makeRequest, readResponse } from './_harness'

const CUENTA = OPERADORES.administracion.cuenta_id
let usuarioActual = { id: CUENTA }

vi.mock('../../lib/auth.js', () => ({
  verifyAuth: vi.fn(async () => usuarioActual),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
}))

const H = await import('../logs.js')
let mock

afterEach(() => {
  mock?.restore()
  usuarioActual = { id: CUENTA }
  vi.clearAllMocks()
})

describe('logs — POST /api/logs', () => {
  it('rechaza peticiones sin sesión', async () => {
    usuarioActual = null
    mock = installFetchMock([])
    const response = await H.handleCrearLogs(makeRequest({ mensaje: 'boom' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(401)
    expect(mock.calls).toHaveLength(0)
  })

  it('persiste el error en auditoria con la cuenta del JWT', async () => {
    let sent
    mock = installFetchMock([
      { match: '/auditoria', method: 'POST', respond: (url, init) => { sent = JSON.parse(init.body); return [] } },
    ])
    const response = await H.handleCrearLogs(makeRequest({
      mensaje: 'TypeError: x is not a function',
      stack: 'at App (App.jsx:1)',
      categoria: 'FRONTEND',
      meta: { ruta: '/nomina' },
    }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(204)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      cuenta_id: CUENTA,
      categoria: 'FRONTEND',
      accion: 'LOG_ERROR',
      descripcion: 'TypeError: x is not a function',
      entidad_tipo: 'log_cliente',
    })
    expect(sent[0].meta.stack).toBe('at App (App.jsx:1)')
  })

  it('acepta lotes de entradas y descarta las vacías', async () => {
    let sent
    mock = installFetchMock([
      { match: '/auditoria', method: 'POST', respond: (url, init) => { sent = JSON.parse(init.body); return [] } },
    ])
    const response = await H.handleCrearLogs(makeRequest({
      entries: [
        { mensaje: 'fallo uno', nivel: 'warn' },
        { mensaje: '   ' },
        { mensaje: 'fallo dos', nivel: 'info' },
      ],
    }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(204)
    expect(sent.map(row => row.accion)).toEqual(['LOG_WARN', 'LOG_INFO'])
  })

  it('rechaza lotes demasiado grandes y bodies inválidos', async () => {
    mock = installFetchMock([])
    const tooMany = Array.from({ length: 11 }, () => ({ mensaje: 'x' }))
    expect((await readResponse(await H.handleCrearLogs(makeRequest({ entries: tooMany }), ENV))).status).toBe(413)
    expect((await readResponse(await H.handleCrearLogs(makeRequest('__INVALID_JSON__'), ENV))).status).toBe(400)
    expect((await readResponse(await H.handleCrearLogs(makeRequest({ entries: [{ mensaje: ' ' }] }), ENV))).status).toBe(400)
    expect(mock.calls).toHaveLength(0)
  })
})
