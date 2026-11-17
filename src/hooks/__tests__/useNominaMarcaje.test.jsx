// M-3 (PLAN_MARCAJE_BOTONES_UX): la clave de idempotencia la decide quien hace clic
// y viaja intacta al servidor. Así, un reintento tras un corte de red repite la
// misma petición y el servidor responde «idempotente» en lugar de «ya tiene entrada».
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), invalidate: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('../../../compat/services/authFetch.js', () => ({ authFetch: mocks.fetch }))
vi.mock('../../../compat/components/ui/toastBus.js', () => ({ showToast: { success: mocks.success, error: mocks.error } }))
vi.mock('../../../compat/lib/accountQueries.js', () => ({ useAccountQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }))

import { useAnularEntradaComoAusencia, useMarcarEntrada, useMarcarSalida } from '../useNominaMarcaje.js'
import { makeIdempotencyKey } from '../idempotencia.js'

function mount(hook) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return renderHook(() => hook(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
}
const cuerpo = n => JSON.parse(mocks.fetch.mock.calls[n][1].body)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetch.mockImplementation(async () => Response.json({ ok: true }))
})

describe('idempotencia del marcaje', () => {
  it.each([
    ['entrada', useMarcarEntrada, '/api/nomina/marcaje/entrada'],
    ['salida', useMarcarSalida, '/api/nomina/marcaje/salida'],
  ])('%s: envía tal cual la clave recibida, también al repetir', async (_tipo, hook, ruta) => {
    const { result } = mount(hook)
    await act(async () => { await result.current.mutateAsync({ empleadoId: 'emp-1', idempotencyKey: 'clave-del-clic' }) })
    await act(async () => { await result.current.mutateAsync({ empleadoId: 'emp-1', idempotencyKey: 'clave-del-clic' }) })
    expect(mocks.fetch.mock.calls[0][0]).toBe(ruta)
    expect(cuerpo(0).idempotencyKey).toBe('clave-del-clic')
    expect(cuerpo(1).idempotencyKey).toBe('clave-del-clic')
  })

  it('sin clave recibida genera una propia con el tipo y el empleado', async () => {
    const { result } = mount(useMarcarEntrada)
    await act(async () => { await result.current.mutateAsync({ empleadoId: 'emp-7' }) })
    expect(cuerpo(0).idempotencyKey).toMatch(/^entrada-emp-7-.+/)
  })

  it('makeIdempotencyKey no repite claves', () => {
    expect(makeIdempotencyKey('salida', 'emp-1')).not.toBe(makeIdempotencyKey('salida', 'emp-1'))
  })
})

describe('anular entrada (M-1)', () => {
  it('envía el resultado esperado y anuncia el resultado real del servidor', async () => {
    mocks.fetch.mockImplementation(async () => Response.json({ ok: true, resultado: 'sin-registro', registro: null }))
    const { result } = mount(useAnularEntradaComoAusencia)
    await act(async () => { await result.current.mutateAsync({ registroId: 'r-1', motivo: 'Error', resultadoEsperado: 'sin-registro' }) })
    expect(cuerpo(0)).toEqual({ registroId: 'r-1', motivo: 'Error', resultadoEsperado: 'sin-registro' })
    expect(mocks.success).toHaveBeenCalledWith(expect.stringMatching(/sin registro/))
  })

  it('sin resultado esperado asume ausencia (contrato de versiones anteriores)', async () => {
    const { result } = mount(useAnularEntradaComoAusencia)
    await act(async () => { await result.current.mutateAsync({ registroId: 'r-1', motivo: 'Error' }) })
    expect(cuerpo(0).resultadoEsperado).toBe('ausencia')
  })
})
