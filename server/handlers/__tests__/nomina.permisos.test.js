// server/handlers/__tests__/nomina.permisos.test.js
// Autorización de Nómina según la matriz de capacidades (migración 242):
//   * jefe / administracion / desarrollador / nomina → acceso al módulo.
//   * finanzas y el resto de roles → 403 sin consultar datos.
// El mock de auth permite comprobar la defensa local sin depender de Supabase.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
}))
vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(async () => {}),
}))

const H = await import('../nomina.js')
let mock

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

const ROUTES = [
  ['handleGetEmpleados', undefined],
  ['handleGetConfigEmpleados', undefined],
  ['handleCrearConfigEmpleado', { empleadoId: IDS.empleado, salarioDiaUsd: 30 }],
  ['handleActualizarConfigEmpleado', { id: IDS.config, cargo: 'Almacenista' }],
  ['handleGetAsistencia', undefined],
  ['handleRegistrarAsistencia', { empleadoId: IDS.empleado, fecha: '2026-08-03' }],
  ['handleRegistrarAsistenciaMasivo', { fecha: '2026-08-03' }],
  ['handleEliminarAsistencia', { id: IDS.registro }],
  ['handleGetMarcajeHoy', undefined],
  ['handleMarcarEntrada', { empleadoId: IDS.empleado, idempotencyKey: 'entrada-test-0001' }],
  ['handleMarcarSalida', { empleadoId: IDS.empleado, idempotencyKey: 'salida-test-0001' }],
  ['handleGetFeriados', undefined],
  ['handleCrearFeriado', { fecha: '2026-12-24', nombre: 'Feriado' }],
  ['handleGetHorarios', undefined],
  ['handleCrearHorario', { diaSemana: 1, fechaDesde: '2026-08-01', horaInicio: '08:00', horaFin: '17:00', horasJornada: 8 }],
  ['handleGetConceptos', undefined],
  ['handleCrearConcepto', {}],
  ['handleGetReglasLegales', undefined],
  ['handleCrearReglaLegal', {}],
  ['handleGetTasasSnapshots', undefined],
  ['handleCrearTasaSnapshot', {}],
  ['handleGetPeriodos', undefined],
  ['handleCrearPeriodo', { nombre: 'P', desde: '2026-08-03', hasta: '2026-08-09' }],
  ['handleCalcularPeriodo', { periodoId: IDS.periodo }],
  ['handleCerrarPeriodo', { periodoId: IDS.periodo }],
  ['handleReabrirPeriodo', { periodoId: IDS.periodo }],
  ['handleEliminarPeriodo', { periodoId: IDS.periodo }],
  ['handleGetLineas', undefined],
  ['handleAjustarLinea', { lineaId: IDS.linea, bonosUsd: 10 }],
  ['handlePagarLineas', { operationId: IDS.registro, lineaIds: [IDS.linea], cuentaCustodiaId: IDS.config, tasaBcv: '400', tasaUsdVes: '400', fuenteTasa: 'BCV', metodoPago: 'Efectivo $' }],
  ['handleRevertirPagoLinea', { operationId: IDS.registro, lineaId: IDS.linea, motivo: 'Corrección de prueba' }],
]

// Roles SIN acceso a nómina: finanzas (solo su módulo) y los heredados del
// sistema de cotizaciones (logistica/supervisor/vendedor).
const ROLES_SIN_NOMINA = ['finanzas', 'logistica', 'supervisor', 'vendedor']

describe('permisos — matriz de nómina', () => {
  for (const rol of ROLES_SIN_NOMINA) {
    for (const [name, body] of ROUTES) {
      it(`${rol} recibe 403 en ${name} sin consultar datos`, async () => {
        operadorActual = OPERADORES[rol]
        mock = installFetchMock([])

        const response = await H[name](makeRequest(body), ENV)
        const result = await readResponse(response)

        expect(result.status).toBe(403)
        expect(result.body.error).toEqual(expect.any(String))
        expect(result.body.error.length).toBeGreaterThan(0)
        expect(result.body).not.toHaveProperty('ok', true)
        expect(mock.calls).toHaveLength(0)
      })
    }
  }

  // Los roles CON acceso (jefe, desarrollador, nomina) deben pasar la puerta de
  // autorización: con BD vacía pueden fallar por datos, pero NO por 403.
  for (const rol of ['jefe', 'desarrollador', 'nomina']) {
    it(`${rol} pasa la puerta de autorización en handleGetEmpleados (no 403 por rol)`, async () => {
      operadorActual = OPERADORES[rol]
      mock = installFetchMock([
        { match: '/rpc/', method: 'POST', respond: [] },
        { match: '/clientes', method: 'GET', respond: [] },
        { match: '/empleados', method: 'GET', respond: [] },
      ])
      const response = await H.handleGetEmpleados(makeRequest(), ENV)
      const result = await readResponse(response)
      expect(result.status).not.toBe(403)
    })
  }

  it.each(['handlePagarLineas', 'handleRevertirPagoLinea'])('rejects a missing tenant for %s before calling the RPC', async name => {
    operadorActual = { ...OPERADORES.administracion, cuenta_id: null }
    const [, body] = ROUTES.find(([route]) => route === name)
    mock = installFetchMock([])
    const result = await readResponse(await H[name](makeRequest(body), ENV))
    expect(result.status).toBe(403)
    expect(result.body.error).toEqual(expect.any(String))
    expect(mock.calls).toHaveLength(0)
  })

  it.each([
    ['handlePagarLineas', 'pagar_nomina'],
    ['handleRevertirPagoLinea', 'revertir_nomina'],
  ])('uses only the authenticated administrator and tenant for %s', async (name, tipo) => {
    const [, body] = ROUTES.find(([route]) => route === name)
    const resultado = tipo === 'pagar_nomina' ? { recibos_pagados: 1, total_usd: '100.000000' }
      : { lineaId: IDS.linea, reversionContable: true }
    const confirmed = { ok: true, estado: 'confirmada', tipo, operationId: IDS.periodo,
      idempotencyKey: body.operationId, resultado, ...resultado }
    mock = installFetchMock([{ match: '/rpc/finanzas_operar', method: 'POST', respond: confirmed }])
    const result = await readResponse(await H[name](makeRequest({ ...body,
      cuenta_id: IDS.empleado, operador_id: IDS.empleado2, usuarioId: IDS.empleado2, zonaHoraria: 'UTC' }), ENV))
    expect(result).toEqual({ status: 200, body: confirmed })
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].body).toMatchObject({ p_cuenta_id: OPERADORES.administracion.cuenta_id,
      p_operador_id: OPERADORES.administracion.id, p_tipo: tipo, p_clave: body.operationId,
      p_payload: { zonaHoraria: 'America/Caracas' } })
    expect(mock.calls[0].body.p_payload).not.toHaveProperty('cuenta_id')
    expect(mock.calls[0].body.p_payload).not.toHaveProperty('operador_id')
    expect(mock.calls[0].body.p_payload).not.toHaveProperty('usuarioId')
  })

  it('administración puede consultar empleados y la configuración salarial', async () => {
    operadorActual = OPERADORES.administracion
    mock = installFetchMock([
      { match: '/clientes', respond: [{ id: IDS.empleado, nombre: 'Ana', tipo_cliente: 'personal' }] },
      { match: '/nomina_config_empleado', respond: [{ id: IDS.config, empleado_id: IDS.empleado, salario_dia_usd: 30, horas_jornada: 8 }] },
    ])

    const employees = await readResponse(await H.handleGetEmpleados(makeRequest(), ENV))
    const configs = await readResponse(await H.handleGetConfigEmpleados(makeRequest(), ENV))

    expect(employees.status).toBe(200)
    expect(configs.status).toBe(200)
    expect(configs.body[0].salario_dia_usd).toBe(30)
    expect(mock.calls.every(call => call.url.includes('cuenta_id=eq.'))).toBe(true)
  })
})
