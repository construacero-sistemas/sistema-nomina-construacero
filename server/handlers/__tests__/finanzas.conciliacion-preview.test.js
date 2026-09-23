import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.jefe
let mock

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test' }),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const { handlePreviewReconciliacionMovimientos } = await import('../finanzas.js')

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.jefe
  vi.clearAllMocks()
})

describe('preview de conciliación financiera', () => {
  it('lee el libro y el catálogo, propone cuentas y no escribe movimientos', async () => {
    mock = installFetchMock([
      {
        match: '/rpc/finanzas_movimientos_pagina',
        method: 'POST',
        respond: {
          movimientos: [
            { id: 'm1', fecha: '2026-09-21', tipo: 'egreso', categoria: 'Personal', concepto: 'Nómina', monto: 100, moneda: 'VES', cuenta_origen: 'Cuenta Venezuela 4858', estado: 'activo' },
            { id: 'm2', fecha: '2026-09-21', tipo: 'egreso', categoria: 'Personal', concepto: 'Nómina', monto: 50, moneda: 'VES', cuenta_origen: null, estado: 'activo' },
          ],
          versionLibro: '12',
          paginacion: { total: 2, recibidos: 2, siguiente: null },
        },
      },
      {
        match: '/cuentas_custodia?',
        method: 'GET',
        respond: [
          { id: 'bvn', nombre: 'Banco Venezuela', banco: 'Banco de Venezuela', tipo: 'banco_ves', moneda: 'VES', activo: true },
          { id: 'prov', nombre: 'Banco Provincial', banco: 'BBVA Provincial', tipo: 'banco_ves', moneda: 'VES', activo: true },
        ],
      },
    ])
    const request = makeRequest(undefined, { url: 'http://worker.test/api/finanzas/movimientos/conciliacion-preview?desde=2026-09-01&hasta=2026-09-22' })
    const result = await readResponse(await handlePreviewReconciliacionMovimientos(request, ENV))

    expect(result.status).toBe(200)
    expect(result.body.modo).toBe('simulacion')
    expect(result.body.counts).toMatchObject({ total: 2, propuesta: 1, ambiguo: 1 })
    expect(result.body.safeIds).toEqual(['m1'])
    expect(result.body.aviso).toMatch(/solo lectura/i)
    expect(mock.calls.filter(call => call.method === 'PATCH' || call.method === 'DELETE')).toHaveLength(0)
  })
})
