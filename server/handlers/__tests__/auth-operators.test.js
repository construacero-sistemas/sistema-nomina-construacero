// server/handlers/__tests__/auth-operators.test.js
// El PIN y el rol se verifican dentro del Worker; nunca en el navegador.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, installFetchMock, readResponse } from './_harness'

const ACCOUNT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const OPERATOR_ID = '11111111-1111-4111-8111-111111111111'

vi.mock('../../lib/auth.js', () => ({
  verifyAuth: vi.fn(async () => ({ id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' })),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
  invalidateOperatorCache: vi.fn(),
}))
vi.mock('../../lib/crypto.js', () => ({ verifyPinPBKDF2: vi.fn(async () => true) }))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../auth-operators.js')
const authMock = await import('../../lib/auth.js')
const cryptoMock = await import('../../lib/crypto.js')
let mock

afterEach(() => {
  mock?.restore()
  mock = null
  vi.clearAllMocks()
})

function request(body, ip) {
  return new Request('https://worker.test/api/auth/switch-operator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  })
}

describe('auth operadores — rol único y PIN server-side', () => {
  it('lista únicamente administración y nunca expone hashes', async () => {
    mock = installFetchMock([{
      match: '/rest/v1/usuarios?activo=eq.true&rol=eq.administracion',
      method: 'GET',
      respond: [{ id: OPERATOR_ID, nombre: 'Administración', rol: 'administracion', pin_hash: 'secret', pin_salt: 'secret' }],
    }])
    const response = await H.handleGetOperators(new Request('https://worker.test/api/auth/operators'), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.operators[0]).toMatchObject({ id: OPERATOR_ID, rol: 'administracion' })
    expect(result.body.operators[0]).not.toHaveProperty('pin_hash')
    expect(result.body.operators[0]).not.toHaveProperty('pin_salt')
    expect(mock.calls[0].url).toContain('rol=eq.administracion')
  })

  it('rechaza un operador heredado antes de validar el PIN', async () => {
    mock = installFetchMock([{
      match: '/rest/v1/usuarios',
      method: 'GET',
      respond: [{ id: OPERATOR_ID, nombre: 'Logística', rol: 'logistica', pin_hash: 'hash', pin_salt: 'salt' }],
    }])
    const response = await H.handleSwitchOperator(request({ operator_id: OPERATOR_ID, pin: '000000' }, '10.0.0.21'), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(403)
    expect(result.body.error).toMatch(/administración/i)
    expect(cryptoMock.verifyPinPBKDF2).not.toHaveBeenCalled()
    expect(mock.calls).toHaveLength(1)
  })

  it('valida el PIN de administración en el Worker y devuelve una proyección pública', async () => {
    mock = installFetchMock([
      {
        match: '/rest/v1/usuarios',
        method: 'GET',
        respond: [{
          id: OPERATOR_ID, nombre: 'Administración', rol: 'administracion', cuenta_id: ACCOUNT_ID,
          pin_hash: 'hash', pin_salt: 'salt', color: '#123456',
        }],
      },
      { match: '/auth/v1/admin/users/', method: 'PUT', respond: {} },
    ])
    const response = await H.handleSwitchOperator(request({ operator_id: OPERATOR_ID, pin: '000000' }, '10.0.0.22'), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.operator).toMatchObject({ id: OPERATOR_ID, rol: 'administracion' })
    expect(result.body.operator).not.toHaveProperty('pin_hash')
    expect(cryptoMock.verifyPinPBKDF2).toHaveBeenCalledWith('000000', 'hash', 'salt')
    expect(authMock.invalidateOperatorCache).toHaveBeenCalledWith(OPERATOR_ID)
  })
})
