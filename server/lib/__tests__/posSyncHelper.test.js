import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchComisionesLiberadasPos, fetchPosVendedores } from '../posSyncHelper.js'

const env = { POS_SUPABASE_URL: 'https://pos.invalid', POS_SUPABASE_SERVICE_KEY: 'test-key' }
afterEach(() => vi.unstubAllGlobals())

describe('POS commission reader', () => {
  it('fails closed when POS credentials are absent', async () => {
    await expect(fetchComisionesLiberadasPos({}, { posVendedorIds: ['v1'], desde: '2026-01-01', hasta: '2026-01-31' }))
      .resolves.toMatchObject({ ok: false })
  })

  it('queries UTC bounds explicitly, validates the result, and maps released amounts', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json([{
        id: 'release-1', comision_id: 'commission-1', despacho_id: 'dispatch-1',
        vendedor_id: 'seller-1', monto: 35.5, tipo: 'contado', creado_en: '2026-08-03T12:00:00Z',
      }]))
      .mockResolvedValueOnce(Response.json([{
        id: 'dispatch-1', numero: 42, creado_en: '2026-08-02T12:00:00Z', cliente: { nombre: 'QA synthetic' },
      }]))
    vi.stubGlobal('fetch', fetch)
    const result = await fetchComisionesLiberadasPos(env, {
      posVendedorIds: ['seller-1'], desde: '2026-08-01', hasta: '2026-08-07',
    })
    expect(result.ok).toBe(true)
    expect(result.liberaciones).toEqual([expect.objectContaining({
      id: 'release-1', vendedor_id: 'seller-1', monto_usd: 35.5,
      despacho_numero: 'DSP-42', cliente_nombre: 'QA synthetic',
    })])
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.searchParams.get('creado_en')).toBe('gte.2026-08-01T00:00:00')
    expect(url.searchParams.getAll('creado_en')).toContain('lte.2026-08-07T23:59:59.999')
    expect(url.searchParams.get('vendedor_id')).toBe('in.(seller-1)')
  })

  it('does not turn a failed commission query into an empty successful import', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: 'private details' }, { status: 503 })))
    await expect(fetchComisionesLiberadasPos(env, {
      posVendedorIds: ['seller-1'], desde: '2026-08-01', hasta: '2026-08-07',
    })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('503') })
  })

  it('fetches, notifies, and filters POS seller roles without E2E records', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([
      { id: 'seller', nombre: 'Vendedor QA', rol: 'vendedor' },
      { id: 'e2e', nombre: 'E2E Vendor', rol: 'vendedor' },
      { id: 'boss', nombre: 'Boss', rol: 'jefe' },
    ])))
    await expect(fetchPosVendedores(env)).resolves.toMatchObject({ ok: true, vendedores: [{ id: 'seller' }] })
  })

  it('refuses to fabricate a success if POS fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network offline')))
    await expect(fetchComisionesLiberadasPos(env, {
      posVendedorIds: ['seller-1'], desde: '2026-08-01', hasta: '2026-08-07',
    })).resolves.toMatchObject({ ok: false })
  })
})
