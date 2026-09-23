// server/handlers/__tests__/auth-operators.test.js
// F2 — barrera de acceso: no existe ruta sin PIN. El operador activo lo escribe
// handleSwitchOperator tras validar el PIN en el Worker; handleGetCurrentProfile
// solo lo resuelve desde la metadata de la sesión. Nada de esto ocurre en el navegador.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, installFetchMock, readResponse } from './_harness'

const ACCOUNT_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const FINANZAS_ID = '77777777-7777-4777-8777-777777777777'
const NOMINA_ID = '88888888-8888-4888-8888-888888888888'
const VENDEDOR_ID = '66666666-6666-4666-8666-666666666666'

// La sesión la controla cada prueba; verifyAuth nunca valida nada en estos tests.
let sessionUser = { id: ACCOUNT_ID }

vi.mock('../../lib/auth.js', () => ({
  verifyAuth: vi.fn(async () => sessionUser),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
  invalidateOperatorCache: vi.fn(),
}))
vi.mock('../../lib/crypto.js', () => ({ verifyPinPBKDF2: vi.fn(async () => true) }))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../auth-operators.js')
const authMock = await import('../../lib/auth.js')
const cryptoMock = await import('../../lib/crypto.js')
const auditMock = await import('../../lib/audit.js')
let mock

afterEach(() => {
  mock?.restore()
  mock = null
  sessionUser = { id: ACCOUNT_ID }
  vi.clearAllMocks()
})

function switchRequest(body, ip = '10.0.0.20') {
  return new Request('https://worker.test/api/auth/switch-operator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  })
}

const profileRequest = () => new Request('https://worker.test/api/auth/me')
const operatorsRequest = () => new Request('https://worker.test/api/auth/operators')

const operatorRow = (overrides = {}) => ({
  id: ADMIN_ID, nombre: 'Administración', rol: 'jefe', cuenta_id: ACCOUNT_ID, color: '#123456',
  ...overrides,
})

describe('switch-operator — el PIN se valida en el Worker', () => {
  it('rechaza un operador heredado antes de validar el PIN', async () => {
    mock = installFetchMock([{
      match: '/rest/v1/usuarios',
      method: 'GET',
      respond: [operatorRow({ id: VENDEDOR_ID, nombre: 'Logística', rol: 'logistica', pin_hash: 'hash', pin_salt: 'salt' })],
    }])
    const result = await readResponse(await H.handleSwitchOperator(switchRequest({ operator_id: VENDEDOR_ID, pin: '000000' }, '10.0.0.21'), ENV))

    expect(result.status).toBe(403)
    expect(result.body.error).toMatch(/no tiene acceso operativo/i)
    expect(cryptoMock.verifyPinPBKDF2).not.toHaveBeenCalled()
    expect(mock.calls).toHaveLength(1)
  })

  it('valida el PIN en el Worker, escribe la metadata del operador y no expone hashes', async () => {
    mock = installFetchMock([
      { match: '/rest/v1/usuarios', method: 'GET', respond: [operatorRow({ pin_hash: 'hash', pin_salt: 'salt' })] },
      { match: '/auth/v1/admin/users/', method: 'PUT', respond: {} },
    ])
    const result = await readResponse(await H.handleSwitchOperator(switchRequest({ operator_id: ADMIN_ID, pin: '000000' }, '10.0.0.22'), ENV))

    expect(result.status).toBe(200)
    expect(result.body.operator).toMatchObject({ id: ADMIN_ID, rol: 'jefe' })
    expect(result.body.operator).not.toHaveProperty('pin_hash')
    expect(cryptoMock.verifyPinPBKDF2).toHaveBeenCalledWith('000000', 'hash', 'salt')
    expect(authMock.invalidateOperatorCache).toHaveBeenCalledWith(ADMIN_ID)

    const metadataCall = mock.calls.find(call => call.method === 'PUT' && call.url.includes('/auth/v1/admin/users/'))
    expect(metadataCall.body.app_metadata).toMatchObject({ operator_id: ADMIN_ID, operator_rol: 'jefe' })
    expect(JSON.stringify(metadataCall.body)).not.toMatch(/pin_hash|pin_salt|hash|salt/)
    expect(auditMock.registrarAuditoria).toHaveBeenCalledWith(ENV, expect.anything(), expect.objectContaining({ accion: 'LOGIN_EXITOSO' }))
  })

  it('un PIN inválido responde 401, audita el fallo y no escribe metadata', async () => {
    cryptoMock.verifyPinPBKDF2.mockResolvedValueOnce(false)
    mock = installFetchMock([
      { match: '/rest/v1/usuarios', method: 'GET', respond: [operatorRow({ pin_hash: 'hash', pin_salt: 'salt' })] },
    ])
    const result = await readResponse(await H.handleSwitchOperator(switchRequest({ operator_id: ADMIN_ID, pin: '999999' }, '10.0.0.23'), ENV))

    expect(result.status).toBe(401)
    expect(result.body.error).toMatch(/PIN incorrecto/i)
    expect(mock.calls.some(call => call.method === 'PUT')).toBe(false)
    expect(auditMock.registrarAuditoria).toHaveBeenCalledWith(ENV, expect.anything(), expect.objectContaining({ accion: 'LOGIN_FALLIDO' }))
  })

  it('exige el largo de PIN del rol: finanzas rechaza 6 dígitos sin tocar el hash', async () => {
    cryptoMock.verifyPinPBKDF2.mockResolvedValueOnce(true)
    mock = installFetchMock([
      { match: '/rest/v1/usuarios', method: 'GET', respond: [operatorRow({ id: FINANZAS_ID, nombre: 'Finanzas', rol: 'finanzas', pin_hash: 'hash', pin_salt: 'salt' })] },
    ])
    const largo = await readResponse(await H.handleSwitchOperator(switchRequest({ operator_id: FINANZAS_ID, pin: '000000' }), ENV))
    expect(largo.status).toBe(401)
    expect(cryptoMock.verifyPinPBKDF2).not.toHaveBeenCalled()

    mock.restore()
    mock = installFetchMock([
      { match: '/rest/v1/usuarios', method: 'GET', respond: [operatorRow({ id: FINANZAS_ID, nombre: 'Finanzas', rol: 'finanzas', pin_hash: 'hash', pin_salt: 'salt' })] },
      { match: '/auth/v1/admin/users/', method: 'PUT', respond: {} },
    ])
    const ok = await readResponse(await H.handleSwitchOperator(switchRequest({ operator_id: FINANZAS_ID, pin: '4829' }), ENV))
    expect(ok.status).toBe(200)
    expect(cryptoMock.verifyPinPBKDF2).toHaveBeenCalledWith('4829', 'hash', 'salt')
  })

  it('no permite PIN con formato inválido ni operador inexistente', async () => {
    mock = installFetchMock([{ match: '/rest/v1/usuarios', method: 'GET', respond: [] }])
    const malformed = await readResponse(await H.handleSwitchOperator(switchRequest({ operator_id: ADMIN_ID, pin: 'abc' }), ENV))
    expect(malformed.status).toBe(400)
    expect(cryptoMock.verifyPinPBKDF2).not.toHaveBeenCalled()

    mock.restore()
    mock = installFetchMock([{ match: '/rest/v1/usuarios', method: 'GET', respond: [] }])
    const missing = await readResponse(await H.handleSwitchOperator(switchRequest({ operator_id: FINANZAS_ID, pin: '000000' }), ENV))
    expect(missing.status).toBe(404)
    expect(cryptoMock.verifyPinPBKDF2).not.toHaveBeenCalled()
  })
})

describe('handleGetCurrentProfile — resuelve el operador desde la metadata', () => {
  it('cuenta mono-operador: TAMBIÉN exige selección + PIN (sin auto-selección)', async () => {
    mock = installFetchMock([{ match: '/rest/v1/usuarios?activo=eq.true', method: 'GET', respond: [operatorRow()] }])
    const result = await readResponse(await H.handleGetCurrentProfile(profileRequest(), ENV))

    // La barrera F2 vale para todos los roles: sin PIN validado no hay perfil.
    expect(result.status).toBe(403)
    expect(result.body.error).toBe('OPERADOR_REQUERIDO')
    expect(result.body.operators).toHaveLength(1)
    expect(result.body).not.toHaveProperty('profile')
    expect(result.body.operators[0]).not.toHaveProperty('pin_hash')
  })

  it('cuenta multi-operador sin selección: OPERADOR_REQUERIDO con la lista pública', async () => {
    mock = installFetchMock([{
      match: '/rest/v1/usuarios?activo=eq.true',
      method: 'GET',
      respond: [
        operatorRow({ pin_hash: 's1', pin_salt: 's1' }),
        operatorRow({ id: FINANZAS_ID, nombre: 'Finanzas', rol: 'finanzas', pin_hash: 's2', pin_salt: 's2' }),
        operatorRow({ id: VENDEDOR_ID, nombre: 'Vendedor POS', rol: 'vendedor', pin_hash: 's3', pin_salt: 's3' }),
      ],
    }])
    const result = await readResponse(await H.handleGetCurrentProfile(profileRequest(), ENV))

    expect(result.status).toBe(403)
    expect(result.body.error).toBe('OPERADOR_REQUERIDO')
    // Solo roles operativos y nunca hashes.
    expect(result.body.operators.map(op => op.rol).sort()).toEqual(['finanzas', 'jefe'])
    for (const op of result.body.operators) {
      expect(op).not.toHaveProperty('pin_hash')
      expect(op).not.toHaveProperty('pin_salt')
    }
  })

  it('devuelve el perfil del operador ya elegido en la metadata', async () => {
    sessionUser = { id: ACCOUNT_ID, operator_id: FINANZAS_ID, email: 'cuenta@example.invalid' }
    mock = installFetchMock([{
      match: '/rest/v1/usuarios?activo=eq.true',
      method: 'GET',
      respond: [
        operatorRow(),
        operatorRow({ id: FINANZAS_ID, nombre: 'Finanzas', rol: 'finanzas' }),
      ],
    }])
    const result = await readResponse(await H.handleGetCurrentProfile(profileRequest(), ENV))

    expect(result.status).toBe(200)
    expect(result.body.profile).toMatchObject({ id: FINANZAS_ID, rol: 'finanzas', email: 'cuenta@example.invalid' })
  })

  it('una metadata que apunta a un rol heredado no concede perfil', async () => {
    sessionUser = { id: ACCOUNT_ID, operator_id: VENDEDOR_ID }
    mock = installFetchMock([{
      match: '/rest/v1/usuarios?activo=eq.true',
      method: 'GET',
      respond: [
        operatorRow(),
        operatorRow({ id: NOMINA_ID, nombre: 'Nómina', rol: 'nomina' }),
        operatorRow({ id: VENDEDOR_ID, nombre: 'Vendedor POS', rol: 'vendedor' }),
      ],
    }])
    const result = await readResponse(await H.handleGetCurrentProfile(profileRequest(), ENV))

    expect(result.status).toBe(403)
    expect(result.body.error).toBe('OPERADOR_REQUERIDO')
    expect(result.body.operators.map(op => op.rol).sort()).toEqual(['jefe', 'nomina'])
  })

  it('sin usuarios operativos responde 403 y nunca publica nada', async () => {
    mock = installFetchMock([{
      match: '/rest/v1/usuarios?activo=eq.true',
      method: 'GET',
      respond: [operatorRow({ id: VENDEDOR_ID, rol: 'vendedor' })],
    }])
    const result = await readResponse(await H.handleGetCurrentProfile(profileRequest(), ENV))

    expect(result.status).toBe(403)
    expect(result.body).not.toHaveProperty('profile')
    expect(result.body.error).toMatch(/operativo/i)
  })

  it('sin sesión responde 401 antes de consultar usuarios', async () => {
    sessionUser = null
    mock = installFetchMock([])
    const result = await readResponse(await H.handleGetCurrentProfile(profileRequest(), ENV))

    expect(result.status).toBe(401)
    expect(mock.calls).toHaveLength(0)
  })
})

describe('handleGetCurrentProfile — cuenta sin operadores activos', () => {
  it('responde 403 con code SIN_OPERADORES para el arranque desde la pantalla de error', async () => {
    mock = installFetchMock([{
      match: '/rest/v1/usuarios?activo=eq.true',
      method: 'GET',
      respond: [],
    }])
    const result = await readResponse(await H.handleGetCurrentProfile(new Request('https://worker.test/api/auth/me'), ENV))

    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({
      error: 'No hay un usuario operativo configurado',
      code: 'SIN_OPERADORES',
    })
  })
})

describe('handleGetOperators — proyección pública de operadores', () => {
  it('lista todos los roles operativos activos y nunca expone hashes', async () => {
    mock = installFetchMock([{
      match: '/rest/v1/usuarios?activo=eq.true',
      method: 'GET',
      respond: [
        operatorRow({ pin_hash: 'secret', pin_salt: 'secret' }),
        operatorRow({ id: FINANZAS_ID, nombre: 'Cajera Finanzas', rol: 'finanzas', pin_hash: 's2', pin_salt: 's2' }),
        operatorRow({ id: NOMINA_ID, nombre: ' RRHH', rol: 'nomina', pin_hash: 's3', pin_salt: 's3' }),
        operatorRow({ id: VENDEDOR_ID, nombre: 'Vendedor POS', rol: 'vendedor', pin_hash: 's4', pin_salt: 's4' }),
      ],
    }])
    const result = await readResponse(await H.handleGetOperators(operatorsRequest(), ENV))

    expect(result.status).toBe(200)
    expect(result.body.operators.map(op => op.rol).sort()).toEqual(['finanzas', 'jefe', 'nomina'])
    for (const op of result.body.operators) {
      expect(op).not.toHaveProperty('pin_hash')
      expect(op).not.toHaveProperty('pin_salt')
    }
  })
})
