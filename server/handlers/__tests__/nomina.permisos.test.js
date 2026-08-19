// server/handlers/__tests__/nomina.permisos.test.js
// Toda ruta de Nómina debe aceptar únicamente el rol administracion.
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
  ['handleGetLineas', undefined],
  ['handleAjustarLinea', { lineaId: IDS.linea, bonosUsd: 10 }],
  ['handlePagarLineas', { lineaIds: [IDS.linea] }],
  ['handleRevertirPagoLinea', { lineaId: IDS.linea }],
]

const LEGACY_ROLES = ['jefe', 'desarrollador', 'logistica', 'supervisor', 'vendedor']

describe('permisos — solo administración', () => {
  for (const rol of LEGACY_ROLES) {
    for (const [name, body] of ROUTES) {
      it(`${rol} recibe 403 en ${name} sin consultar datos`, async () => {
        operadorActual = OPERADORES[rol]
        mock = installFetchMock([])

        const response = await H[name](makeRequest(body), ENV)
        const result = await readResponse(response)

        expect(result.status).toBe(403)
        expect(String(result.body.error)).toMatch(/administración|denegado|permiso/i)
        expect(mock.calls).toHaveLength(0)
      })
    }
  }

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
