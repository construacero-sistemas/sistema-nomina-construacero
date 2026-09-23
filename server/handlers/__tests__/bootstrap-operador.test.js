// server/handlers/__tests__/bootstrap-operador.test.js
// Arranque de cuenta: cuenta SIN operadores activos → crea el primer usuario
// (rol jefe fijo) autorizado solo con la identidad de la CUENTA. Sin red real y
// sin secretos. La entrada al sistema no ocurre aquí: pasa por switch-operator.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, OPERADORES, installFetchMock, makeRequest, readResponse, expectSinRedReal } from './_harness'

let operadorActual = OPERADORES.administracion

// El bootstrap se autoriza con verifyAuth (identidad de la cuenta), no con
// validateOperator: no puede existir operador con PIN si no hay ninguno.
vi.mock('../../lib/auth.js', async () => {
  const { jsonError } = await import('../../lib/utils.js')
  return {
    validateOperator: vi.fn(async request => ({ error: jsonError('No aplica', 401, request) })),
    verifyAuth: vi.fn(async () => (operadorActual ? {
      id: operadorActual.cuenta_id, email: 'cuenta@test',
    } : null)),
    invalidateOperatorCache: vi.fn(),
    supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
  }
})
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../gestionar-operadores.js')
const auditMock = await import('../../lib/audit.js')

let mock
afterEach(() => {
  mock?.restore()
  mock = null
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

const CUENTA = OPERADORES.administracion.cuenta_id
const FILA_CREADA = {
  id: '99999999-9999-4999-8999-999999999999', nombre: 'María Pérez', rol: 'jefe',
  color: null, activo: true, pin_hash: 'hash-pbkdf2', pin_salt: 'salt-16', creado_en: '2026-09-22',
}

function rutas({ usuarios = [] } = {}) {
  return [
    { match: /\?cuenta_id=/, method: 'GET', respond: usuarios },
    { match: '/rest/v1/usuarios', method: 'POST', respond: [FILA_CREADA] },
  ]
}

function bootstrapRequest(body) {
  return makeRequest(body, { url: 'http://worker.test/api/gestion/operadores/bootstrap' })
}

describe('bootstrap — arranque de cuenta', () => {
  it('sin identidad de cuenta no hay arranque (401) y ni siquiera consulta', async () => {
    operadorActual = null
    mock = installFetchMock(rutas())
    const res = await H.handleBootstrapOperador(bootstrapRequest({ nombre: 'María Pérez', pin: '123456' }), ENV)
    expect((await readResponse(res)).status).toBe(401)
    expect(mock.calls).toHaveLength(0)
    expectSinRedReal(mock.calls)
  })

  it('con operadores activos responde 409 y NO crea nada', async () => {
    mock = installFetchMock(rutas({ usuarios: [{ id: OPERADORES.jefe.id, nombre: 'Jefe Test', rol: 'jefe', activo: true }] }))
    const res = await H.handleBootstrapOperador(bootstrapRequest({ nombre: 'María Pérez', pin: '123456' }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(409)
    expect(body.error).toContain('ya tiene usuarios activos')
    expect(mock.calls.some(call => call.method === 'POST')).toBe(false)
    expectSinRedReal(mock.calls)
  })

  it('sin activos (solo histórico inactivo): crea el jefe con PIN PBKDF2, audita y responde 201', async () => {
    mock = installFetchMock(rutas({ usuarios: [{ id: OPERADORES.vendedor.id, nombre: 'Viejo', rol: 'finanzas', activo: false }] }))
    const res = await H.handleBootstrapOperador(bootstrapRequest({ nombre: 'María Pérez', pin: '123456' }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(201)
    expect(body.usuario).toMatchObject({ nombre: 'María Pérez', rol: 'jefe', tiene_pin: true })
    const post = mock.calls.find(call => call.method === 'POST')
    expect(post.body).toMatchObject({ cuenta_id: CUENTA, nombre: 'María Pérez', rol: 'jefe' })
    expect(post.body.pin_hash).toEqual(expect.any(String))
    expect(post.body.pin_salt).toEqual(expect.any(String))
    expect(auditMock.registrarAuditoria).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({ accion: 'BOOTSTRAP_PRIMER_USUARIO', categoria: 'USUARIOS', usuarioRol: 'jefe', cuentaId: CUENTA }),
    )
    expectSinRedReal(mock.calls)
  })

  it('el primer usuario es siempre jefe: un rol pedido distinto se rechaza (400)', async () => {
    mock = installFetchMock(rutas())
    const res = await H.handleBootstrapOperador(bootstrapRequest({ nombre: 'María Pérez', pin: '1234', rol: 'finanzas' }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(body.error).toContain('debe ser jefe')
    expect(mock.calls.some(call => call.method === 'POST')).toBe(false)
  })

  it('el PIN del jefe es de 6 dígitos: 400 con el largo incorrecto', async () => {
    mock = installFetchMock(rutas())
    const res = await H.handleBootstrapOperador(bootstrapRequest({ nombre: 'María Pérez', pin: '1234' }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(body.error).toBe('El PIN debe ser de 6 dígitos')
  })

  it('respeta el histórico: el nombre de una fila inactiva no se reutiliza (409)', async () => {
    mock = installFetchMock(rutas({ usuarios: [{ id: OPERADORES.vendedor.id, nombre: 'maría pérez', rol: 'finanzas', activo: false }] }))
    const res = await H.handleBootstrapOperador(bootstrapRequest({ nombre: 'María Pérez', pin: '123456' }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(409)
    expect(body.error).toBe('Ya existe un usuario con ese nombre')
  })
})
