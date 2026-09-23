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
  tasa_bcv: 50,
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
  const incoming = (extra = {}) => ({ ...posClosureResponse, cobros_cxc_usd: 0,
    desglose_pagos: { efectivo_usd: 100 }, ...extra })
  const writes = () => mock.calls.filter(call => call.method !== 'GET')
  const stored = body => ({ id: IDS.linea, ...body, monto_ves: body.monto * body.tasa_ves,
    tasa_registrada_en: '2026-08-30T12:00:00Z', estado: 'activo' })

  it.each([null, undefined, 0, -1, 'NaN', 'Infinity', true, '', ' ', 1000001])('rechaza tasa diaria inválida %s sin escribir', async tasa_bcv => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', respond: incoming({ tasa_bcv }) },
      { match: 'idempotency_key=eq.', respond: [] },
    ])
    const result = await readResponse(await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30', confirm: true }), testEnv))
    expect(result.status).toBe(422)
    expect(result.body.error).toMatch(/tasa.*cierre/)
    expect(writes()).toHaveLength(0)
  })

  it('no toma una tasa de otro día ni escribe la primera fecha de un lote inválido', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', respond: url => incoming({ tasa_bcv: url.includes('2026-08-29') ? 50 : null }) },
      { match: 'idempotency_key=eq.', respond: [] },
    ])
    const result = await readResponse(await H.handleSyncVentasPos(makeRequest({ desde: '2026-08-29', hasta: '2026-08-30', confirm: true }), testEnv))
    expect(result.status).toBe(422)
    expect(writes()).toHaveLength(0)
  })

  it('rechaza unidades USDT ambiguas antes de guardar otros métodos', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', respond: incoming({ desglose_pagos: { efectivo_usd: 100, usdt_usd: 25 } }) },
      { match: 'idempotency_key=eq.', respond: [] },
    ])
    const result = await readResponse(await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30', confirm: true }), testEnv))
    expect(result.status).toBe(422)
    expect(result.body.error).toMatch(/USDT.*USD/)
    expect(writes()).toHaveLength(0)
  })

  it('calcula 10000 VES como 200 USD con el snapshot, no con la tasa nativa 1', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', respond: incoming({ desglose_pagos: { pago_movil_ves: 10000 } }) },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      { match: '/finanzas_movimientos', method: 'POST', respond: (_url, init) => [stored(JSON.parse(init.body))] },
    ])
    const result = await readResponse(await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30', confirm: true }), testEnv))
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ total_ingresos_usd: 200, movimientos_sin_usd: 0 })
    expect(result.body.resultados[0].movimiento).toMatchObject({ monto: 10000, tasa_ves: 1, tasa_usd_ves: 50 })
  })

  it('una respuesta guardada sin procedencia no fabrica el total del POS', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', respond: incoming({ desglose_pagos: { pago_movil_ves: 10000 } }) },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      { match: '/finanzas_movimientos', method: 'POST', respond: (_url, init) => [{ ...stored(JSON.parse(init.body)), tasa_registrada_en: null }] },
    ])
    const result = await readResponse(await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30', confirm: true }), testEnv))
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ total_ingresos_usd: null, movimientos_sin_usd: 1 })
  })

  it('cero importado es cero aunque el POS tenga ventas desmarcadas', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', respond: incoming({ tasa_bcv: null }) },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      { match: '/cuentas_custodia', method: 'GET', respond: [] },
    ])
    const result = await readResponse(await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30', confirm: true, distribucion: { efectivo_usd: { activo: false } } }), testEnv))
    expect(result.status).toBe(200)
    expect(result.body.total_ingresos_usd).toBe(0)
    expect(writes()).toHaveLength(0)
  })

  it.each(['POST', 'PATCH'])('fallo %s no provoca escritura degradada sin metadatos', async method => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', respond: incoming() },
      { match: 'idempotency_key=eq.', method: 'GET', respond: method === 'PATCH' ? [stored({ moneda: 'USD', monto: 100 })] : [] },
      { match: '/finanzas_movimientos', method, respond: { __raw: { code: 'PGRST204' }, status: 400, ok: false } },
    ])
    const result = await readResponse(await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30', confirm: true }), testEnv))
    expect(result.status).toBe(500)
    expect(writes()).toHaveLength(1)
    expect(writes()[0].body).toMatchObject({ tasa_usd_ves: 50, metodo_pago: 'Efectivo $' })
  })

  it('no escribe cuando falla la consulta de idempotencia', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', respond: incoming() },
      { match: 'idempotency_key=eq.', method: 'GET', respond: { __raw: {}, ok: false, status: 503 } },
    ])
    const result = await readResponse(await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30', confirm: true }), testEnv))
    expect(result.status).toBe(500)
    expect(writes()).toHaveLength(0)
  })

  it('no afirma éxito si la base devuelve una lista vacía tras guardar', async () => {
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', respond: incoming() },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      { match: '/finanzas_movimientos', method: 'POST', respond: [] },
    ])
    const result = await readResponse(await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30', confirm: true }), testEnv))
    expect(result.status).toBe(500)
    expect(result.body.error).toMatch(/respuesta no confirma/)
    expect(writes()).toHaveLength(1)
  })
  it('rechaza roles sin capacidad de gestión (logistica y finanzas)', async () => {
    // Sincronizar POS toca el libro y el cierre del día: solo gestión (jefe/admin).
    for (const rol of ['logistica', 'finanzas']) {
      operadorActual = OPERADORES[rol]
      mock = installFetchMock([])
      const response = await H.handleSyncVentasPos(makeRequest({ fecha: '2026-08-30' }), testEnv)
      const result = await readResponse(response)
      expect(result.status).toBe(403)
    }
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
          return [{ id: IDS.linea, ...body, moneda: body.moneda || 'USD', monto_ves: body.monto * body.tasa_ves, tasa_registrada_en: '2026-08-30T12:00:00Z', estado: 'activo' }]
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
          if (url.includes('pos-vta-efectivo-usd')) return [{ id: IDS.linea, monto: 1000, categoria: 'Ventas', moneda: 'USD', estado: 'activo' }]
          if (url.includes('pos-vta-zelle-usd')) return [{ id: IDS.linea2, monto: 500, categoria: 'Ventas', moneda: 'USD', estado: 'activo' }]
          if (url.includes('pos-cxc')) return [{ id: IDS.periodo, monto: 500, categoria: 'Cobros de clientes', moneda: 'USD', estado: 'activo' }]
          return []
        },
      },
      {
        match: '/finanzas_movimientos',
        method: 'PATCH',
        respond: (url, init) => {
          const body = JSON.parse(init.body)
          patches.push(body)
          return [{ id: new URL(url).searchParams.get('id').slice(3), ...body, moneda: 'USD', monto_ves: body.monto * body.tasa_ves, tasa_registrada_en: '2026-08-30T12:00:00Z', estado: 'activo' }]
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

  it('respeta la selección y omite métodos marcados como activo: false en la distribución', async () => {
    let creados = []
    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: posClosureResponse },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      {
        match: '/finanzas_movimientos',
        method: 'POST',
        respond: (url, init) => {
          const body = JSON.parse(init.body)
          creados.push(body)
          return [{ id: IDS.linea, ...body, moneda: body.moneda || 'USD', monto_ves: body.monto * body.tasa_ves, tasa_registrada_en: '2026-08-30T12:00:00Z', estado: 'activo' }]
        },
      },
    ])

    // Desactivamos Zelle y CxC, solo dejamos Efectivo $
    const response = await H.handleSyncVentasPos(
      makeRequest({
        fecha: '2026-08-30',
        confirm: true,
        distribucion: {
          efectivo_usd: { activo: true, cuenta_origen: 'Caja Efectivo $' },
          zelle_usd: { activo: false },
          cxc: { activo: false },
        },
      }),
      testEnv
    )
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(creados).toHaveLength(1)
    expect(creados[0].metodo_pago).toBe('Efectivo $')
    expect(creados[0].cuenta_origen).toBe('Caja Efectivo $')
    expect(creados[0].concepto).toBe('Ventas POS en Efectivo $ (Caja Efectivo $) - 2026-08-30')
    expect(result.body.total_ingresos_usd).toBe(1000)
  })

  it('divide un método entre múltiples cuentas bancarias en partes con cuenta_origen y referencias distintas', async () => {
    let creados = []
    const posConPagoMovil = {
      ...posClosureResponse,
      desglose_pagos: {
        ...posClosureResponse.desglose_pagos,
        pago_movil_ves: 10000,
        efectivo_usd: 0,
        zelle_usd: 0,
      },
      ventas_contado_usd: 200,
      cobros_cxc_usd: 0,
      total_ingresos_usd: 200,
      tasa_bcv: 50,
    }

    mock = installFetchMock([
      { match: '/api/finanzas-sync/cierre-diario', method: 'GET', respond: posConPagoMovil },
      { match: 'idempotency_key=eq.', method: 'GET', respond: [] },
      {
        match: '/finanzas_movimientos',
        method: 'POST',
        respond: (url, init) => {
          const body = JSON.parse(init.body)
          creados.push(body)
          return [{ id: IDS.linea, ...body, moneda: body.moneda || 'USD', monto_ves: body.monto * body.tasa_ves, tasa_registrada_en: '2026-08-30T12:00:00Z', estado: 'activo' }]
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
            partes: [
              { cuenta_origen: 'Cuenta Venezuela', monto: 6000 },
              { cuenta_origen: 'Banesco', monto: 4000 },
            ],
          },
        },
      }),
      testEnv
    )
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(creados).toHaveLength(2)

    // Tramo 1 en Cuenta Venezuela
    expect(creados[0].monto).toBe(6000)
    expect(creados[0].moneda).toBe('VES')
    expect(creados[0].cuenta_origen).toBe('Cuenta Venezuela')
    expect(creados[0].idempotency_key).toBe('pos-vta-pagomovil-ves-2026-08-30-p1')
    expect(creados[0].concepto).toBe('Ventas POS en Pago Móvil (Cuenta Venezuela) - 2026-08-30')

    // Tramo 2 en Banesco
    expect(creados[1].monto).toBe(4000)
    expect(creados[1].moneda).toBe('VES')
    expect(creados[1].cuenta_origen).toBe('Banesco')
    expect(creados[1].idempotency_key).toBe('pos-vta-pagomovil-ves-2026-08-30-p2')
    expect(creados[1].concepto).toBe('Ventas POS en Pago Móvil (Banesco) - 2026-08-30')
  })
})

