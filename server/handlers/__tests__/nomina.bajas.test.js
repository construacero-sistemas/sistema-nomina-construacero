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
        { match: '/nomina_config_empleado', respond: [{ id: IDS.config, empleado_id: IDS.empleado, cargo: 'Chofer' }] },
        { match: '/registro_asistencia', respond: [{ id: 'asist-1' }] },
        { match: '/nomina_lineas', respond: [] },
        { match: '/nomina_comisiones', respond: [] },
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
        { match: '/nomina_config_empleado', respond: [{ id: IDS.config, empleado_id: IDS.empleado, cargo: 'Vendedor' }] },
        { match: '/registro_asistencia', respond: [] },
        { match: '/nomina_lineas', respond: [{ id: 'recibo-1' }] },
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
        { match: '/nomina_config_empleado', respond: [{ id: IDS.config, empleado_id: IDS.empleado, cargo: 'Prueba' }] },
        { match: '/registro_asistencia', respond: [] },
        { match: '/nomina_lineas', respond: [] },
        { match: '/nomina_comisiones', respond: [] },
        { match: '/nomina_horarios', method: 'DELETE', respond: [] },
        { match: '/nomina_config_empleado', method: 'DELETE', respond: [] },
        { match: '/clientes', method: 'DELETE', respond: [] },
      ])

      const res = await readResponse(await H.handleEliminarConfigEmpleado(makeRequest({
        id: IDS.config,
      }, { url: 'http://worker.test/api/nomina/config-empleado/eliminar' }), ENV))

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.eliminado).toBe(true)
      expect(mock.calls.some(c => c.method === 'DELETE' && c.url.includes('/nomina_config_empleado'))).toBe(true)
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
        { match: '/nomina_config_empleado', respond: [] },
      ])

      const res = await readResponse(await H.handleEliminarConfigEmpleado(makeRequest({
        id: IDS.config,
      }), ENV))

      expect(res.status).toBe(404)
    })
  })
})

