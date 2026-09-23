import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  callFinancialRpc,
  executeFinancialOperation,
  normalizeFinancialDecimal,
  normalizeFinancialOperation,
  operationKey,
} from '../financialOperations.js'

const id = '11111111-1111-4111-8111-111111111111'
const id2 = '22222222-2222-4222-8222-222222222222'
const key = '33333333-3333-4333-8333-333333333333'
const tenant = '44444444-4444-4444-8444-444444444444'
const payment = {
  operationId: key, lineaIds: [id2, id], cuentaCustodiaId: id2,
  tasaBcv: '120.00', fuenteTasa: 'BCV', metodoPago: 'Zelle', referencia: 'RECEIPT-1',
}
const transfer = {
  operationId: key, origenCuentaId: id, destinoCuentaId: id2, montoOrigen: '100',
  tasaCambio: '120', tasaUsdVes: '120', fecha: '2026-09-12', observaciones: 'Approved transfer rate',
}
const env = { SUPABASE_URL: 'https://database.invalid', SUPABASE_SERVICE_KEY: 'test-service-key' }
const actor = { cuenta_id: tenant, id, rol: 'jefe' }

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('financial decimal and operation contract', () => {
  it('canonicalizes decimal strings without binary floating point drift', () => {
    expect(normalizeFinancialDecimal('000120,00000000', 'rate')).toBe('120')
    expect(normalizeFinancialDecimal('0.000000015', 'rate')).toBe('0.00000002')
    expect(normalizeFinancialDecimal('999999999.9999994', 'amount', 6, 1000000000)).toBe('999999999.999999')
    expect(normalizeFinancialDecimal('999999999.9999995', 'amount', 6, 1000000000)).toBe('1000000000')
  })

  it.each([null, undefined, '', true, false, NaN, Infinity, 'NaN', 'Infinity', '1e3', '-1', '0', '0.000000001', '1,200.00', '1000001'])('rejects invalid or absent rate %s', value => {
    expect(() => normalizeFinancialDecimal(value, 'rate')).toThrow()
  })

  it('canonicalizes receipt ordering, duplicates, whitespace, and numeric representation for replay', () => {
    const first = normalizeFinancialOperation('pagar_nomina', payment)
    const second = normalizeFinancialOperation('pagar_nomina', { ...payment, lineaIds: [id, id2, id], tasaBcv: 120, referencia: ' RECEIPT-1 ' })
    expect(first).toEqual(second)
    expect(first.payload).toEqual({
      lineaIds: [id, id2], cuentaCustodiaId: id2, tasaBcv: '120', tasaUsdVes: null,
      fuenteTasa: 'BCV', metodoPago: 'Zelle', observacionTasa: null, referencia: 'RECEIPT-1',
    })
  })

  it('does not accept tenant, actor, currency or amount authority from the body', () => {
    const result = normalizeFinancialOperation('pagar_nomina', { ...payment, cuenta_id: id, operador_id: id2, moneda: 'EUR', total_usd: 99999 })
    expect(result.payload).not.toHaveProperty('cuenta_id')
    expect(result.payload).not.toHaveProperty('operador_id')
    expect(result.payload).not.toHaveProperty('moneda')
    expect(result.payload).not.toHaveProperty('total_usd')
  })

  it.each(['operationId', 'lineaIds', 'cuentaCustodiaId', 'tasaBcv', 'fuenteTasa', 'metodoPago'])('requires payment %s', field => {
    const body = { ...payment }
    delete body[field]
    expect(() => normalizeFinancialOperation('pagar_nomina', body)).toThrow()
  })

  it('rejects invalid receipt IDs instead of silently dropping them', () => {
    expect(() => normalizeFinancialOperation('pagar_nomina', { ...payment, lineaIds: [id, 'invalid'] })).toThrow(/UUID/)
    expect(() => normalizeFinancialOperation('pagar_nomina', { ...payment, lineaIds: Array(501).fill(id) })).toThrow(/500/)
  })

  it('preserves explicit manual observations and USD valuation rates', () => {
    expect(() => normalizeFinancialOperation('pagar_nomina', { ...payment, fuenteTasa: 'MANUAL' })).toThrow(/observacionTasa/)
    expect(normalizeFinancialOperation('pagar_nomina', { ...payment, fuenteTasa: 'MANUAL', observacionTasa: 'Approved quote', tasaUsdVes: '100.25' }).payload)
      .toMatchObject({ observacionTasa: 'Approved quote', tasaUsdVes: '100.25' })
  })

  it('preserves transfer units, date and snapshot; rejects missing rates', () => {
    expect(normalizeFinancialOperation('traspaso', transfer).payload).toMatchObject({ montoOrigen: '100', tasaCambio: '120', tasaUsdVes: '120' })
    expect(() => normalizeFinancialOperation('traspaso', { ...transfer, tasaCambio: undefined })).toThrow(/tasaCambio/)
    expect(() => normalizeFinancialOperation('traspaso', { ...transfer, tasaUsdVes: undefined })).toThrow(/tasaUsdVes/)
    expect(() => normalizeFinancialOperation('traspaso', { ...transfer, destinoCuentaId: id })).toThrow(/diferentes/)
    expect(() => normalizeFinancialOperation('traspaso', { ...transfer, fecha: '2026-02-30' })).toThrow(/fecha/i)
  })

  it('requires a reversal reason and a new explicit operation key', () => {
    expect(() => normalizeFinancialOperation('revertir_nomina', { operationId: key, lineaId: id })).toThrow(/motivo/)
    expect(normalizeFinancialOperation('revertir_nomina', { operationId: key, lineaId: id, motivo: 'Incorrect payment' }).payload)
      .toEqual({ lineaId: id, motivo: 'Incorrect payment' })
  })

  it('supports stable non-UUID keys but never generates one on the server', () => {
    expect(operationKey({ idempotencyKey: 'payroll:stable-key-123' })).toBe('payroll:stable-key-123')
    expect(() => operationKey({})).toThrowError(expect.objectContaining({ status: 400, code: 'OPERATION_KEY_REQUIRED' }))
    expect(() => operationKey({ operationId: key, idempotencyKey: 'different-stable-key' })).toThrowError(expect.objectContaining({ status: 400, code: 'INVALID_OPERATION' }))
    expect(() => operationKey({ idempotencyKey: 'short' })).toThrow()
  })
})

describe('financial RPC boundary', () => {
  it('uses one service RPC with authorized tenant and actor', async () => {
    const result = { ok: true, estado: 'confirmada', operationId: key, idempotencyKey: key, tipo: 'pagar_nomina', resultado: { recibos_pagados: 2 } }
    const fetchMock = vi.fn().mockResolvedValue(Response.json(result))
    vi.stubGlobal('fetch', fetchMock)
    const operation = normalizeFinancialOperation('pagar_nomina', payment)
    expect(await executeFinancialOperation(env, actor, operation, '127.0.0.1')).toEqual(result)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(`${env.SUPABASE_URL}/rest/v1/rpc/finanzas_operar`)
    expect(options.headers.Authorization).toBe('Bearer test-service-key')
    expect(JSON.parse(options.body)).toEqual({ p_cuenta_id: tenant, p_operador_id: id, p_tipo: 'pagar_nomina', p_clave: key, p_payload: { ...operation.payload, zonaHoraria: 'America/Caracas' }, p_ip: '127.0.0.1' })
  })

  it.each(['PGRST202', 'PGRST204', '42883', '42P01', '42703'])('fails closed when capability is missing (%s)', async code => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ code, message: 'sensitive SQL internals' }, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(callFinancialRpc(env, 'finanzas_operar', {})).rejects.toMatchObject({ status: 503, code: 'FINANCIAL_UPDATE_REQUIRED' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([['PT409', 409], ['PT400', 400], ['PT403', 403], ['PT404', 404], ['PT422', 422], ['PT402', 409]])('maps HTTP database errors without exposing SQL (%s)', async (code, status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code, message: 'sensitive SQL internals' }, { status: 400 })))
    await expect(callFinancialRpc(env, 'finanzas_operar', {})).rejects.toMatchObject({ status, code })
    await expect(callFinancialRpc(env, 'finanzas_operar', {})).rejects.not.toThrow(/sensitive/)
  })

  it('treats transport failure as unknown outcome, not permission to duplicate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection lost')))
    await expect(callFinancialRpc(env, 'finanzas_operar', {})).rejects.toMatchObject({ status: 503, code: 'OPERATION_RESULT_UNKNOWN' })
  })

  it('rejects malformed success without claiming a committed operation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })))
    await expect(executeFinancialOperation(env, actor, normalizeFinancialOperation('pagar_nomina', payment))).rejects.toMatchObject({ status: 503 })
  })

  it('does not invoke RPC without a validated tenant and administrator', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(executeFinancialOperation(env, { ...actor, cuenta_id: null }, {})).rejects.toMatchObject({ status: 403 })
    await expect(executeFinancialOperation(env, { ...actor, rol: 'vendedor' }, {})).rejects.toMatchObject({ status: 403 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
