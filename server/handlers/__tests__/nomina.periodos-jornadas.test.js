// server/handlers/__tests__/nomina.periodos-jornadas.test.js
// F-1: una jornada con entrada y sin salida no se paga y NO queda como ausencia.
// El período no se liquida (409 con la lista) hasta que el operador corrija el
// marcaje o confirme el cálculo con `confirmarJornadasAbiertas: true`.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(OPERADORES.administracion)),
}))
vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(async () => {}),
}))

const H = await import('../nomina.js')
const { registrarAuditoria } = await import('../../lib/audit.js')
let mock
afterEach(() => { mock?.restore(); vi.clearAllMocks() })

const periodoAbierto = { id: IDS.periodo, nombre: 'Semana 1', desde: '2026-08-03', hasta: '2026-08-09', estado: 'abierto' }
const jornadaAbierta = {
  empleado_id: IDS.empleado, fecha: '2026-08-03',
  horas_normales: 0, horas_extra: 0, es_sabado: false, es_domingo: false,
  es_feriado: false, es_ausencia: false, horas_trabajadas: 0,
  estado_marcaje: 'entrada', hora_entrada: '08:00:00', hora_salida: null,
}
const rutasLectura = [
  { match: '/nomina_periodos',        respond: [periodoAbierto] },
  { match: '/nomina_config_empleado', respond: [
    { empleado_id: IDS.empleado, cargo: 'Almacenista', salario_dia_usd: 30, horas_jornada: 8 },
  ]},
  { match: '/configuracion_negocio',  respond: [{}] },
  { match: '/registro_asistencia',    respond: [jornadaAbierta] },
  { match: '/nomina_lineas', method: 'GET', respond: [] },
]

describe('cálculo de período con jornadas abiertas', () => {
  it('responde 409 con el detalle y no escribe líneas', async () => {
    mock = installFetchMock([
      ...rutasLectura,
      { match: '/clientes', respond: [{ id: IDS.empleado, nombre: 'Edgar Ramirez' }] },
    ])
    const res = await H.handleCalcularPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const { status, body } = await readResponse(res)
    expect(status).toBe(409)
    expect(body.total_jornadas_abiertas).toBe(1)
    expect(body.jornadas_abiertas[0]).toMatchObject({
      empleado_id: IDS.empleado, empleado_nombre: 'Edgar Ramirez',
      fecha: '2026-08-03', hora_entrada: '08:00:00',
    })
    expect(String(body.error)).toMatch(/sin salida/i)
    expect(mock.calls.some(call => ['POST', 'DELETE'].includes(call.method))).toBe(false)
  })

  it('con confirmación explícita calcula sin pagar la jornada abierta y lo deja en auditoría', async () => {
    let insertadas = null
    mock = installFetchMock([
      ...rutasLectura,
      { match: '/nomina_lineas', method: 'POST', respond: (url, init) => {
        insertadas = JSON.parse(init.body); return []
      }},
    ])
    const res = await H.handleCalcularPeriodo(
      makeRequest({ periodoId: IDS.periodo, confirmarJornadasAbiertas: true }), ENV
    )
    const { status, body } = await readResponse(res)
    expect(status).toBe(200)
    expect(body.lineas_generadas).toBe(1)
    expect(insertadas[0]).toMatchObject({
      dias_trabajados: 0, dias_ausencia: 0, monto_normal_usd: 0, total_bruto_usd: 0,
    })
    expect(registrarAuditoria).toHaveBeenCalledWith(ENV, expect.anything(), expect.objectContaining({
      accion: 'CALCULAR_PERIODO',
      meta: expect.objectContaining({ jornadas_abiertas: 1 }),
    }))
  })

  it('sin jornadas abiertas el cálculo sigue sin confirmación', async () => {
    mock = installFetchMock([
      { ...rutasLectura[0] },
      { ...rutasLectura[1] },
      { ...rutasLectura[2] },
      { match: '/registro_asistencia', respond: [{ ...jornadaAbierta, estado_marcaje: 'completo', hora_salida: '17:00:00', horas_normales: 8 }] },
      { ...rutasLectura[4] },
      { match: '/nomina_lineas', method: 'POST', respond: [] },
    ])
    const { status } = await readResponse(await H.handleCalcularPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV))
    expect(status).toBe(200)
  })
})
