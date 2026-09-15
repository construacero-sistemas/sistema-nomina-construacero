import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateOperator } from '../../lib/auth.js'
import { handleGetSaldos, handleGetOperacionEstado, handleCrearTransferencia } from '../finanzas.operaciones.js'
import { handlePagarLineas, handleRevertirPagoLinea } from '../nomina.lineas.js'

vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn() }))

const tenant = '11111111-1111-4111-8111-111111111111'
const actorId = '22222222-2222-4222-8222-222222222222'
const receiptId = '33333333-3333-4333-8333-333333333333'
const accountId = '44444444-4444-4444-8444-444444444444'
const key = '55555555-5555-4555-8555-555555555555'
const env = { SUPABASE_URL: 'https://database.invalid', SUPABASE_SERVICE_KEY: 'test-service-key' }
const actor = { id: actorId, cuenta_id: tenant, rol: 'administracion', nombre: 'Test administrator' }
const payment = { operationId: key, lineaIds: [receiptId], cuentaCustodiaId: accountId, metodoPago: 'Zelle', tasaBcv: '120', fuenteTasa: 'BCV' }
function request(body, path = '/api/finanzas/operaciones') {
  return new Request(`https://worker.test${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function confirmed(tipo, resultado = {}) {
  return { ok: true, estado: 'confirmada', operationId: key, idempotencyKey: key, tipo, resultado, ...resultado }
}

beforeEach(() => {
  validateOperator.mockResolvedValue({ operador: actor, ip: '127.0.0.1' })
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('atomic financial operation handlers', () => {
  it('pays receipts in a single RPC and preserves rate, method and custody', async () => {
    const result = confirmed('pagar_nomina', { recibos_pagados: 1, total_usd: '450.000000' })
    fetch.mockResolvedValue(Response.json(result))
    const response = await handlePagarLineas(request({ ...payment, cuenta_id: receiptId, operador_id: accountId }), env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(result)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toContain('/rpc/finanzas_operar')
    expect(JSON.parse(options.body)).toMatchObject({ p_cuenta_id: tenant, p_operador_id: actorId, p_clave: key,
      p_payload: { cuentaCustodiaId: accountId, tasaBcv: '120', metodoPago: 'Zelle', fuenteTasa: 'BCV' } })
  })

  it('reverts only the specified receipt through the RPC, never through prefix matching', async () => {
    fetch.mockResolvedValue(Response.json(confirmed('revertir_nomina', { lineaId: receiptId, reversionContable: true })))
    const response = await handleRevertirPagoLinea(request({ operationId: key, lineaId: receiptId, motivo: 'Duplicate receipt' }), env)
    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ p_tipo: 'revertir_nomina', p_payload: { lineaId: receiptId, motivo: 'Duplicate receipt' } })
    expect(fetch.mock.calls[0][0]).not.toContain('like.')
  })

  it('transfers with one RPC rather than two ledger requests', async () => {
    fetch.mockResolvedValue(Response.json(confirmed('traspaso', { montoOrigen: '10', montoDestino: '1200' })))
    const response = await handleCrearTransferencia(request({ operationId: key, origenCuentaId: accountId,
      destinoCuentaId: receiptId, montoOrigen: '10', tasaCambio: '120', tasaUsdVes: '120', fecha: '2026-09-12', observaciones: 'Approved conversion' }), env)
    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0][1].body).p_tipo).toBe('traspaso')
  })

  it.each([handlePagarLineas, handleRevertirPagoLinea, handleCrearTransferencia, handleGetSaldos, handleGetOperacionEstado])('authorizes before financial RPC', async handler => {
    validateOperator.mockResolvedValue({ error: Response.json({ error: 'Unauthorized' }, { status: 401 }) })
    const response = await handler(request(payment), env)
    expect(response.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects missing tenant and non-administrator roles before reading request data', async () => {
    validateOperator.mockResolvedValue({ operador: { ...actor, cuenta_id: null } })
    expect((await handlePagarLineas(request(payment), env)).status).toBe(403)
    validateOperator.mockResolvedValue({ operador: { ...actor, rol: 'vendedor' } })
    expect((await handleGetSaldos(request(), env)).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not fall back to non-atomic writes when the migration is absent', async () => {
    fetch.mockResolvedValue(Response.json({ code: 'PGRST202', message: 'Missing private schema details' }, { status: 404 }))
    const response = await handlePagarLineas(request(payment), env)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'FINANCIAL_UPDATE_REQUIRED' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('surfaces idempotency conflicts, legacy reconciliation and write failures without success', async () => {
    for (const [code, status] of [['PT409', 409], ['PT422', 422], ['XX000', 503]]) {
      fetch.mockResolvedValue(Response.json({ code, message: 'Private SQL text' }, { status: 500 }))
      const response = await handlePagarLineas(request(payment), env)
      expect(response.status).toBe(status)
      expect(await response.json()).not.toHaveProperty('ok', true)
    }
  })

  it('rejects old payment clients before attempting any write', async () => {
    const response = await handlePagarLineas(request({ lineaIds: [receiptId], referencia: 'Old client' }), env)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'OPERATION_KEY_REQUIRED' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads full-ledger balances independent of history pagination, filters or injected tenant', async () => {
    const balances = { schemaVersion: 1, cuentas: [{ cuentaCustodiaId: accountId, saldoNativo: '7500' }], noAsignados: [], versionLibro: '1001' }
    fetch.mockResolvedValue(Response.json(balances))
    const response = await handleGetSaldos(request(undefined, `/api/finanzas/saldos?limit=50&offset=0&tipo=egreso&cuenta_id=${receiptId}&desde=2026-09-01`), env)
    expect(await response.json()).toEqual(balances)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ p_cuenta_id: tenant })
    expect(fetch.mock.calls[0][0]).toContain('/rpc/finanzas_saldos')
  })

  it('recovers confirmed state using the same key and validated tenant', async () => {
    const result = confirmed('pagar_nomina', { recibos_pagados: 1 })
    fetch.mockResolvedValue(Response.json(result))
    const response = await handleGetOperacionEstado(request(undefined, `/api/finanzas/operaciones/estado?tipo=pagar_nomina&operationId=${key}&cuenta_id=${receiptId}`), env)
    expect(await response.json()).toEqual(result)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ p_cuenta_id: tenant, p_tipo: 'pagar_nomina', p_clave: key })
  })

  it('keeps not-found distinct from failure or permission to generate a new key', async () => {
    fetch.mockResolvedValue(Response.json({ estado: 'no_encontrada', idempotencyKey: key, tipo: 'traspaso' }))
    const response = await handleGetOperacionEstado(request(undefined, `/api/finanzas/operaciones/estado?tipo=traspaso&idempotencyKey=${key}`), env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ estado: 'no_encontrada', idempotencyKey: key, tipo: 'traspaso' })
  })
})
