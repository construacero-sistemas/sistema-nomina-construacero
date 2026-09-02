import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse,
} from './_harness'

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
  delete ENV.NOMINA_NOW
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

const NOW = '2026-08-08T12:00:00.000Z'

function routesFor({ asistencia = [], post = [], feriados = [] } = {}) {
  return [
    { match: '/nomina_periodos', respond: [] },
    { match: '/nomina_config_empleado', respond: [{ horas_jornada: 8 }] },
    { match: '/nomina_feriados', respond: feriados },
    { match: '/registro_asistencia', method: 'GET', respond: asistencia },
    { match: '/registro_asistencia', method: 'POST', respond: post },
    { match: '/registro_asistencia', method: 'PATCH', respond: post },
  ]
}

describe('marcaje operativo de administración', () => {
  it('registra entrada con fecha/hora del servidor y no con datos del empleado', async () => {
    ENV.NOMINA_NOW = NOW
    mock = installFetchMock(routesFor({
      post: [{ id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-08' }],
    }))

    const res = await H.handleMarcarEntrada(makeRequest({
      empleadoId: IDS.empleado,
      idempotencyKey: 'entrada-2026-08-08-1',
    }), ENV)
    const { status } = await readResponse(res)

    expect(status).toBe(201)
    const post = mock.calls.find(c => c.method === 'POST')
    expect(post.body.hora_entrada).toBe('08:00')
    expect(post.body.fecha).toBe('2026-08-08')
    expect(post.body.registrado_por).toBe(OPERADORES.administracion.id)
    expect(post.body.cuenta_id).toBe(OPERADORES.administracion.cuenta_id)
  })

  it('congela el feriado del calendario en la entrada operativa', async () => {
    ENV.NOMINA_NOW = NOW
    mock = installFetchMock(routesFor({
      feriados: [{ id: IDS.registro, fecha: '2026-08-08', nombre: 'Feriado' }],
      post: [{ id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-08' }],
    }))

    const res = await H.handleMarcarEntrada(makeRequest({
      empleadoId: IDS.empleado,
      idempotencyKey: 'entrada-2026-08-08-feriado',
    }), ENV)
    expect((await readResponse(res)).status).toBe(201)
    const post = mock.calls.find(c => c.method === 'POST')
    expect(post.body.es_feriado).toBe(true)
  })

  it('registra salida y calcula horas sobre la entrada existente', async () => {
    ENV.NOMINA_NOW = NOW
    mock = installFetchMock(routesFor({
      asistencia: [{
        id: IDS.registro,
        empleado_id: IDS.empleado,
        fecha: '2026-08-08',
        hora_entrada: '07:00',
        hora_salida: null,
        nota: null,
      }],
      post: [{ id: IDS.registro, horas_trabajadas: 1, estado_marcaje: 'completo' }],
    }))

    const res = await H.handleMarcarSalida(makeRequest({
      empleadoId: IDS.empleado,
      idempotencyKey: 'salida-2026-08-08-1',
    }), ENV)
    const { status } = await readResponse(res)

    expect(status).toBe(200)
    const patch = mock.calls.find(c => c.method === 'PATCH')
    expect(patch.body.hora_salida).toBe('08:00')
    expect(patch.body.estado_marcaje).toBe('completo')
    expect(patch.body.horas_trabajadas).toBe(1)
  })

  it('registra salida correctamente cuando la entrada viene con segundos (Postgres TIME: HH:MM:SS)', async () => {
    ENV.NOMINA_NOW = NOW
    mock = installFetchMock(routesFor({
      asistencia: [{
        id: IDS.registro,
        empleado_id: IDS.empleado,
        fecha: '2026-08-08',
        hora_entrada: '00:05:00',
        hora_salida: null,
        nota: null,
      }],
      post: [{ id: IDS.registro, estado_marcaje: 'completo' }],
    }))

    const res = await H.handleMarcarSalida(makeRequest({
      empleadoId: IDS.empleado,
      idempotencyKey: 'salida-2026-08-08-seconds',
    }), ENV)
    const { status } = await readResponse(res)

    expect(status).toBe(200)
    const patch = mock.calls.find(c => c.method === 'PATCH')
    expect(patch.body.hora_salida).toBe('08:00')
  })

  it('repite una entrada de forma idempotente sin hacer POST', async () => {
    ENV.NOMINA_NOW = NOW
    mock = installFetchMock(routesFor({
      asistencia: [{
        id: IDS.registro,
        empleado_id: IDS.empleado,
        fecha: '2026-08-08',
        hora_entrada: '08:00',
        entrada_idempotency_key: 'entrada-2026-08-08-1',
      }],
    }))

    const res = await H.handleMarcarEntrada(makeRequest({
      empleadoId: IDS.empleado,
      idempotencyKey: 'entrada-2026-08-08-1',
    }), ENV)
    const { status, body } = await readResponse(res)

    expect(status).toBe(200)
    expect(body.idempotente).toBe(true)
    expect(mock.calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('rechaza roles heredados en el endpoint operativo', async () => {
    operadorActual = OPERADORES.logistica
    mock = installFetchMock([])

    const res = await H.handleMarcarEntrada(makeRequest({
      empleadoId: IDS.empleado,
      idempotencyKey: 'entrada-2026-08-08-2',
    }), ENV)
    const { status } = await readResponse(res)

    expect(status).toBe(403)
    expect(mock.calls).toHaveLength(0)
  })
})
