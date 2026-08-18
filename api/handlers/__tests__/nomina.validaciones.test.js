// api/handlers/__tests__/nomina.validaciones.test.js
// Validación de entrada de los endpoints de nómina (UUIDs, fechas, montos, body).
// Todo contra fetch mockeado: sin red.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { ENV, OPERADORES, IDS, makeRequest, readResponse, installFetchMock, authOk } from './_harness'

let operadorActual = OPERADORES.administracion

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
}))
vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(async () => {}),
}))

const H = await import('../nomina.js')

let mock
afterEach(() => { mock?.restore(); vi.clearAllMocks(); operadorActual = OPERADORES.administracion })

// ─── Body malformado ─────────────────────────────────────────────────────────

describe('body inválido', () => {
  const conBody = [
    'handleCrearConfigEmpleado', 'handleActualizarConfigEmpleado',
    'handleRegistrarAsistencia', 'handleRegistrarAsistenciaMasivo',
    'handleEliminarAsistencia', 'handleCrearPeriodo', 'handleCalcularPeriodo',
    'handleCerrarPeriodo', 'handleReabrirPeriodo', 'handleAjustarLinea',
    'handlePagarLineas', 'handleRevertirPagoLinea',
  ]

  for (const fn of conBody) {
    it(`${fn} devuelve 400 si el JSON no parsea`, async () => {
      mock = installFetchMock([])
      const res = await H[fn](makeRequest('__INVALID_JSON__'), ENV)
      const { status, body } = await readResponse(res)
      expect(status).toBe(400)
      expect(String(body.error)).toMatch(/body inválido/i)
    })
  }
})

// ─── UUIDs ───────────────────────────────────────────────────────────────────

describe('validación de UUID', () => {
  const casos = [
    { fn: 'handleCrearConfigEmpleado',      body: { empleadoId: IDS.invalido, salarioDiaUsd: 30 }, campo: /empleadoId/i },
    { fn: 'handleActualizarConfigEmpleado', body: { id: IDS.invalido },                            campo: /id/i },
    { fn: 'handleRegistrarAsistencia',      body: { empleadoId: IDS.invalido, fecha: '2026-08-03' }, campo: /empleadoId/i },
    { fn: 'handleEliminarAsistencia',       body: { id: IDS.invalido },                            campo: /id/i },
    { fn: 'handleCalcularPeriodo',          body: { periodoId: IDS.invalido },                     campo: /periodoId/i },
    { fn: 'handleCerrarPeriodo',            body: { periodoId: IDS.invalido },                     campo: /periodoId/i },
    { fn: 'handleReabrirPeriodo',           body: { periodoId: IDS.invalido },                     campo: /periodoId/i },
    { fn: 'handleAjustarLinea',             body: { lineaId: IDS.invalido },                       campo: /lineaId/i },
    { fn: 'handleRevertirPagoLinea',        body: { lineaId: IDS.invalido },                       campo: /lineaId/i },
  ]

  for (const c of casos) {
    it(`${c.fn} rechaza UUID malformado`, async () => {
      mock = installFetchMock([])
      const res = await H[c.fn](makeRequest(c.body), ENV)
      const { status, body } = await readResponse(res)
      expect(status).toBe(400)
      expect(String(body.error)).toMatch(c.campo)
      expect(mock.calls).toHaveLength(0)
    })
  }

  it('handleGetLineas rechaza periodoId inválido en query string', async () => {
    mock = installFetchMock([])
    const req = makeRequest(undefined, { url: 'http://worker.test/api/nomina/lineas?periodoId=xxx' })
    const res = await H.handleGetLineas(req, ENV)
    const { status } = await readResponse(res)
    expect(status).toBe(400)
  })

  it('handlePagarLineas rechaza lista vacía de recibos', async () => {
    mock = installFetchMock([])
    const res = await H.handlePagarLineas(makeRequest({ lineaIds: [] }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/no hay recibos/i)
  })

  it('handlePagarLineas descarta UUIDs inválidos y rechaza si no queda ninguno', async () => {
    mock = installFetchMock([])
    const res = await H.handlePagarLineas(makeRequest({ lineaIds: ['abc', '123'] }), ENV)
    const { status } = await readResponse(res)
    expect(status).toBe(400)
  })
})

// ─── Fechas ──────────────────────────────────────────────────────────────────

describe('validación de fechas', () => {
  it('handleRegistrarAsistencia rechaza formato de fecha incorrecto', async () => {
    mock = installFetchMock([])
    const res = await H.handleRegistrarAsistencia(
      makeRequest({ empleadoId: IDS.empleado, fecha: '03/08/2026' }), ENV
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/fecha inválida/i)
  })

  it('handleRegistrarAsistenciaMasivo rechaza fecha ausente', async () => {
    mock = installFetchMock([])
    const res = await H.handleRegistrarAsistenciaMasivo(
      makeRequest({ horaEntrada: '08:00', horaSalida: '17:00' }), ENV
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/fecha inválida/i)
  })

  it('handleCrearPeriodo rechaza rango invertido (hasta < desde)', async () => {
    mock = installFetchMock([])
    const res = await H.handleCrearPeriodo(
      makeRequest({ nombre: 'P', desde: '2026-08-10', hasta: '2026-08-03' }), ENV
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/posterior/i)
  })

  it('handleCrearPeriodo rechaza períodos de más de 31 días', async () => {
    mock = installFetchMock([])
    const res = await H.handleCrearPeriodo(makeRequest({
      nombre: 'Demasiado largo', desde: '2026-01-01', hasta: '2026-02-01',
    }), ENV)
    const { status } = await readResponse(res)
    expect(status).toBe(400)
    expect(mock.calls).toHaveLength(0)
  })

  it('handleCrearPeriodo rechaza nombre vacío', async () => {
    mock = installFetchMock([])
    const res = await H.handleCrearPeriodo(
      makeRequest({ nombre: '   ', desde: '2026-08-03', hasta: '2026-08-09' }), ENV
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/nombre/i)
  })

  it('handleCrearPeriodo rechaza fechas ausentes', async () => {
    mock = installFetchMock([])
    const res = await H.handleCrearPeriodo(makeRequest({ nombre: 'P' }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/fechas/i)
  })
})

// ─── Reglas de negocio en config de empleado ─────────────────────────────────

describe('config de empleado', () => {
  it('rechaza salario negativo', async () => {
    mock = installFetchMock([])
    const res = await H.handleCrearConfigEmpleado(
      makeRequest({ empleadoId: IDS.empleado, salarioDiaUsd: -5 }), ENV
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/negativo/i)
  })

  it('rechaza empleados que no son tipo_cliente = personal', async () => {
    mock = installFetchMock([
      { match: '/clientes', respond: [{ id: IDS.empleado, tipo_cliente: 'juridico' }] },
    ])
    const res = await H.handleCrearConfigEmpleado(
      makeRequest({ empleadoId: IDS.empleado, salarioDiaUsd: 30 }), ENV
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/personal/i)
  })

  it('devuelve 404 si el empleado no existe', async () => {
    mock = installFetchMock([{ match: '/clientes', respond: [] }])
    const res = await H.handleCrearConfigEmpleado(
      makeRequest({ empleadoId: IDS.empleado, salarioDiaUsd: 30 }), ENV
    )
    const { status } = await readResponse(res)
    expect(status).toBe(404)
  })

  it('traduce el conflicto de unicidad a 409', async () => {
    mock = installFetchMock([
      { match: '/clientes', respond: [{ id: IDS.empleado, tipo_cliente: 'personal' }] },
      { match: '/nomina_config_empleado', method: 'POST',
        respond: { __raw: 'duplicate key value violates unique constraint', ok: false, status: 409 } },
    ])
    const res = await H.handleCrearConfigEmpleado(
      makeRequest({ empleadoId: IDS.empleado, salarioDiaUsd: 30 }), ENV
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(409)
    expect(String(body.error)).toMatch(/ya tiene configuración/i)
  })

  it('crea la config con los valores por defecto cuando no se envían', async () => {
    let enviado = null
    mock = installFetchMock([
      { match: '/clientes', respond: [{ id: IDS.empleado, tipo_cliente: 'personal' }] },
      { match: '/nomina_config_empleado', method: 'POST', respond: (url, init) => {
        enviado = JSON.parse(init.body)
        return [{ id: IDS.config }]
      }},
    ])
    const res = await H.handleCrearConfigEmpleado(
      makeRequest({ empleadoId: IDS.empleado, salarioDiaUsd: 30 }), ENV
    )
    const { status } = await readResponse(res)

    expect(status).toBe(201)
    expect(enviado.horas_jornada).toBe(8)
    expect(enviado.hora_inicio).toBe('08:00')
    expect(enviado.hora_fin).toBe('17:00')
    expect(enviado.activo).toBe(true)
    // Aislamiento de tenant: la cuenta del operador viaja en el insert.
    expect(enviado.cuenta_id).toBe(OPERADORES.administracion.cuenta_id)
  })

  it('actualizar sin campos devuelve 400', async () => {
    mock = installFetchMock([])
    const res = await H.handleActualizarConfigEmpleado(makeRequest({ id: IDS.config }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/nada que actualizar/i)
  })

  it('actualizar aplica piso de 0 al salario negativo', async () => {
    let enviado = null
    mock = installFetchMock([
      { match: '/nomina_config_empleado', method: 'PATCH', respond: (url, init) => {
        enviado = JSON.parse(init.body)
        return [{ id: IDS.config }]
      }},
    ])
    await H.handleActualizarConfigEmpleado(
      makeRequest({ id: IDS.config, salarioDiaUsd: -100 }), ENV
    )
    expect(enviado.salario_dia_usd).toBe(0)
  })
})
