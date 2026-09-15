import { describe, expect, it, vi } from 'vitest'
vi.mock('../../../../compat/services/authFetch.js', () => ({ authFetch: vi.fn() }))
import { loadFinanceExport, summarizeExport } from '../exportData.js'
const filters = { desde: '2026-09-01', hasta: '2026-09-30', moneda: 'USD', cartera: 'USD' }
const row = id => ({ id, moneda: 'USD', monto: 100, tasa_ves: 400, monto_ves: 40000, tasa_registrada_en: '2026-09-01T12:00:00Z', tipo: 'ingreso', estado: 'activo' })
const page = (rows, total, next, version = '7') => ({ movimientos: rows, versionLibro: version, paginacion: { total, siguiente: next } })
describe('Complete export dataset', () => {
  it('fetches every page, preserves filters and version, and computes complete totals', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(page([row('a'),row('b')],3,2)).mockResolvedValueOnce(page([row('c')],3,null))
    const result = await loadFinanceExport(filters, { fetchPage })
    expect(result.rows).toHaveLength(3); expect(result.summary.ingresos_usd).toBe(300)
    expect(fetchPage.mock.calls[1][0].get('versionLibro')).toBe('7')
    expect(fetchPage.mock.calls[1][0].get('offset')).toBe('2')
    expect(fetchPage.mock.calls[1][0].get('cartera')).toBe('USD')
  })
  it.each(['missing', 'duplicate', 'version', 'offset', 'network'])('rejects %s without returning a partial export', async kind => {
    const second = kind === 'duplicate' ? page([row('a')],3,null) : kind === 'version' ? page([row('c')],3,null,'8') : page([row('c')],3,null)
    const fetchPage = vi.fn().mockResolvedValueOnce(page([row('a'),row('b')],3,kind === 'missing' ? null : kind === 'offset' ? 1 : 2))
    if (kind === 'network') fetchPage.mockRejectedValueOnce(new Error('Network lost')); else fetchPage.mockResolvedValueOnce(second)
    await expect(loadFinanceExport(filters, { fetchPage })).rejects.toThrow()
  })
  it('aborts after a page returns even when a transport ignores cancellation', async () => {
    const controller = new AbortController()
    await expect(loadFinanceExport(filters, { signal: controller.signal, fetchPage: async () => { controller.abort(); return page([row('a')],1,null) } })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('keeps a legacy positive rate unvalued after an explicit custody assignment', () => {
    const summary = summarizeExport([{ ...row('legacy'), moneda: 'VES', monto: 80481, monto_ves: 80481,
      tasa_usd_ves: 804.81, tasa_registrada_en: null, cuenta_custodia_id: '10000000-0000-4000-8000-000000000001' }])
    expect(summary.movimientos_sin_usd).toBe(1)
    expect(summary.ingresos_usd).toBe(0)
  })

  it('excludes internal transfers and cancelled entries without assuming USDT parity', () => {
    const result = summarizeExport([row('usd'), { ...row('usdt'), moneda: 'USDT', monto: 100, monto_ves: 44000, tasa_usd_ves: 400 }, { ...row('transfer'), origen_operacion: 'traspaso' }, { ...row('cancelled'), estado: 'anulado' }])
    expect(result.ingresos_usd).toBe(210)
    expect(summarizeExport([{ ...row('unknown'), moneda: 'VES', tasa_usd_ves: null }]).movimientos_sin_usd).toBe(1)
  })
})
