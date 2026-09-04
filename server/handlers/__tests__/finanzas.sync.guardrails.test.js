// server/handlers/__tests__/finanzas.sync.guardrails.test.js
// Pruebas unitarias de guardarraíles matemáticos, anti-poisoning de monedas y auditoría forense
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, SUPABASE_URL, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion
const auditoriaSpy = vi.fn(async () => {})

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
}))
vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: (...args) => auditoriaSpy(...args),
}))

const H = await import('../finanzas.sync.js')
let mock

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

const posClosureBase = {
  ok: true,
  fecha: '2026-08-30',
  total_despachos: 4,
  ventas_contado_usd: 1200,
  cobros_cxc_usd: 0,
  total_ingresos_usd: 1200,
  tasa_bcv: 50,
  desglose_pagos: {
    efectivo_usd: 200,
    pago_movil_ves: 50000,
    zelle_usd: 0,
    usdt_usd: 0,
    efectivo_ves: 0,
    transferencia_ves: 0,
    punto_venta_ves: 0,
    otros_usd: 0,
  },
  despachos_detalle: [
    { id: 'DSP-001', metodo_clave: 'pago_movil_ves', monto_ves: 30000, monto_usd: 600, cliente: 'Cliente A' },
    { id: 'DSP-002', metodo_clave: 'pago_movil_ves', monto_ves: 20000, monto_usd: 400, cliente: 'Cliente B' },
    { id: 'DSP-003', metodo_clave: 'efectivo_usd', monto_ves: 10000, monto_usd: 200, cliente: 'Cliente C' },
  ],
}

const mockCuentasCustodia = [
  { id: 'cta-ves-1', nombre: 'Banesco Principal', moneda: 'VES' },
  { id: 'cta-ves-2', nombre: 'Banco Venezuela', moneda: 'VES' },
  { id: 'cta-usd-1', nombre: 'Caja Boveda USD', moneda: 'USD' },
  { id: 'cta-usdt-1', nombre: 'Binance USDT', moneda: 'USDT' },
]

const testEnv = {
  ...ENV,
  POS_API_URL: `${SUPABASE_URL}/api/pos`,
}

describe('finanzas.sync — Guardarraíles y Red de Seguridad', () => {
  it('rechaza con 400 si la suma de los tramos divididos no cuadra con el monto (descuadre matemático)', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: posClosureBase },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      { match: '/cuentas_custodia', method: 'GET', respond: mockCuentasCustodia },
    ])

    const response = await H.handleSyncVentasPos(
      makeRequest({
        fecha: '2026-08-30',
        confirm: true,
        distribucion: {
          pago_movil_ves: {
            activo: true,
            partes: [
              { cuenta_origen: 'Banesco Principal', monto: 30000 },
              { cuenta_origen: 'Banco Venezuela', monto: 15000 },
            ],
          },
        },
      }),
      testEnv
    )
    const result = await readResponse(response)

    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/Descuadre.*pago_movil_ves/i)
  })

  it('rechaza con 400 si algún tramo tiene un monto negativo o igual a 0', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: posClosureBase },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      { match: '/cuentas_custodia', method: 'GET', respond: mockCuentasCustodia },
    ])

    const response = await H.handleSyncVentasPos(
      makeRequest({
        fecha: '2026-08-30',
        confirm: true,
        distribucion: {
          pago_movil_ves: {
            activo: true,
            partes: [
              { cuenta_origen: 'Banesco Principal', monto: 50000 },
              { cuenta_origen: 'Banco Venezuela', monto: 0 },
            ],
          },
        },
      }),
      testEnv
    )
    const result = await readResponse(response)

    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/monto.*inv/i)
  })

  it('rechaza con 400 si algún tramo no tiene cuenta de custodia asignada', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: posClosureBase },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      { match: '/cuentas_custodia', method: 'GET', respond: mockCuentasCustodia },
    ])

    const response = await H.handleSyncVentasPos(
      makeRequest({
        fecha: '2026-08-30',
        confirm: true,
        distribucion: {
          pago_movil_ves: {
            activo: true,
            partes: [
              { cuenta_origen: 'Banesco Principal', monto: 30000 },
              { cuenta_origen: '', monto: 20000 },
            ],
          },
        },
      }),
      testEnv
    )
    const result = await readResponse(response)

    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/no tiene una cuenta de custodia asignada/i)
  })

  it('rechaza con 400 si se intenta asignar un método VES a una cuenta USD (anti-poisoning)', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: posClosureBase },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      { match: '/cuentas_custodia', method: 'GET', respond: mockCuentasCustodia },
    ])

    const response = await H.handleSyncVentasPos(
      makeRequest({
        fecha: '2026-08-30',
        confirm: true,
        distribucion: {
          pago_movil_ves: {
            activo: true,
            cuenta_origen: 'Caja Boveda USD',
          },
        },
      }),
      testEnv
    )
    const result = await readResponse(response)

    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/Incompatibilidad de moneda/i)
    expect(result.body.error).toMatch(/VES/i)
  })

  it('rechaza con 400 si se intenta asignar un método USD a una cuenta VES (anti-poisoning)', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: posClosureBase },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      { match: '/cuentas_custodia', method: 'GET', respond: mockCuentasCustodia },
    ])

    const response = await H.handleSyncVentasPos(
      makeRequest({
        fecha: '2026-08-30',
        confirm: true,
        distribucion: {
          efectivo_usd: {
            activo: true,
            cuenta_origen: 'Banesco Principal',
          },
        },
      }),
      testEnv
    )
    const result = await readResponse(response)

    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/Incompatibilidad de moneda/i)
    expect(result.body.error).toMatch(/Banesco Principal/i)
  })

  it('registra despachos_excluidos en la auditoría forense cuando se desmarcan despachos específicos', async () => {
    let creados = []
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: posClosureBase },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      { match: '/cuentas_custodia', method: 'GET', respond: mockCuentasCustodia },
      {
        match: '/finanzas_movimientos',
        method: 'POST',
        respond: (url, init) => {
          const body = JSON.parse(init.body)
          creados.push(body)
          return [{ id: IDS.linea, ...body, estado: 'activo' }]
        },
      },
    ])

    const response = await H.handleSyncVentasPos(
      makeRequest({
        fecha: '2026-08-30',
        confirm: true,
        distribucion: {
          pago_movil_ves: {
            activo: true,
            cuenta_origen: 'Banesco Principal',
            excluidos: ['DSP-002'],
          },
          efectivo_usd: {
            activo: false,
          },
        },
      }),
      testEnv
    )
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(creados).toHaveLength(1)
    expect(creados[0].monto).toBe(30000)

    expect(auditoriaSpy).toHaveBeenCalled()
    const lastCall = auditoriaSpy.mock.calls[auditoriaSpy.mock.calls.length - 1]
    const auditData = lastCall[2]
    expect(auditData.meta.despachos_excluidos).toEqual(['DSP-002'])
  })
})
