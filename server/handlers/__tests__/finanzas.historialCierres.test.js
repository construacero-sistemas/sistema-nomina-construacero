// server/handlers/__tests__/finanzas.historialCierres.test.js
// El historial devuelve solo los meses cerrados, con tenant de sesión y rango acotado.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion
vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
}))

const M = await import('../finanzas.periodos.js')
let mock

afterEach(() => { mock?.restore(); operadorActual = OPERADORES.administracion })

const pedir = meses => M.handleGetFinanzasHistorialCierres(
  makeRequest(undefined, { url: `http://worker.test/api/finanzas/periodos-mensuales/historial${meses != null ? `?meses=${meses}` : ''}` }), ENV)

describe('finanzas — historial de cierres mensuales', () => {
  it('devuelve solo los períodos cerrados y consulta con el tenant del operador', async () => {
    let llamada = 0
    mock = installFetchMock([{
      match: '/rpc/finanzas_periodo_mensual_estado',
      method: 'POST',
      respond: () => {
        llamada += 1
        return { schemaVersion: 1, estado: llamada === 2 ? 'cerrado' : 'abierto', mes: `m${llamada}`, cuentas: [] }
      },
    }])
    const { status, body } = await readResponse(await pedir(3))
    expect(status).toBe(200)
    expect(body.cierres).toEqual([{ schemaVersion: 1, estado: 'cerrado', mes: 'm2', cuentas: [] }])
    expect(mock.calls).toHaveLength(3)
    mock.calls.forEach(call => expect(call.body.p_cuenta_id).toBe(OPERADORES.administracion.cuenta_id))
  })

  it('rechaza rangos inválidos y roles sin gestión antes de consultar', async () => {
    mock = installFetchMock([])
    expect((await readResponse(await pedir(0))).status).toBe(400)
    expect((await readResponse(await pedir(99))).status).toBe(400)
    operadorActual = OPERADORES.finanzas
    expect((await readResponse(await pedir(3))).status).toBe(403)
    expect(mock.calls).toHaveLength(0)
  })

  it('el detalle del cierre pagina todos los movimientos vigentes (sin anulados) y exige mes cerrado', async () => {
    const fila = n => ({ id: `m${n}`, fecha: '2026-10-05', tipo: 'ingreso', monto: '1', moneda: 'USD', tasa_ves: '1', estado: 'activo' })
    const paginas = [Array.from({ length: 100 }, (_, i) => fila(i + 1)), [fila(101)]]
    let pagina = 0
    mock = installFetchMock([
      { match: '/rpc/finanzas_periodo_mensual_estado', method: 'POST', respond: { schemaVersion: 1, estado: 'cerrado', mes: '2026-10-01', hasta: '2026-10-31', cuentas: [] } },
      { match: '/rpc/finanzas_movimientos_pagina', method: 'POST', respond: () => ({ movimientos: paginas[pagina++] }) },
    ])
    const request = makeRequest(undefined, { url: 'http://worker.test/api/finanzas/periodos-mensuales/movimientos?mes=2026-10-01' })
    const { status, body } = await readResponse(await M.handleGetFinanzasMovimientosCierre(request, ENV))
    expect(status).toBe(200)
    expect(body.movimientos).toHaveLength(101)
    const consultas = mock.calls.filter(call => call.url.includes('finanzas_movimientos_pagina')).map(call => call.body)
    expect(consultas).toHaveLength(2)
    expect(consultas[0]).toMatchObject({ p_desde: '2026-10-01', p_hasta: '2026-10-31', p_anulados: false, p_offset: 0, p_cuenta_id: OPERADORES.administracion.cuenta_id })
    expect(consultas[1].p_offset).toBe(100)
  })

  it('el detalle rechaza meses abiertos y meses inválidos', async () => {
    mock = installFetchMock([{ match: '/rpc/finanzas_periodo_mensual_estado', method: 'POST', respond: { schemaVersion: 1, estado: 'abierto', mes: '2026-10-01', cuentas: [] } }])
    const url = mes => makeRequest(undefined, { url: `http://worker.test/api/finanzas/periodos-mensuales/movimientos?mes=${mes}` })
    expect((await readResponse(await M.handleGetFinanzasMovimientosCierre(url('2026-10-01'), ENV))).status).toBe(409)
    expect((await readResponse(await M.handleGetFinanzasMovimientosCierre(url('2026-13-01'), ENV))).status).toBe(400)
  })
})
