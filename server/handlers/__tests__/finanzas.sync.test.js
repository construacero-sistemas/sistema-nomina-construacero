// server/handlers/__tests__/finanzas.sync.test.js
// Pruebas unitarias para la sincronización de ventas POS hacia Finanzas y Carteras
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, SUPABASE_URL, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../finanzas.sync.js')
let mock

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

const posClosureResponse = {
  ok: true,
  fecha: '2026-08-30',
  origen: 'POS Construacero Cotizaciones',
  total_despachos: 5,
  ventas_contado_usd: 1500,
  cobros_cxc_usd: 500,
  devoluciones_usd: 0,
  total_ingresos_usd: 2000,
  desglose_pagos: {
    efectivo_usd: 1000,
    zelle_usd: 500,
    transferencia_ves: 0,
    pago_movil_ves: 0,
    punto_venta_ves: 0,
    otros_usd: 0,
  },
}

const testEnv = {
  ...ENV,
  POS_API_URL: `${SUPABASE_URL}/api/pos`,
}

describe('finanzas.sync — sincronización de ventas del POS hacia Carteras', () => {
  it('rechaza operadores sin rol de administración', async () => {
    operadorActual = OPERADORES.logistica
    mock = installFetchMock([])
    const response = await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30' }), testEnv)
    const result = await readResponse(response)
    expect(result.status).toBe(403)
    expect(result.body.error).toMatch(/administración/i)
  })

  it('retorna preview con los totales del POS sin alterar base de datos', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: posClosureResponse },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
    ])

    const response = await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30', confirm: false }), testEnv)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(result.body.preview).toBe(true)
    expect(result.body.posData.total_ingresos_usd).toBe(2000)
    expect(result.body.posData.ventas_contado_usd).toBe(1500)
    expect(result.body.posData.cobros_cxc_usd).toBe(500)
    expect(result.body.tienePrevio).toBe(false)
  })

  it('registra los ingresos en las subcuentas y carteras correctas cuando confirm=true', async () => {
    let movimientosCreados = []
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: posClosureResponse },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      {
        match: '/finanzas_movimientos',
        method: 'POST',
        respond: (url, init) => {
          const body = JSON.parse(init.body)
          movimientosCreados.push(body)
          return [{ id: IDS.linea, ...body, estado: 'activo' }]
        },
      },
    ])

    const response = await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30', confirm: true }), testEnv)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(result.body.synced).toBe(true)
    expect(result.body.total_ingresos_usd).toBe(2000)
    expect(movimientosCreados).toHaveLength(3) // Efectivo $, Zelle, CxC

    // 1. Efectivo $
    expect(movimientosCreados[0].categoria).toBe('Ventas')
    expect(movimientosCreados[0].monto).toBe(1000)
    expect(movimientosCreados[0].referencia).toBe('Efectivo $ · POS-2026-08-30')

    // 2. Zelle
    expect(movimientosCreados[1].categoria).toBe('Ventas')
    expect(movimientosCreados[1].monto).toBe(500)
    expect(movimientosCreados[1].referencia).toBe('Zelle · POS-2026-08-30')

    // 3. CxC
    expect(movimientosCreados[2].categoria).toBe('Cobros de clientes')
    expect(movimientosCreados[2].monto).toBe(500)
    expect(movimientosCreados[2].referencia).toBe('Transferencia · POS-CXC-2026-08-30')
  })

  it('actualiza los registros existentes si se vuelve a sincronizar (idempotencia y resincronización)', async () => {
    let patches = []
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: { ...posClosureResponse, desglose_pagos: { efectivo_usd: 1200, zelle_usd: 600 } } },
      {
        match: 'idempotency_key=eq.',
        method: 'GET',
        respond: (url) => {
          if (url.includes('pos-vta-efectivo-usd')) return [{ id: IDS.linea, monto: 1000, categoria: 'Ventas' }]
          if (url.includes('pos-vta-zelle-usd')) return [{ id: IDS.concepto, monto: 500, categoria: 'Ventas' }]
          if (url.includes('pos-cxc')) return [{ id: IDS.periodo, monto: 500, categoria: 'Cobros de clientes' }]
          return []
        },
      },
      {
        match: '/finanzas_movimientos',
        method: 'PATCH',
        respond: (url, init) => {
          const body = JSON.parse(init.body)
          patches.push(body)
          return [{ id: IDS.linea, ...body, estado: 'activo' }]
        },
      },
    ])

    const response = await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30', confirm: true }), testEnv)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(patches.length).toBeGreaterThanOrEqual(2)
    expect(patches[0].monto).toBe(1200)
  })

  it('soporta rangos de fecha para sincronización por período (Semana / Mes)', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: posClosureResponse },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
    ])

    const response = await H.handleSyncVentasPos(
      makeRequest({ desde: '2026-08-28', hasta: '2026-08-30', confirm: false }),
      testEnv
    )
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(result.body.preview).toBe(true)
    expect(result.body.posData.dias).toHaveLength(3)
    expect(result.body.posData.total_ingresos_usd).toBe(6000) // 2000 x 3 días
  })

  it('maneja errores de conexión con el POS limpiamente', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: { __raw: 'Internal Server Error', status: 500, ok: false } },
    ])

    const response = await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30', confirm: false }), testEnv)
    const result = await readResponse(response)

    expect(result.status).toBe(502)
    expect(result.body.error).toMatch(/POS/i)
  })
})

