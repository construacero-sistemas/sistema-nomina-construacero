// server/handlers/__tests__/gestionar-operadores.test.js
// E2E del panel de gestión de usuarios: autorización, creación con PIN PBKDF2,
// máximo por rol, activar/desactivar, cambiar PIN, rol y nombre. Sin red ni secretos.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion

// Los handlers de gestión usan validateOperator (auth + operador de la BD).
vi.mock('../../lib/auth.js', async () => {
  const { jsonError } = await import('../../lib/utils.js')
  const { authOk: ok } = await import('./_harness')
  return {
    validateOperator: vi.fn(async request => (operadorActual ? ok(operadorActual) : { error: jsonError('No autenticado', 401, request) })),
    verifyAuth: vi.fn(async () => (operadorActual ? {
      id: operadorActual.cuenta_id, email: 'cuenta@test',
      operator_id: operadorActual.id, operator_rol: operadorActual.rol,
    } : null)),
    invalidateOperatorCache: vi.fn(),
    supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
  }
})
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../gestionar-operadores.js')
let mock

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

function authHeaders() {
  return { headers: { get: () => 'test' } }
}

// makeRequest del harness es POST por defecto; los GET necesitan url+method propios.
function getRequest(url = 'http://worker.test/api/gestion/operadores') {
  const req = makeRequest()
  return { ...req, url, method: 'GET' }
}

describe('gestionar-operadores — autorización', () => {
  it('rechaza sin sesión (401)', async () => {
    operadorActual = null
    mock = installFetchMock([])
    const response = await H.handleListarOperadores(getRequest(), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(401)
  })

  it('rechaza a un rol sin capacidad de gestionar usuarios (403) — finanzas y nomina', async () => {
    // authOk devuelve { user, operador }: verifyAuth debe exponer el operador
    // con su rol para que requireCapacidad lo evalúe.
    for (const rol of ['finanzas', 'nomina']) {
      operadorActual = { ...OPERADORES.finanzas, rol }
      mock = installFetchMock([])
      const response = await H.handleListarOperadores(getRequest(), ENV)
      const result = await readResponse(response)
      expect(result.status).toBe(403)
      expect(mock.calls).toHaveLength(0)
    }
  })
})

describe('gestionar-operadores — crear', () => {
  it('crea usuario con PIN hasheado (nunca texto plano) y audita', async () => {
    // El jefe autenticado gestiona: su operator_rol es 'jefe'.
    operadorActual = { ...OPERADORES.jefe, id: OPERADORES.jefe.id }
    let savedBody = null
    mock = installFetchMock([
      {
        match: '/usuarios', method: 'GET',
        respond: () => [], // sin existentes
      },
      {
        match: '/usuarios', method: 'POST',
        respond: (_url, init) => {
          savedBody = JSON.parse(init.body)
          return [{ id: '19999999-9999-4999-8999-999999999901', nombre: 'María Pérez', rol: 'finanzas', activo: true, pin_hash: savedBody.pin_hash, pin_salt: savedBody.pin_salt }]
        },
      },
    ])
    // finanzas usa PIN de 4 dígitos (matriz única: longitudPin).
    const response = await H.handleCrearOperador(
      makeRequest({ nombre: 'María Pérez', rol: 'finanzas', pin: '4829' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(201)
    expect(result.body.usuario.nombre).toBe('María Pérez')
    expect(result.body.usuario.tiene_pin).toBe(true)
    // El PIN jamás viaja al servicio: solo hash (64 hex) + salt, sin campo pin.
    expect(savedBody.pin_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(savedBody.pin_salt).toHaveLength(32)
    expect(JSON.stringify(savedBody)).not.toMatch(/"pin"\s*:/)
  })

  it('rechaza PIN con largo distinto al del rol o no numérico (finanzas: 4)', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([])
    // 5, 6 y 8 dígitos, letras y vacío: todo inválido para un rol de PIN de 4.
    for (const pin of ['123', '12345', '123456', '12345678', 'abcdef', null]) {
      const response = await H.handleCrearOperador(makeRequest({ nombre: 'X Y Z', rol: 'finanzas', pin }), ENV)
      const result = await readResponse(response)
      expect(result.status).toBe(400)
    }
    expect(mock.calls).toHaveLength(0)
  })

  it('exige PIN de 6 para jefe y nombra el largo correcto en el error', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([])
    const response = await H.handleCrearOperador(makeRequest({ nombre: 'X Y Z', rol: 'jefe', pin: '4829' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(400)
    expect(result.body.error).toBe('El PIN debe ser de 6 dígitos')

    mock.restore()
    const nomina = await H.handleCrearOperador(makeRequest({ nombre: 'X Y Z', rol: 'nomina', pin: '482915' }), ENV)
    const nominaResult = await readResponse(nomina)
    expect(nominaResult.status).toBe(400)
    expect(nominaResult.body.error).toBe('El PIN debe ser de 4 dígitos')
  })

  it('rechaza rol no asignable (desarrollador no se crea desde UI)', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([])
    const response = await H.handleCrearOperador(makeRequest({ nombre: 'X Y Z', rol: 'desarrollador', pin: '123456' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(400)
  })

  it('rechaza administracion: el rol histórico está oculto del selector', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([])
    const crear = await H.handleCrearOperador(makeRequest({ nombre: 'X Y Z', rol: 'administracion', pin: '123456' }), ENV)
    expect((await readResponse(crear)).status).toBe(400)
    const cambiar = await H.handleCambiarRolOperador(makeRequest({ id: OPERADORES.finanzas.id, rol: 'administracion' }), ENV)
    expect((await readResponse(cambiar)).status).toBe(400)
    expect(mock.calls).toHaveLength(0)
  })

  it('respeta el máximo de activos por rol (finanzas: 1)', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([
      {
        match: '/usuarios', method: 'GET',
        respond: () => [{ id: 'u1', nombre: 'Otro Finanzas', rol: 'finanzas', activo: true, pin_hash: 'x' }],
      },
    ])
    const response = await H.handleCrearOperador(makeRequest({ nombre: 'Segundo Finanzas', rol: 'finanzas', pin: '4829' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(409)
    expect(result.body.error).toMatch(/máximo/i)
  })

  it('rechaza nombre duplicado (case-insensitive)', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([
      {
        match: '/usuarios', method: 'GET',
        respond: () => [{ id: 'u1', nombre: 'maría pérez', rol: 'nomina', activo: true, pin_hash: 'x' }],
      },
    ])
    const response = await H.handleCrearOperador(makeRequest({ nombre: 'María Pérez', rol: 'finanzas', pin: '4829' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(409)
    expect(result.body.error).toMatch(/nombre/i)
  })
})

describe('gestionar-operadores — estado / pin / rol', () => {
  const usuario = { id: '19999999-9999-4999-8999-999999999901', nombre: 'María Pérez', rol: 'finanzas', activo: true, pin_hash: 'x' }

  it('desactiva y reactiva (idempotente si ya está en ese estado)', async () => {
    operadorActual = { ...OPERADORES.jefe }
    // Estado simulado: el PATCH actualiza lo que el GET devuelve después.
    let activo = true
    mock = installFetchMock([
      { match: '/usuarios', method: 'GET', respond: () => [{ ...usuario, activo }] },
      { match: '/usuarios', method: 'PATCH', respond: (_url, init) => { activo = JSON.parse(init.body).activo; return [] } },
    ])
    const off = await H.handleCambiarEstadoOperador(makeRequest({ id: usuario.id, activo: false }), ENV)
    expect((await readResponse(off)).status).toBe(200)

    const again = await H.handleCambiarEstadoOperador(makeRequest({ id: usuario.id, activo: false }), ENV)
    const againBody = await readResponse(again)
    expect(againBody.status).toBe(200)
    expect(againBody.body.idempotente).toBe(true)
  })

  it('no permite desactivar el propio usuario (evita quedarse sin operador activo)', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([]) // el guard rechaza antes de tocar la BD
    const res = await H.handleCambiarEstadoOperador(makeRequest({ id: OPERADORES.jefe.id, activo: false }), ENV)
    const body = await readResponse(res)
    expect(body.status).toBe(409)
  })

  it('al reactivar respeta el máximo por rol', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([
      { match: '/usuarios', method: 'GET', respond: () => [
        { ...usuario, activo: false },
        { id: '19999999-9999-4999-8999-999999999902', nombre: 'Otro Finanzas', rol: 'finanzas', activo: true, pin_hash: 'x' },
      ] },
    ])
    const response = await H.handleCambiarEstadoOperador(makeRequest({ id: usuario.id, activo: true }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(409)
  })

  it('restablece PIN con nuevo salt y largo del rol del usuario (finanzas: 4)', async () => {
    operadorActual = { ...OPERADORES.jefe }
    let savedBody = null
    mock = installFetchMock([
      { match: '/usuarios', method: 'GET', respond: () => [usuario] },
      { match: '/usuarios', method: 'PATCH', respond: (_url, init) => { savedBody = JSON.parse(init.body); return [] } },
    ])
    const response = await H.handleCambiarPinOperador(makeRequest({ id: usuario.id, pin: '4821' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(savedBody.pin_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(savedBody.pin_salt).toHaveLength(32)
  })

  it('valida el largo del PIN contra el rol del usuario destino', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([{ match: '/usuarios', method: 'GET', respond: () => [usuario] }])
    const response = await H.handleCambiarPinOperador(makeRequest({ id: usuario.id, pin: '654321' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(400)
    expect(result.body.error).toBe('El PIN debe ser de 4 dígitos')
  })

  it('no cambia PIN de un usuario inactivo', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([
      { match: '/usuarios', method: 'GET', respond: () => [{ ...usuario, activo: false }] },
    ])
    const response = await H.handleCambiarPinOperador(makeRequest({ id: usuario.id, pin: '4821' }), ENV)
    expect((await readResponse(response)).status).toBe(400)
  })

  it('cambia rol y audita la transición (finanzas → nomina)', async () => {
    operadorActual = { ...OPERADORES.jefe }
    let savedBody = null
    mock = installFetchMock([
      { match: '/usuarios', method: 'GET', respond: () => [usuario] },
      { match: '/usuarios', method: 'PATCH', respond: (_url, init) => { savedBody = JSON.parse(init.body); return [] } },
    ])
    const response = await H.handleCambiarRolOperador(makeRequest({ id: usuario.id, rol: 'nomina' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(savedBody.rol).toBe('nomina')
  })

  it('rechaza id inválido sin tocar la BD', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([])
    const response = await H.handleCambiarEstadoOperador(makeRequest({ id: 'no-uuid', activo: false }), ENV)
    expect((await readResponse(response)).status).toBe(400)
    expect(mock.calls).toHaveLength(0)
  })
})

describe('gestionar-operadores — nombre', () => {
  const usuario = { id: '19999999-9999-4999-8999-999999999901', nombre: 'María Pérez', rol: 'finanzas', activo: true, pin_hash: 'x' }

  it('renombra y audita la transición con nombre anterior y nuevo', async () => {
    operadorActual = { ...OPERADORES.jefe }
    const { registrarAuditoria } = await import('../../lib/audit.js')
    let savedBody = null
    mock = installFetchMock([
      { match: '/usuarios', method: 'GET', respond: () => [usuario] },
      { match: '/usuarios', method: 'PATCH', respond: (_url, init) => { savedBody = JSON.parse(init.body); return [] } },
    ])
    const response = await H.handleCambiarNombreOperador(makeRequest({ id: usuario.id, nombre: 'María P. Rojas' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(result.body.nombre).toBe('María P. Rojas')
    // Solo viaja el nombre: jamás PIN, rol ni activo.
    expect(savedBody).toEqual({ nombre: 'María P. Rojas' })
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.anything(), expect.anything(),
      expect.objectContaining({
        categoria: 'USUARIOS',
        accion: 'USUARIO_NOMBRE_CAMBIADO',
        descripcion: 'Nombre: María Pérez → María P. Rojas',
        meta: { rol: 'finanzas', nombreAnterior: 'María Pérez', nombreNuevo: 'María P. Rojas' },
      }),
    )
  })

  it('rechaza nombre duplicado del histórico (case-insensitive, incluye inactivos)', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([
      { match: '/usuarios', method: 'GET', respond: () => [
        usuario,
        { id: '19999999-9999-4999-8999-999999999902', nombre: 'juan lópez', rol: 'nomina', activo: false, pin_hash: 'x' },
      ] },
    ])
    const response = await H.handleCambiarNombreOperador(makeRequest({ id: usuario.id, nombre: 'Juan López' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(409)
    expect(result.body.error).toMatch(/nombre/i)
  })

  it('valida longitud del nombre (3–60) e id sin tocar la BD', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([])
    for (const nombre of ['Ab', 'x'.repeat(61), '   ', null, 42]) {
      const response = await H.handleCambiarNombreOperador(makeRequest({ id: usuario.id, nombre }), ENV)
      expect((await readResponse(response)).status).toBe(400)
    }
    const badId = await H.handleCambiarNombreOperador(makeRequest({ id: 'no-uuid', nombre: 'Nombre Válido' }), ENV)
    expect((await readResponse(badId)).status).toBe(400)
    expect(mock.calls).toHaveLength(0)
  })

  it('es idempotente si el nombre no cambia (sin PATCH)', async () => {
    operadorActual = { ...OPERADORES.jefe }
    let patched = false
    mock = installFetchMock([
      { match: '/usuarios', method: 'GET', respond: () => [usuario] },
      { match: '/usuarios', method: 'PATCH', respond: () => { patched = true; return [] } },
    ])
    const response = await H.handleCambiarNombreOperador(makeRequest({ id: usuario.id, nombre: 'María Pérez' }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(result.body.idempotente).toBe(true)
    expect(patched).toBe(false)
  })

  it('permite renombrar un usuario inactivo para liberar su nombre', async () => {
    operadorActual = { ...OPERADORES.jefe }
    let savedBody = null
    mock = installFetchMock([
      { match: '/usuarios', method: 'GET', respond: () => [{ ...usuario, activo: false }] },
      { match: '/usuarios', method: 'PATCH', respond: (_url, init) => { savedBody = JSON.parse(init.body); return [] } },
    ])
    const response = await H.handleCambiarNombreOperador(makeRequest({ id: usuario.id, nombre: 'Histórico 2025' }), ENV)
    expect((await readResponse(response)).status).toBe(200)
    expect(savedBody).toEqual({ nombre: 'Histórico 2025' })
  })
})

describe('gestionar-operadores — listar', () => {
  it('lista activos e inactivos sin exponer pin_hash ni pin_salt', async () => {
    operadorActual = { ...OPERADORES.jefe }
    mock = installFetchMock([
      {
        match: '/usuarios', method: 'GET',
        respond: (url) => {
          expect(String(url)).not.toContain('activo=eq.true') // incluye inactivos
          return [
            { id: '19999999-9999-4999-8999-999999999901', nombre: 'A', rol: 'jefe', activo: true, pin_hash: 'h1', pin_salt: 's1' },
            { id: '19999999-9999-4999-8999-999999999902', nombre: 'B', rol: 'finanzas', activo: false, pin_hash: 'h2', pin_salt: 's2' },
          ]
        },
      },
    ])
    const response = await H.handleListarOperadores(getRequest(), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(result.body.usuarios).toHaveLength(2)
    for (const u of result.body.usuarios) {
      expect(u).not.toHaveProperty('pin_hash')
      expect(u).not.toHaveProperty('pin_salt')
      expect(u).toHaveProperty('tiene_pin')
    }
  })
})

describe('gestionar-operadores — sesión operativa (auth-operators)', () => {
  it('acepta los roles operativos nuevos al hacer login con PIN', async () => {
    const A = await import('../auth-operators.js')
    const crypto = await import('../../lib/crypto.js')
    // PIN real verificado con el PBKDF2 genuino: hash correcto para '4829' + salt
    // (finanzas usa PIN de 4 dígitos según la matriz única).
    const salt = '0123456789abcdef0123456789abcdef'
    const hash = await crypto.hashPinPBKDF2('4829', salt)
    operadorActual = { ...OPERADORES.finanzas }

    // handleSwitchOperator usa verifyAuth para la cuenta y loadOperator (fetch)
    // para el operador. El PUT a auth/v1 graba la metadata del operador.
    mock = installFetchMock([
      {
        match: '/usuarios', method: 'GET',
        respond: () => [{ id: operadorActual.id, nombre: 'Fin', rol: 'finanzas', activo: true, pin_hash: hash, pin_salt: salt }],
      },
      {
        match: '/auth/v1/admin/users', method: 'PUT',
        respond: () => ({ id: operadorActual.cuenta_id }),
      },
    ])
    const response = await A.handleSwitchOperator(
      makeRequest({ operator_id: operadorActual.id, pin: '4829' }), ENV)
    const result = await readResponse(response)
    // El rol finanzas ya NO es rechazado por el guard de roles.
    expect(result.status).toBe(200)
    expect(result.body.operator.rol).toBe('finanzas')
  }, 15000)
})
