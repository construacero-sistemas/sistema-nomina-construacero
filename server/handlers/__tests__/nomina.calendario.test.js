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

describe('calendario laboral de nómina', () => {
  it('logística puede consultar feriados en un rango acotado', async () => {
    mock = installFetchMock([{ match: '/nomina_feriados', respond: [{ fecha: '2026-08-08', nombre: 'Feriado' }] }])
    const req = makeRequest(undefined, {
      url: 'http://worker.test/api/nomina/calendario/feriados?desde=2026-08-01&hasta=2026-08-31',
    })
    const res = await H.handleGetFeriados(req, ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body).toHaveLength(1)
    expect(mock.calls[0].url).toContain(`cuenta_id=eq.${OPERADORES.administracion.cuenta_id}`)
  })

  it('rechaza un rango de calendario mayor a 31 días', async () => {
    mock = installFetchMock([])
    const req = makeRequest(undefined, {
      url: 'http://worker.test/api/nomina/calendario/feriados?desde=2026-01-01&hasta=2026-03-01',
    })
    const res = await H.handleGetFeriados(req, ENV)
    expect((await readResponse(res)).status).toBe(400)
    expect(mock.calls).toHaveLength(0)
  })

  it('administración crea un feriado con cuenta y actor', async () => {
    operadorActual = OPERADORES.administracion
    mock = installFetchMock([{ match: '/nomina_feriados', method: 'POST', respond: [{ id: IDS.registro }] }])
    const res = await H.handleCrearFeriado(makeRequest({
      fecha: '2026-12-24', nombre: 'Feriado empresa', tipo: 'empresa', laborable: false,
    }), ENV)
    expect((await readResponse(res)).status).toBe(201)
    expect(mock.calls[0].body.cuenta_id).toBe(OPERADORES.administracion.cuenta_id)
    expect(mock.calls[0].body.creado_por).toBe(OPERADORES.administracion.id)
  })

  it('rechaza marcar un feriado que no existe en el calendario', async () => {
    operadorActual = OPERADORES.administracion
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [] },
      { match: '/nomina_feriados', respond: [] },
    ])
    const res = await H.handleRegistrarAsistencia(makeRequest({
      empleadoId: IDS.empleado, fecha: '2026-12-24', horaEntrada: '08:00', horaSalida: '17:00', esFeriado: true,
    }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/calendario/i)
  })

  it('administración crea un horario de sábado rotativo', async () => {
    operadorActual = OPERADORES.administracion
    mock = installFetchMock([
      { match: '/clientes', method: 'GET', respond: [{ id: IDS.empleado, tipo_cliente: 'personal' }] },
      { match: '/nomina_horarios', method: 'POST', respond: [{ id: IDS.registro }] },
    ])
    const res = await H.handleCrearHorario(makeRequest({
      empleadoId: IDS.empleado, diaSemana: 6, semanaCiclo: 2, grupoRotacion: 'A',
      fechaDesde: '2026-08-01', horaInicio: '08:00', horaFin: '12:00', horasJornada: 4,
    }), ENV)
    expect((await readResponse(res)).status).toBe(201)
    const post = mock.calls.find(call => call.method === 'POST' && call.url.includes('/nomina_horarios'))
    expect(post.body.semana_ciclo).toBe(2)
    expect(post.body.dia_semana).toBe(6)
  })
})
