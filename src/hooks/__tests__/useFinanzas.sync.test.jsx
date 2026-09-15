import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), invalidate: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }))
vi.mock('../../../compat/services/authFetch.js', () => ({ authFetch: mocks.fetch }))
vi.mock('../../../compat/components/ui/toastBus.js', () => ({ showToast: { success: mocks.success, warning: mocks.warning, error: mocks.error } }))
vi.mock('../../../compat/lib/accountQueries.js', () => ({ useAccountQuery: vi.fn(), useAccountInfiniteQuery: vi.fn(), useAccountQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }))
vi.mock('../../../compat/store/useAuthStore.js', () => ({ default: vi.fn() }))
import { useEjecutarSyncPos } from '../useFinanzas.js'
const confirmation = { ok: true, synced: true, desde: '2026-08-30', hasta: '2026-08-30', resultados: [], total_ingresos_usd: 0, movimientos_sin_usd: 0 }
function mount() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return renderHook(() => useEjecutarSyncPos(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
}
beforeEach(() => { vi.clearAllMocks(); mocks.invalidate.mockResolvedValue() })
describe('POS: selección y resultados confirmados', () => {
  it('envía los métodos desmarcados y tramos, no el catálogo cliente como autoridad', async () => {
    mocks.fetch.mockResolvedValue(Response.json(confirmation))
    const { result } = mount()
    const distribucion = { efectivo_usd: { activo: false }, pago_movil_ves: { activo: true, excluidos: ['d1'] } }
    await act(async () => { await result.current.mutateAsync({ fecha: '2026-08-30', distribucion, cuentasCustodia: [{ id: 'untrusted' }] }) })
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ fecha: '2026-08-30', distribucion, confirm: true })
    expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining('$0,00 USD'))
    expect(mocks.warning).not.toHaveBeenCalled()
    expect(mocks.invalidate).toHaveBeenCalledTimes(1)
  })
  it('la valoración pendiente no produce un éxito con cero ficticio', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ ...confirmation, total_ingresos_usd: null, movimientos_sin_usd: 1 }))
    const { result } = mount()
    await act(async () => { await result.current.mutateAsync({ fecha: '2026-08-30' }) })
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('valoración USD pendiente'))
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.invalidate).toHaveBeenCalledTimes(1)
  })
  it('respuesta HTTP200 incompleta no se declara sincronizada', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ ok: true }))
    const { result } = mount()
    await act(async () => { await expect(result.current.mutateAsync({ fecha: '2026-08-30' })).rejects.toThrow(/No se confirmó/) })
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })
})
