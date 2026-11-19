// @vitest-environment jsdom
// Mejora del 19/11/2026: al abrir un período abierto se pone al día solo, una vez.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const apiPost = vi.fn()
vi.mock('../nominaApi.js', () => ({ apiPost: (...a) => apiPost(...a), KEY_LINEAS: ['nomina', 'lineas'], KEY_PERIODOS: ['nomina', 'periodos'] }))
vi.mock('../../../compat/lib/accountQueries.js', async () => {
  const rq = await import('@tanstack/react-query')
  return { useAccountQueryClient: rq.useQueryClient }
})
vi.mock('../../../compat/utils/errorLogger.js', () => ({ logClientError: vi.fn() }))

const { default: useAutoCalculoPeriodo } = await import('../useAutoCalculoPeriodo.js')
const wrapper = ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
const abierto = { id: 'p-1', estado: 'abierto' }

afterEach(() => apiPost.mockReset())

describe('useAutoCalculoPeriodo', () => {
  it('pide el cálculo con soloSiCambio una sola vez y avisa si está al día', async () => {
    apiPost.mockResolvedValue({ ok: true, sin_cambios: true })
    const { result, rerender } = renderHook(() => useAutoCalculoPeriodo(abierto, true), { wrapper })
    await waitFor(() => expect(result.current.estado).toBe('al-dia'))
    rerender()
    expect(apiPost).toHaveBeenCalledTimes(1)
    expect(apiPost).toHaveBeenCalledWith('/api/nomina/periodos/calcular', { periodoId: 'p-1', soloSiCambio: true })
  })

  it('avisa las jornadas sin salida en vez de calcular', async () => {
    apiPost.mockRejectedValue(Object.assign(new Error('409'), { status: 409, payload: { total_jornadas_abiertas: 2 } }))
    const { result } = renderHook(() => useAutoCalculoPeriodo(abierto, true), { wrapper })
    await waitFor(() => expect(result.current).toMatchObject({ estado: 'jornadas-abiertas', jornadas: 2 }))
  })

  it('no hace nada con un período cerrado o sin permiso', () => {
    renderHook(() => useAutoCalculoPeriodo({ id: 'p-2', estado: 'cerrado' }, true), { wrapper })
    renderHook(() => useAutoCalculoPeriodo(abierto, false), { wrapper })
    expect(apiPost).not.toHaveBeenCalled()
  })
})
