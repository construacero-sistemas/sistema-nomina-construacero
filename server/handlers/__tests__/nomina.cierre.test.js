// server/handlers/__tests__/nomina.cierre.test.js
// Regla del usuario (19/11/2026): al cerrar el período se marcan todos los recibos
// como pagados (sin pago aparte ni forma de pago). Antes de cerrar se ponen al día
// con la asistencia; con jornadas sin salida no se cierra. Migración 269.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ENV, OPERADORES, IDS, makeRequest, readResponse, installFetchMock, authOk } from './_harness'
vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(OPERADORES.administracion)),
}))
const registrarAuditoria = vi.fn(async () => {})
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: (...a) => registrarAuditoria(...a) }))
const H = await import('../nomina.js')
let mock
afterEach(() => { mock?.restore(); vi.clearAllMocks() })

const RPC = '/rpc/nomina_cerrar_marcar_pagado'
const abierto = { id: IDS.periodo, nombre: 'Semana 1', desde: '2026-08-03', hasta: '2026-08-09', estado: 'abierto' }
const empleado = { empleado_id: IDS.empleado, cargo: 'Almacenista', salario_dia_usd: 30, horas_jornada: 8 }

function rutasAbierto({ asistencia = [], rpc = { recibos_marcados: 1 } } = {}) {
  return [
    { match: '/nomina_periodos', respond: [abierto] },
    { match: '/nomina_config_empleado', respond: [empleado] },
    { match: '/nomina_horarios', respond: [] },
    { match: '/nomina_feriados', respond: [] },
    { match: '/configuracion_negocio', respond: [{ nomina_descanso_remunerado: false }] },
    { match: '/registro_asistencia', respond: asistencia },
    { match: '/clientes', respond: [] },
    { match: '/nomina_lineas', method: 'GET', respond: [] },
    { match: '/nomina_lineas', method: 'POST', respond: [] },
    { match: '/nomina_lineas', method: 'DELETE', respond: [] },
    { match: '/nomina_tasas_snapshot', method: 'POST', respond: [] },
    { match: RPC, method: 'POST', respond: rpc },
  ]
}

describe('cerrar = marcar todo pagado', () => {
  it('pone los recibos al día y luego cierra y marca pagado en una sola operación', async () => {
    mock = installFetchMock(rutasAbierto())
    const { status, body } = await readResponse(await H.handleCerrarPeriodo(makeRequest({ periodoId: IDS.periodo, tasas: { usd: 900 } }), ENV))
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, pagado: true, recibos_marcados: 1, tasa_congelada: true })
    const indiceCalculo = mock.calls.findIndex(c => c.method === 'POST' && c.url.includes('/nomina_lineas'))
    const indiceCierre = mock.calls.findIndex(c => c.url.includes(RPC))
    expect(indiceCalculo).toBeGreaterThanOrEqual(0)
    expect(indiceCalculo).toBeLessThan(indiceCierre)
    expect(mock.calls[indiceCierre].body).toMatchObject({
      p_cuenta_id: OPERADORES.administracion.cuenta_id, p_operador_id: OPERADORES.administracion.id,
      p_periodo_id: IDS.periodo, p_accion: 'cerrar', p_tasa_usd_ves: 900,
    })
    // Nunca se usa el viejo cierre que dejaba el período «cerrado» sin pagar.
    expect(mock.calls.some(c => c.method === 'PATCH' && c.url.includes('/nomina_periodos'))).toBe(false)
    expect(registrarAuditoria).toHaveBeenCalledWith(ENV, expect.anything(), expect.objectContaining({ accion: 'CERRAR_PERIODO_MARCAR_PAGADO' }))
  })

  it('acepta tasaPago explícita y fuenteTasaPago MANUAL, la congela en snapshot y la pasa al RPC', async () => {
    mock = installFetchMock(rutasAbierto())
    const { status, body } = await readResponse(await H.handleCerrarPeriodo(
      makeRequest({ periodoId: IDS.periodo, tasaPago: 465.25, fuenteTasaPago: 'MANUAL' }),
      ENV,
    ))
    expect(status).toBe(200)
    expect(body.tasa_congelada).toBe(true)
    const snapCall = mock.calls.find(c => c.method === 'POST' && c.url.includes('/nomina_tasas_snapshot'))
    expect(snapCall.body[0]).toMatchObject({ fuente: 'MANUAL', valor: 465.25 })
    const rpcCall = mock.calls.find(c => c.url.includes(RPC))
    expect(rpcCall.body.p_tasa_usd_ves).toBe(465.25)
  })

  it('con jornadas sin salida no cierra y devuelve el 409 del cálculo', async () => {
    mock = installFetchMock(rutasAbierto({ asistencia: [
      { empleado_id: IDS.empleado, fecha: '2026-08-03', hora_entrada: '08:00', hora_salida: null, estado_marcaje: 'entrada', es_ausencia: false },
    ] }))
    const { status, body } = await readResponse(await H.handleCerrarPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV))
    expect(status).toBe(409)
    expect(body.total_jornadas_abiertas).toBe(1)
    expect(mock.calls.some(c => c.url.includes(RPC))).toBe(false)
  })

  it('traduce el rechazo de la base (sin recibos) a un mensaje claro', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ ...abierto, estado: 'cerrado' }] },
      { match: RPC, method: 'POST', respond: { __raw: '{"message":"Period has no receipts"}', ok: false, status: 409 } },
    ])
    const { status, body } = await readResponse(await H.handleCerrarPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV))
    expect(status).toBe(409)
    expect(String(body.error)).toMatch(/no tiene recibos/i)
  })

  it('un período ya pagado no se vuelve a cerrar', async () => {
    mock = installFetchMock([{ match: '/nomina_periodos', respond: [{ ...abierto, estado: 'pagado' }] }])
    const { status, body } = await readResponse(await H.handleCerrarPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV))
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/ya está cerrado y pagado/i)
  })
})

describe('reabrir un período cerrado y pagado', () => {
  it('deshace la marca de pagado con la operación de la base', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ ...abierto, estado: 'pagado' }] },
      { match: RPC, method: 'POST', respond: { recibos_desmarcados: 3 } },
    ])
    const { status, body } = await readResponse(await H.handleReabrirPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV))
    expect(status).toBe(200)
    expect(body.recibos_desmarcados).toBe(3)
    expect(mock.calls.find(c => c.url.includes(RPC)).body.p_accion).toBe('reabrir')
  })

  it('no reabre si hay pagos registrados en Finanzas', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ ...abierto, estado: 'pagado' }] },
      { match: RPC, method: 'POST', respond: { __raw: '{"message":"Period has payments recorded in Finanzas; revert them first"}', ok: false, status: 409 } },
    ])
    const { status, body } = await readResponse(await H.handleReabrirPeriodo(makeRequest({ periodoId: IDS.periodo }), ENV))
    expect(status).toBe(409)
    expect(String(body.error)).toMatch(/revierte esos pagos/i)
  })
})
