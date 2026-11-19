// server/handlers/__tests__/nomina.autocalculo.test.js
// Cálculo automático al abrir un período abierto (soloSiCambio).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ENV, OPERADORES, IDS, makeRequest, readResponse, installFetchMock, authOk } from './_harness'
vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(OPERADORES.administracion)),
}))
vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(async () => {}),
}))
const H = await import('../nomina.js')
let mock
afterEach(() => { mock?.restore(); vi.clearAllMocks() })

// Mejora del 19/11/2026: al abrir un período abierto se recalcula solo, pero solo
// guarda (y audita) si algún recibo sin pagar cambió.
describe('cálculo automático (soloSiCambio)', () => {
  const periodo = { id: IDS.periodo, nombre: 'Semana 1', desde: '2026-08-03', hasta: '2026-08-09', estado: 'abierto' }
  const asistencia = [
    { empleado_id: IDS.empleado, fecha: '2026-08-03', horas_normales: 8, horas_extra: 0, es_sabado: false, es_feriado: false, es_ausencia: false },
  ]
  function rutas(guardadas, onPost) {
    return [
      { match: '/nomina_periodos', respond: [periodo] },
      { match: '/nomina_config_empleado', respond: [{ empleado_id: IDS.empleado, cargo: 'Almacenista', salario_dia_usd: 30, horas_jornada: 8 }] },
      { match: '/nomina_horarios', respond: [] },
      { match: '/nomina_feriados', respond: [] },
      { match: '/configuracion_negocio', respond: [{ nomina_descanso_remunerado: false }] },
      { match: '/registro_asistencia', respond: asistencia },
      { match: '/nomina_lineas', method: 'GET', respond: guardadas },
      { match: '/nomina_lineas', method: 'DELETE', respond: [] },
      { match: '/nomina_lineas', method: 'POST', respond: (url, init) => { onPost(JSON.parse(init.body)); return [] } },
    ]
  }

  it('si nada cambió no escribe y responde sin_cambios', async () => {
    let primera = null
    mock = installFetchMock(rutas([], filas => { primera = filas }))
    await H.handleCalcularPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV)
    const guardadas = primera.map(fila => ({ ...fila, pagado: false }))
    mock.restore()

    let escrito = false
    mock = installFetchMock(rutas(guardadas, () => { escrito = true }))
    const { status, body } = await readResponse(await H.handleCalcularPeriodo(makeRequest({ periodoId: IDS.periodo, soloSiCambio: true }), ENV))
    expect(status).toBe(200)
    expect(body.sin_cambios).toBe(true)
    expect(escrito).toBe(false)
  })

  it('si la asistencia cambió, guarda los recibos nuevos', async () => {
    const guardadas = [{ empleado_id: IDS.empleado, pagado: false, monto_normal_usd: 0, total_bruto_usd: 0, total_neto_usd: 0, dias_trabajados: 0 }]
    let insertadas = null
    mock = installFetchMock(rutas(guardadas, filas => { insertadas = filas }))
    const { status, body } = await readResponse(await H.handleCalcularPeriodo(makeRequest({ periodoId: IDS.periodo, soloSiCambio: true }), ENV))
    expect(status).toBe(200)
    expect(body.sin_cambios).toBeUndefined()
    expect(insertadas[0]).toMatchObject({ dias_trabajados: 1, monto_normal_usd: 30 })
  })

  it('un período sin recibos todavía se calcula (la hoja se llena sola)', async () => {
    let insertadas = null
    mock = installFetchMock(rutas([], filas => { insertadas = filas }))
    const { body } = await readResponse(await H.handleCalcularPeriodo(makeRequest({ periodoId: IDS.periodo, soloSiCambio: true }), ENV))
    expect(body.lineas_generadas).toBe(1)
    expect(insertadas).toHaveLength(1)
  })
})
