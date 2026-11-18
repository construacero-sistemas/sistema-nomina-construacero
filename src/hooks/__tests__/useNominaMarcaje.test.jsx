// M-3 (PLAN_MARCAJE_BOTONES_UX): la clave de idempotencia la decide quien hace clic
// y viaja intacta al servidor. Así, un reintento tras un corte de red repite la
// misma petición y el servidor responde «idempotente» en lugar de «ya tiene entrada».
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), invalidate: vi.fn(), success: vi.fn(), error: vi.fn(), cache: new Map() }))
vi.mock('../../../compat/services/authFetch.js', () => ({ authFetch: mocks.fetch }))
vi.mock('../../../compat/components/ui/toastBus.js', () => ({ showToast: { success: mocks.success, error: mocks.error } }))
vi.mock('../../../compat/lib/accountQueries.js', () => ({ useAccountQueryClient: () => ({
  invalidateQueries: mocks.invalidate,
  setQueryData: (key, update) => mocks.cache.set(JSON.stringify(key), update(mocks.cache.get(JSON.stringify(key)))),
}) }))

import { useAnularEntradaComoAusencia, useDeshacerMarcaje, useMarcarAusencia, useMarcarEntrada, useMarcarSalida } from '../useNominaMarcaje.js'
import { KEY_MARCAJE } from '../nominaApi.js'
import { makeIdempotencyKey } from '../idempotencia.js'

function mount(hook) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return renderHook(() => hook(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
}
const cuerpo = n => JSON.parse(mocks.fetch.mock.calls[n][1].body)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.cache.clear()
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

// M-4: la tarjeta cambia en cuanto el servidor confirma, sin esperar la recarga.
describe('caché optimista del marcaje (M-4) y errores sin toast (M-9)', () => {
  const clave = JSON.stringify(KEY_MARCAJE)
  const sembrar = registros => mocks.cache.set(clave, { fecha: '2026-09-25', registros })
  const registros = () => mocks.cache.get(clave).registros

  it('la entrada confirmada entra a la caché aunque el servidor no devuelva el empleado', async () => {
    sembrar([{ id: 'r-otro', empleado_id: 'emp-2', hora_entrada: '08:00:00' }])
    mocks.fetch.mockImplementation(async () => Response.json({ ok: true, idempotente: true, registro: { id: 'r-1', hora_entrada: '08:02:00', estado_marcaje: 'entrada' } }))
    const { result } = mount(useMarcarEntrada)
    await act(async () => { await result.current.mutateAsync({ empleadoId: 'emp-1', idempotencyKey: 'clave-1', nombre: 'Omar Patti' }) })
    expect(registros()).toContainEqual(expect.objectContaining({ id: 'r-1', empleado_id: 'emp-1', estado_marcaje: 'entrada' }))
    expect(registros()).toHaveLength(2)
    expect(mocks.success).toHaveBeenCalledWith('Entrada de Omar Patti · 08:02 AM')
    expect(cuerpo(0)).not.toHaveProperty('nombre')
    expect(mocks.invalidate).toHaveBeenCalled()
  })

  it('la salida reemplaza la fila del mismo empleado', async () => {
    sembrar([{ id: 'r-1', empleado_id: 'emp-1', hora_entrada: '08:00:00', hora_salida: null, estado_marcaje: 'entrada' }])
    mocks.fetch.mockImplementation(async () => Response.json({ ok: true, registro: { id: 'r-1', empleado_id: 'emp-1', hora_salida: '17:00:00', estado_marcaje: 'completo' } }))
    const { result } = mount(useMarcarSalida)
    await act(async () => { await result.current.mutateAsync({ empleadoId: 'emp-1', idempotencyKey: 'clave-2' }) })
    expect(registros()).toEqual([expect.objectContaining({ id: 'r-1', hora_entrada: '08:00:00', hora_salida: '17:00:00', estado_marcaje: 'completo' })])
  })

  it('deshacer la entrada y quitar la ausencia sacan la fila de la caché', async () => {
    sembrar([{ id: 'r-1', empleado_id: 'emp-1' }, { id: 'r-2', empleado_id: 'emp-2', es_ausencia: true }])
    const deshacer = mount(useDeshacerMarcaje).result
    await act(async () => { await deshacer.current.mutateAsync({ registroId: 'r-1', tipo: 'entrada', idempotencyKey: 'clave-3' }) })
    expect(cuerpo(0)).toEqual({ registroId: 'r-1', tipo: 'entrada', idempotencyKey: 'clave-3' })
    const ausencia = mount(useMarcarAusencia).result
    await act(async () => { await ausencia.current.mutateAsync({ empleadoId: 'emp-2', quitar: true }) })
    expect(registros()).toEqual([])
  })

  it('«Llegó» envía reemplazarAusencia solo cuando se pide', async () => {
    const { result } = mount(useMarcarEntrada)
    await act(async () => { await result.current.mutateAsync({ empleadoId: 'emp-1', idempotencyKey: 'clave-4', reemplazarAusencia: true }) })
    await act(async () => { await result.current.mutateAsync({ empleadoId: 'emp-1', idempotencyKey: 'clave-5' }) })
    expect(cuerpo(0).reemplazarAusencia).toBe(true)
    expect(cuerpo(1)).not.toHaveProperty('reemplazarAusencia')
  })

  it('un error no se anuncia con toast (el panel lo muestra en línea)', async () => {
    mocks.fetch.mockImplementation(async () => Response.json({ error: 'El empleado ya tiene entrada marcada hoy' }, { status: 409 }))
    for (const hook of [useMarcarEntrada, useMarcarSalida, useMarcarAusencia, useAnularEntradaComoAusencia, useDeshacerMarcaje]) {
      const { result } = mount(hook)
      await act(async () => { await expect(result.current.mutateAsync({ empleadoId: 'emp-1', registroId: 'r-1', tipo: 'entrada', idempotencyKey: 'clave-6', motivo: 'x' })).rejects.toThrow() })
    }
    expect(mocks.error).not.toHaveBeenCalled()
  })
})
