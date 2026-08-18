// api/handlers/__tests__/nomina.permisos.test.js
// Matriz de permisos por rol sobre los 16 endpoints de nómina.
// Todo corre contra un fetch mockeado: ninguna petición sale del proceso.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ENV, OPERADORES, IDS, makeRequest, readResponse, installFetchMock, authOk } from './_harness'

// validateOperator se mockea: el rol se controla por test, sin red ni credenciales.
let operadorActual = OPERADORES.administracion

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
}))

// La auditoría es fire-and-forget; se anula para no ensuciar el mock de fetch.
vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(async () => {}),
}))

const H = await import('../nomina.js')

let mock
afterEach(() => { mock?.restore(); vi.clearAllMocks() })

/** Endpoints accesibles a los 4 roles, incluida logística. */
const ENDPOINTS_VER = [
  { nombre: 'handleGetEmpleados',       fn: 'handleGetEmpleados',       body: undefined },
  { nombre: 'handleGetConfigEmpleados', fn: 'handleGetConfigEmpleados', body: undefined },
  { nombre: 'handleGetAsistencia',      fn: 'handleGetAsistencia',      body: undefined },
  { nombre: 'handleRegistrarAsistencia', fn: 'handleRegistrarAsistencia', body: { empleadoId: IDS.empleado, fecha: '2026-08-03' } },
]

/**
 * Endpoints restringidos a administracion / jefe / desarrollador.
 * Incluye los dos de LECTURA de datos salariales (ROLES_NOMINA): logística
 * registra asistencia pero no debe ver montos.
 */
const ENDPOINTS_ADMIN = [
  { nombre: 'handleGetPeriodos',        fn: 'handleGetPeriodos',        body: undefined },
  { nombre: 'handleGetLineas',          fn: 'handleGetLineas',          body: undefined },
  { nombre: 'handleCrearConfigEmpleado',      fn: 'handleCrearConfigEmpleado',      body: { empleadoId: IDS.empleado, salarioDiaUsd: 30 } },
  { nombre: 'handleActualizarConfigEmpleado', fn: 'handleActualizarConfigEmpleado', body: { id: IDS.config, cargo: 'X' } },
  { nombre: 'handleRegistrarAsistenciaMasivo', fn: 'handleRegistrarAsistenciaMasivo', body: { fecha: '2026-08-03', horaEntrada: '08:00', horaSalida: '17:00' } },
  { nombre: 'handleEliminarAsistencia',       fn: 'handleEliminarAsistencia',       body: { id: IDS.registro } },
  { nombre: 'handleCrearPeriodo',             fn: 'handleCrearPeriodo',             body: { nombre: 'P1', desde: '2026-08-03', hasta: '2026-08-09' } },
  { nombre: 'handleCalcularPeriodo',          fn: 'handleCalcularPeriodo',          body: { periodoId: IDS.periodo } },
  { nombre: 'handleCerrarPeriodo',            fn: 'handleCerrarPeriodo',            body: { periodoId: IDS.periodo } },
  { nombre: 'handleReabrirPeriodo',           fn: 'handleReabrirPeriodo',           body: { periodoId: IDS.periodo } },
  { nombre: 'handleAjustarLinea',             fn: 'handleAjustarLinea',             body: { lineaId: IDS.linea, bonosUsd: 10 } },
  { nombre: 'handlePagarLineas',              fn: 'handlePagarLineas',              body: { lineaIds: [IDS.linea] } },
  { nombre: 'handleRevertirPagoLinea',        fn: 'handleRevertirPagoLinea',        body: { lineaId: IDS.linea } },
]

// ─── Roles bloqueados: supervisor y vendedor ─────────────────────────────────

describe('permisos — supervisor y vendedor no acceden a NINGÚN endpoint', () => {
  const bloqueados = ['supervisor', 'vendedor']

  for (const rol of bloqueados) {
    for (const ep of [...ENDPOINTS_VER, ...ENDPOINTS_ADMIN]) {
      it(`${rol} recibe 403 en ${ep.nombre}`, async () => {
        operadorActual = OPERADORES[rol]
        // Sin rutas declaradas: si el handler intentara consultar algo, el mock lanzaría.
        mock = installFetchMock([])

        const res = await H[ep.fn](makeRequest(ep.body), ENV)
        const { status, body } = await readResponse(res)

        expect(status).toBe(403)
        expect(String(body.error)).toMatch(/denegado|permiso/i)
        // Un 403 debe cortar ANTES de consultar la base.
        expect(mock.calls).toHaveLength(0)
      })
    }
  }
})

// ─── Logística: puede ver y registrar, no puede administrar ──────────────────

describe('permisos — logística solo lectura + registro de asistencia', () => {
  for (const ep of ENDPOINTS_ADMIN) {
    it(`logística recibe 403 en ${ep.nombre}`, async () => {
      operadorActual = OPERADORES.logistica
      mock = installFetchMock([])

      const res = await H[ep.fn](makeRequest(ep.body), ENV)
      const { status } = await readResponse(res)

      expect(status).toBe(403)
      expect(mock.calls).toHaveLength(0)
    })
  }

  it('logística SÍ puede leer la lista de empleados', async () => {
    operadorActual = OPERADORES.logistica
    mock = installFetchMock([{ match: '/nomina_config_empleado', respond: [] }])

    const res = await H.handleGetConfigEmpleados(makeRequest(), ENV)
    const { status } = await readResponse(res)

    expect(status).toBe(200)
    expect(mock.calls.length).toBeGreaterThan(0)
  })

  it('logística recibe la lista de empleados SIN el campo de salario', async () => {
    operadorActual = OPERADORES.logistica
    mock = installFetchMock([{ match: '/nomina_config_empleado', respond: [
      { id: IDS.config, empleado_id: IDS.empleado, cargo: 'Almacenista',
        salario_dia_usd: 30, horas_jornada: 8, hora_inicio: '08:00', hora_fin: '17:00',
        empleado: { id: IDS.empleado, nombre: 'Juan Pérez' } },
    ]}])

    const res = await H.handleGetConfigEmpleados(makeRequest(), ENV)
    const { status, body } = await readResponse(res)

    expect(status).toBe(200)
    // El salario no debe viajar al cliente, ni siquiera para ocultarse en la UI.
    expect(body[0]).not.toHaveProperty('salario_dia_usd')
    // El resto de datos que sí necesita para marcar asistencia sigue llegando.
    expect(body[0].cargo).toBe('Almacenista')
    expect(body[0].horas_jornada).toBe(8)
    expect(body[0].empleado.nombre).toBe('Juan Pérez')
  })

  it('administración SÍ recibe el salario en la lista de empleados', async () => {
    operadorActual = OPERADORES.administracion
    mock = installFetchMock([{ match: '/nomina_config_empleado', respond: [
      { id: IDS.config, empleado_id: IDS.empleado, salario_dia_usd: 30, horas_jornada: 8 },
    ]}])

    const res = await H.handleGetConfigEmpleados(makeRequest(), ENV)
    const { body } = await readResponse(res)

    expect(body[0].salario_dia_usd).toBe(30)
  })

  it('logística SÍ puede registrar asistencia de un día', async () => {
    operadorActual = OPERADORES.logistica
    mock = installFetchMock([
      { match: '/nomina_periodos',       respond: [] },              // sin período cerrado
      { match: '/nomina_config_empleado', respond: [{ horas_jornada: 8 }] },
      { match: '/registro_asistencia', method: 'POST', respond: [{ id: IDS.registro }] },
    ])

    const res = await H.handleRegistrarAsistencia(
      makeRequest({ empleadoId: IDS.empleado, fecha: '2026-08-03', horaEntrada: '08:00', horaSalida: '17:00' }),
      ENV
    )
    const { status, body } = await readResponse(res)

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })
})

// ─── Roles administradores: pasan el guard de permisos ───────────────────────

describe('permisos — administracion, jefe y desarrollador pasan el guard', () => {
  const admins = ['administracion', 'jefe', 'desarrollador']

  for (const rol of admins) {
    it(`${rol} NO recibe 403 al crear un período`, async () => {
      operadorActual = OPERADORES[rol]
      mock = installFetchMock([
        { match: '/nomina_periodos', method: 'GET',  respond: [] },
        { match: '/nomina_periodos', method: 'POST', respond: [{ id: IDS.periodo, nombre: 'P1' }] },
      ])

      const res = await H.handleCrearPeriodo(
        makeRequest({ nombre: 'P1', desde: '2026-08-03', hasta: '2026-08-09' }),
        ENV
      )
      const { status } = await readResponse(res)

      expect(status).not.toBe(403)
      expect(status).toBe(201)
    })
  }
})
