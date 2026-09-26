import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse,
} from './_harness'

let operadorActual = OPERADORES.administracion

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
}))
const registrarAuditoria = vi.fn(async () => {})
vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: (...args) => registrarAuditoria(...args),
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

function routesFor({ asistencia = [], post = [], feriados = [], config = [{ horas_jornada: 8 }] } = {}) {
  return [
    { match: '/nomina_periodos', respond: [] },
    { match: '/nomina_config_empleado', respond: config },
    { match: '/nomina_feriados', respond: feriados },
    { match: '/registro_asistencia', method: 'GET', respond: asistencia },
    { match: '/registro_asistencia', method: 'POST', respond: post },
    { match: '/registro_asistencia', method: 'PATCH', respond: post },
  ]
}

describe('marcaje operativo de administración', () => {
  it('lee marcajes del día e incluye ausencias para que la UI no las confunda con horario fijo', async () => {
    ENV.NOMINA_NOW = NOW
    const asistencia = [{
      id: IDS.registro,
      empleado_id: IDS.empleado,
      fecha: '2026-08-08',
      hora_entrada: null,
      hora_salida: null,
      estado_marcaje: 'manual',
      es_ausencia: true,
    }]
    mock = installFetchMock([{ match: '/registro_asistencia', method: 'GET', respond: asistencia }])

    const res = await H.handleGetMarcajeHoy(makeRequest(undefined, { url: 'http://worker.test/api/nomina/marcaje/hoy' }), ENV)
    const { status, body } = await readResponse(res)

    expect(status).toBe(200)
    expect(body.registros).toEqual(asistencia)
    expect(mock.calls[0].url).toContain('es_ausencia')
  })

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

  it('rechaza marcar a un perfil sin control de asistencia antes de escribir nada', async () => {
    ENV.NOMINA_NOW = NOW
    mock = installFetchMock(routesFor({ config: [{ horas_jornada: 8, controla_asistencia: false }] }))

    const res = await H.handleMarcarEntrada(makeRequest({
      empleadoId: IDS.empleado,
      idempotencyKey: 'entrada-sin-control-asistencia',
    }), ENV)
    const { status, body } = await readResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/no tiene control de asistencia/i)
    expect(mock.calls.some(call => ['POST', 'PATCH'].includes(call.method))).toBe(false)
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

  it('corrige una jornada abierta sin registrar salida y conserva horas anteriores y motivo en auditoría', async () => {
    const registro = {
      id: IDS.registro,
      empleado_id: IDS.empleado,
      fecha: '2026-08-08',
      hora_entrada: '01:48:00',
      hora_salida: null,
      horas_trabajadas: 0,
      horas_descanso: null,
      es_feriado: false,
      es_ausencia: false,
      estado_marcaje: 'entrada',
    }
    mock = installFetchMock([
      { match: '/registro_asistencia', method: 'GET', respond: [registro] },
      { match: '/nomina_periodos', respond: [] },
      { match: '/nomina_config_empleado', respond: [{ horas_jornada: 8 }] },
      { match: '/registro_asistencia', method: 'PATCH', respond: [{ ...registro, hora_entrada: '08:00', estado_marcaje: 'corregido' }] },
    ])

    const result = await readResponse(await H.handleCorregirMarcaje(makeRequest({
      registroId: IDS.registro,
      horaEntradaAnterior: '01:48',
      horaSalidaAnterior: null,
      horaEntrada: '08:00',
      horaSalida: null,
      motivo: 'Error de digitación',
    }), ENV))

    expect(result.status).toBe(200)
    const patch = mock.calls.find(call => call.method === 'PATCH')
    expect(patch.body).toMatchObject({ hora_entrada: '08:00', hora_salida: null, estado_marcaje: 'corregido' })
    expect(mock.calls.at(-1).url).toContain('&hora_salida=is.null')
    expect(registrarAuditoria).toHaveBeenCalledWith(ENV, expect.any(Object), expect.objectContaining({
      accion: 'CORREGIR_MARCAJE',
      meta: expect.objectContaining({
        motivo: 'Error de digitación',
        entrada: { antes: '01:48', despues: '08:00' },
        salida: { antes: null, despues: null },
      }),
    }))
  })

  it('corrige una jornada completada y recalcula horas trabajadas, normales y extra', async () => {
    mock = installFetchMock([
      { match: '/registro_asistencia', method: 'GET', respond: [{
        id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-07',
        hora_entrada: '08:00:00', hora_salida: '17:00:00', horas_trabajadas: 8,
        horas_descanso: 1, es_feriado: false, es_ausencia: false, estado_marcaje: 'completo',
      }] },
      { match: '/nomina_periodos', respond: [] },
      { match: '/nomina_config_empleado', respond: [{ horas_jornada: 8 }] },
      { match: '/registro_asistencia', method: 'PATCH', respond: [{
        id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-07',
        hora_entrada: '09:00', hora_salida: '18:00', horas_trabajadas: 8,
        horas_normales: 8, horas_extra: 0, estado_marcaje: 'corregido',
      }] },
    ])

    const result = await readResponse(await H.handleCorregirMarcaje(makeRequest({
      registroId: IDS.registro,
      horaEntradaAnterior: '08:00',
      horaSalidaAnterior: '17:00',
      horaEntrada: '09:00',
      horaSalida: '18:00',
      motivo: 'Hora verificada con supervisor',
    }), ENV))

    expect(result.status).toBe(200)
    const patch = mock.calls.find(call => call.method === 'PATCH')
    expect(patch.body).toMatchObject({
      hora_entrada: '09:00', hora_salida: '18:00', horas_descanso: 1,
      horas_trabajadas: 8, horas_normales: 8, horas_extra: 0, estado_marcaje: 'corregido',
    })
  })

  it('no permite convertir una salida pendiente en una salida marcada mediante corrección', async () => {
    mock = installFetchMock([{ match: '/registro_asistencia', method: 'GET', respond: [{
      id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-08',
      hora_entrada: '07:00:00', hora_salida: null, estado_marcaje: 'entrada',
    }] }])
    const result = await readResponse(await H.handleCorregirMarcaje(makeRequest({
      registroId: IDS.registro,
      horaEntradaAnterior: '07:00',
      horaSalidaAnterior: null,
      horaEntrada: '07:30',
      horaSalida: '17:00',
      motivo: 'Corregir entrada',
    }), ENV))
    expect(result.status).toBe(400)
    expect(mock.calls.some(call => call.method === 'PATCH')).toBe(false)
  })

  it('rechaza corrección si las horas cambiaron desde que se abrió el formulario', async () => {
    mock = installFetchMock([{ match: '/registro_asistencia', method: 'GET', respond: [{
      id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-08',
      hora_entrada: '08:15:00', hora_salida: null, estado_marcaje: 'entrada',
    }] }])
    const result = await readResponse(await H.handleCorregirMarcaje(makeRequest({
      registroId: IDS.registro,
      horaEntradaAnterior: '08:00',
      horaSalidaAnterior: null,
      horaEntrada: '08:30',
      horaSalida: null,
      motivo: 'Corregir hora',
    }), ENV))
    expect(result.status).toBe(409)
    expect(mock.calls.some(call => call.method === 'PATCH')).toBe(false)
  })

  it('rechaza una corrección sin motivo válido y una edición sin cambios', async () => {
    const registro = {
      id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-07', hora_entrada: '08:00:00',
      hora_salida: '17:00:00', horas_trabajadas: 8, es_ausencia: false, estado_marcaje: 'completo',
    }
    for (const body of [
      { registroId: IDS.registro, horaEntradaAnterior: '08:00', horaSalidaAnterior: '17:00', horaEntrada: '09:00', horaSalida: '17:00', motivo: '  ' },
      { registroId: IDS.registro, horaEntradaAnterior: '08:00', horaSalidaAnterior: '17:00', horaEntrada: '08:00', horaSalida: '17:00', motivo: 'Sin cambio' },
    ]) {
      mock = installFetchMock([{ match: '/registro_asistencia', method: 'GET', respond: [registro] }])
      const result = await readResponse(await H.handleCorregirMarcaje(makeRequest(body), ENV))
      expect(result.status).toBe(400)
      expect(mock.calls.some(call => call.method === 'PATCH')).toBe(false)
      mock.restore()
    }
  })

  it('rechaza roles sin capacidad de administración y no consulta datos', async () => {
    operadorActual = OPERADORES.logistica
    mock = installFetchMock([])
    const result = await readResponse(await H.handleCorregirMarcaje(makeRequest({
      registroId: IDS.registro,
      horaEntradaAnterior: '08:00',
      horaSalidaAnterior: null,
      horaEntrada: '09:00',
      horaSalida: null,
      motivo: 'Corrección válida',
    }), ENV))
    expect(result.status).toBe(403)
    expect(mock.calls).toHaveLength(0)
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
