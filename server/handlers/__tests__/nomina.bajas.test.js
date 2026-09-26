// server/handlers/__tests__/nomina.bajas.test.js
// Vista de bajas: listarInactivas requiere flag, la reactivación vuelve a listar activos.
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

function configRow({ id = IDS.config, empleadoId = IDS.empleado, activo = true, nombre = 'Pedro Pérez' } = {}) {
  return {
    id, empleado_id: empleadoId, cargo: 'Almacenista', fecha_ingreso: '2026-01-05',
    salario_dia_usd: 12, horas_jornada: 8, hora_inicio: '08:00', hora_fin: '17:00',
    activo, pos_vendedor_id: null,
    empleado: { id: empleadoId, nombre, tipo_cliente: 'personal' },
  }
}

describe('bajas de empleados — listar y reactivar', () => {
  it('el listado normal solo pide activos (sin incluirInactivas)', async () => {
    operadorActual = OPERADORES.administracion
    mock = installFetchMock([
      { match: '/nomina_config_empleado', respond: [configRow()] },
      { match: '/nomina_horarios', method: 'GET', respond: [] },
    ])

    const res = await readResponse(await H.handleGetConfigEmpleados(makeRequest(undefined, {
      url: 'http://worker.test/api/nomina/config-empleados',
    }), ENV))

    expect(res.status).toBe(200)
    expect(mock.calls[0].url).toContain('activo=eq.true')
    expect(mock.calls[0].url).not.toContain('incluirInactivas')
    expect(res.body).toHaveLength(1)
    expect(res.body[0].activo).toBe(true)
  })

  it('con incluirInactivas=1 el SELECT no filtra por activo y devuelve la baja completa', async () => {
    operadorActual = OPERADORES.administracion
    const baja = configRow({ id: IDS.config, activo: false, nombre: 'Luis Baja' })
    mock = installFetchMock([
      { match: '/nomina_config_empleado', respond: [baja] },
      { match: '/nomina_horarios', method: 'GET', respond: [] },
    ])

    const res = await readResponse(await H.handleGetConfigEmpleados(makeRequest(undefined, {
      url: 'http://worker.test/api/nomina/config-empleados?incluirInactivas=1',
    }), ENV))

    expect(res.status).toBe(200)
    expect(mock.calls[0].url).not.toContain('activo=eq.true')
    expect(mock.calls[0].url).not.toContain('?&')
    expect(mock.calls[0].url).toContain('cuenta_id=eq.')
    expect(res.body).toHaveLength(1)
    expect(res.body[0].activo).toBe(false)
    expect(res.body[0].empleado.nombre).toBe('Luis Baja')
    expect(res.body[0].salario_dia_usd).toBe(12) // rol administracion ve montos
  })

  it.todo('rol sin montos recibe la baja sin salario_dia_usd (sin rol no-ver en producción, cubierto por la rama else del handler)')

  it('reactivar con activo=true actualiza y devuelve la config reactivada', async () => {
    operadorActual = OPERADORES.administracion
    const reactivada = configRow({ activo: true })
    mock = installFetchMock([
      { match: '/nomina_config_empleado', method: 'PATCH', respond: [reactivada] },
    ])

    const res = await readResponse(await H.handleActualizarConfigEmpleado(makeRequest({
      id: IDS.config, activo: true,
    }, { url: 'http://worker.test/api/nomina/config-empleado/actualizar' }), ENV))

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.config.activo).toBe(true)
    expect(mock.calls[0].body).toEqual({ activo: true })
  })

  it('reactivar un id inexistente devuelve 404', async () => {
    operadorActual = OPERADORES.administracion
    mock = installFetchMock([
      { match: '/nomina_config_empleado', method: 'PATCH', respond: [] },
    ])

    const res = await readResponse(await H.handleActualizarConfigEmpleado(makeRequest({
      id: IDS.empleado2, activo: true,
    }, { url: 'http://worker.test/api/nomina/config-empleado/actualizar' }), ENV))

    expect(res.status).toBe(404)
  })

  describe('eliminación definitiva de empleados (segura)', () => {
    it('bloquea (409) la eliminación si el empleado tiene marcajes en registro_asistencia', async () => {
      operadorActual = OPERADORES.administracion
      mock = installFetchMock([
        { match: '/nomina_config_empleado', method: 'GET', respond: [{ id: IDS.config, empleado_id: IDS.empleado, cargo: 'Chofer' }] },
        { match: '/registro_asistencia', method: 'GET', respond: [{ id: 'asist-1' }] },
        { match: '/nomina_lineas', method: 'GET', respond: [] },
        { match: '/nomina_horarios', method: 'GET', respond: [] },
      ])

      const res = await readResponse(await H.handleEliminarConfigEmpleado(makeRequest({
        id: IDS.config,
      }, { url: 'http://worker.test/api/nomina/config-empleado/eliminar' }), ENV))

      expect(res.status).toBe(409)
      expect(res.body.error).toContain('historial contable')
    })

    it('bloquea (409) la eliminación si el empleado tiene recibos en nomina_lineas', async () => {
      operadorActual = OPERADORES.administracion
      mock = installFetchMock([
        { match: '/nomina_config_empleado', method: 'GET', respond: [{ id: IDS.config, empleado_id: IDS.empleado, cargo: 'Vendedor' }] },
        { match: '/registro_asistencia', method: 'GET', respond: [] },
        { match: '/nomina_lineas', method: 'GET', respond: [{ id: 'recibo-1', periodo_id: IDS.periodo, pagado: false, total_neto_usd: 0 }] },
        { match: '/nomina_horarios', method: 'GET', respond: [] },
        { match: '/nomina_periodos', method: 'GET', respond: [{ id: IDS.periodo, nombre: 'Prueba', estado: 'abierto' }] },
        { match: '/nomina_linea_conceptos', method: 'GET', respond: [] },
        { match: '/nomina_comisiones', respond: [] },
      ])

      const res = await readResponse(await H.handleEliminarConfigEmpleado(makeRequest({
        id: IDS.config,
      }, { url: 'http://worker.test/api/nomina/config-empleado/eliminar' }), ENV))

      expect(res.status).toBe(409)
      expect(res.body.error).toContain('historial contable')
    })

    it('elimina exitosamente (200) al empleado si está completamente limpio de historial', async () => {
      operadorActual = OPERADORES.administracion
      mock = installFetchMock([
        { match: '/nomina_config_empleado', method: 'GET', respond: [{ id: IDS.config, empleado_id: IDS.empleado, cargo: 'Prueba', empleado: { id: IDS.empleado, nombre: 'Pedro Pérez', tipo_cliente: 'personal' } }] },
        { match: '/registro_asistencia', method: 'GET', respond: [] },
        { match: '/nomina_lineas', method: 'GET', respond: [] },
        { match: '/nomina_horarios', method: 'GET', respond: [] },
        { match: '/nomina_horarios', method: 'DELETE', respond: [] },
        { match: '/nomina_config_empleado', method: 'DELETE', respond: [{ id: IDS.config }] },
        { match: '/clientes', method: 'DELETE', respond: [] },
        { match: '/registro_asistencia', method: 'DELETE', respond: [] },
      ])

      const res = await readResponse(await H.handleEliminarConfigEmpleado(makeRequest({
        id: IDS.config,
      }, { url: 'http://worker.test/api/nomina/config-empleado/eliminar' }), ENV))

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.eliminado).toBe(true)
      expect(mock.calls.some(c => c.method === 'DELETE' && c.url.includes('/nomina_config_empleado'))).toBe(true)
    })

    it('permite borrar recibos no pagados solo de períodos abiertos, dejando auditoría y sin tocar el libro financiero', async () => {
      const name = 'José Ramírez'
      const lineId = '30000000-0000-4000-8000-000000000001'
      const employeeId = IDS.empleado
      const calls = []
      operadorActual = OPERADORES.administracion
      mock = installFetchMock([
        { match: '/nomina_config_empleado', method: 'GET', respond: [{
          id: IDS.config, empleado_id: employeeId, cargo: 'Chofer', activo: false,
          empleado: { id: employeeId, nombre: name, tipo_cliente: 'personal' },
        }] },
        { match: '/registro_asistencia', method: 'GET', respond: [{ id: 'attendance-1', fecha: '2026-08-01' }] },
        { match: '/nomina_lineas', method: 'GET', respond: [{ id: lineId, periodo_id: IDS.periodo, pagado: false, total_neto_usd: 0 }] },
        { match: '/nomina_horarios', method: 'GET', respond: [] },
        { match: '/nomina_periodos', method: 'GET', respond: [{ id: IDS.periodo, nombre: 'Semana abierta', estado: 'abierto' }] },
        { match: '/nomina_linea_conceptos', method: 'GET', respond: [] },
        { match: '/nomina_lineas', method: 'DELETE', respond: [{ id: lineId }] },
        { match: '/registro_asistencia', method: 'DELETE', respond: [] },
        { match: '/nomina_config_empleado', method: 'DELETE', respond: [{ id: IDS.config }] },
        { match: '/clientes', method: 'DELETE', respond: [] },
        { match: '/auditoria', method: 'POST', respond: [] },
      ])

      const result = await readResponse(await H.handleEliminarConfigEmpleado(makeRequest({
        id: IDS.config, incluirHistorial: true, empleadoId: employeeId, confirmarNombre: name,
      }), ENV))

      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({ eliminado: true, empleadoId: IDS.empleado })
      expect(mock.calls.some(call => call.method === 'DELETE' && call.url.includes('/nomina_lineas?id=in.'))).toBe(true)
      expect(mock.calls.some(call => call.method === 'DELETE' && call.url.includes('/finanzas_movimientos'))).toBe(false)
      expect(mock.calls.some(call => call.method === 'DELETE' && call.url.includes('/auditoria'))).toBe(false)
    })

    it('rechaza la confirmación si el nombre no coincide sin borrar nada', async () => {
      const employeeId = IDS.empleado
      operadorActual = OPERADORES.administracion
      mock = installFetchMock([{
        match: '/nomina_config_empleado', method: 'GET', respond: [{
          id: IDS.config, empleado_id: employeeId, cargo: 'Chofer', activo: false,
          empleado: { id: employeeId, nombre: 'José Ramírez', tipo_cliente: 'personal' },
        }],
      }])
      const result = await readResponse(await H.handleEliminarConfigEmpleado(makeRequest({
        id: IDS.config, incluirHistorial: true, empleadoId: employeeId, confirmarNombre: 'Luis Ramírez',
      }), ENV))
      expect(result.status).toBe(400)
      expect(mock.calls.some(call => call.method === 'DELETE')).toBe(false)
    })

    it('rechaza historial de períodos cerrados y no borra ningún dato', async () => {
      const employeeId = IDS.empleado
      operadorActual = OPERADORES.administracion
      mock = installFetchMock([
        { match: '/nomina_config_empleado', method: 'GET', respond: [{
          id: IDS.config, empleado_id: employeeId, cargo: 'Chofer', activo: false,
          empleado: { id: employeeId, nombre: 'José Ramírez', tipo_cliente: 'personal' },
        }] },
        { match: '/registro_asistencia', method: 'GET', respond: [] },
        { match: '/nomina_lineas', method: 'GET', respond: [{ id: 'recibo-1', periodo_id: IDS.periodo, pagado: false }] },
        { match: '/nomina_horarios', method: 'GET', respond: [] },
        { match: '/nomina_periodos', method: 'GET', respond: [{ id: IDS.periodo, estado: 'cerrado' }] },
      ])
      const result = await readResponse(await H.handleEliminarConfigEmpleado(makeRequest({
        id: IDS.config, incluirHistorial: true, empleadoId: employeeId, confirmarNombre: 'José Ramírez',
      }), ENV))
      expect(result.status).toBe(409)
      expect(mock.calls.some(call => call.method === 'DELETE')).toBe(false)
    })

    it('rechaza con 400 si el id no es UUID válido', async () => {
      operadorActual = OPERADORES.administracion
      const res = await readResponse(await H.handleEliminarConfigEmpleado(makeRequest({
        id: 'invalido',
      }), ENV))
      expect(res.status).toBe(400)
    })

    it('rechaza con 404 si la configuración de empleado no existe', async () => {
      operadorActual = OPERADORES.administracion
      mock = installFetchMock([
        { match: '/nomina_config_empleado', method: 'GET', respond: [] },
      ])

      const res = await readResponse(await H.handleEliminarConfigEmpleado(makeRequest({
        id: IDS.config,
      }), ENV))

      expect(res.status).toBe(404)
    })
  })
})

