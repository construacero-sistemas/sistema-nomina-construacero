// @vitest-environment jsdom
// src/hooks/__tests__/useMonedaNomina.test.jsx
// Guardarraíles del flujo de tasas: (1) si la tasa elegida no tiene dato, se
// avisa con `tasaFallback` en vez de mostrar un número mentiroso; (2) la tasa
// manual se hidrata desde el servidor (trazable) y se fija con motivo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const marketMock = { usd: 0, eur: 0, usdt: 0, loading: false, error: '', lastUpdate: null, stale: false, refresh: vi.fn() }
vi.mock('../useTasaCambioNomina.js', () => ({ default: () => marketMock }))

const apiMock = { get: vi.fn(), post: vi.fn() }
vi.mock('../nominaApi.js', () => ({
  apiGet: (...args) => apiMock.get(...args),
  apiPost: (...args) => apiMock.post(...args),
}))

const { default: useMonedaNomina } = await import('../useMonedaNomina.js')
const { useTasaNominaStore } = await import('../../store/useTasaNominaStore.js')

function wrapper({ children }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function resetStore() {
  useTasaNominaStore.setState({ tipoTasa: 'bcv_usd', tasaManual: 0 })
  window.localStorage.clear()
}

beforeEach(() => {
  resetStore()
  marketMock.usd = 0
  marketMock.eur = 0
  marketMock.usdt = 0
  apiMock.get.mockReset()
  apiMock.post.mockReset()
  apiMock.get.mockResolvedValue({ tasa: null })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useMonedaNomina — avisos de tasa de respaldo', () => {
  it('sin dato de USDT, usa el dólar BCV y lo avisa (no miente en silencio)', async () => {
    marketMock.usd = 857.01
    useTasaNominaStore.setState({ tipoTasa: 'usdt' })
    const { result } = renderHook(() => useMonedaNomina(), { wrapper })
    await waitFor(() => expect(result.current.tasaFallback).toBe('bcv_usd'))
    expect(result.current.tasaActiva).toBe(857.01)
  })

  it('sin dato del euro, usa el dólar BCV y lo avisa', async () => {
    marketMock.usd = 857.01
    useTasaNominaStore.setState({ tipoTasa: 'bcv_eur' })
    const { result } = renderHook(() => useMonedaNomina(), { wrapper })
    await waitFor(() => expect(result.current.tasaFallback).toBe('bcv_usd'))
  })

  it('sin ninguna tasa disponible, avisa sin_datos y no inventa equivalencias', async () => {
    useTasaNominaStore.setState({ tipoTasa: 'bcv_usd' })
    const { result } = renderHook(() => useMonedaNomina(), { wrapper })
    await waitFor(() => expect(result.current.tasaFallback).toBe('sin_datos'))
    expect(result.current.tasaActiva).toBe(0)
  })

  it('con todos los datos presentes no hay aviso de respaldo', async () => {
    marketMock.usd = 857.01
    marketMock.eur = 976.9
    marketMock.usdt = 966.54
    useTasaNominaStore.setState({ tipoTasa: 'usdt' })
    const { result } = renderHook(() => useMonedaNomina(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tasaFallback).toBeNull()
    expect(result.current.tasaActiva).toBe(966.54)
  })
})

describe('useMonedaNomina — tasa manual sincronizada con el servidor', () => {
  it('hidrata la tasa manual desde el servidor sin tocar la preferencia local', async () => {
    apiMock.get.mockResolvedValue({ tasa: { valor: 42.5, motivo: 'Acuerdo', fijada_por_nombre: 'Admin', observado_en: '2026-09-27T10:00:00Z' } })
    useTasaNominaStore.setState({ tipoTasa: 'bcv_usd' })
    const { result } = renderHook(() => useMonedaNomina(), { wrapper })
    await waitFor(() => expect(result.current.tasaManual).toBe(42.5))
    expect(result.current.tasaManualInfo.fijada_por_nombre).toBe('Admin')
    expect(result.current.tipoTasa).toBe('bcv_usd') // no cambia la elección de este navegador
  })

  it('sin servidor, cae al respaldo local guardado en este navegador', async () => {
    apiMock.get.mockRejectedValue(new Error('sin red'))
    useTasaNominaStore.setState({ tipoTasa: 'manual', tasaManual: 55 })
    const { result } = renderHook(() => useMonedaNomina(), { wrapper })
    await waitFor(() => expect(result.current.tasaManual).toBe(55))
    expect(result.current.tasaActiva).toBe(55)
  })

  it('fijarTasaManual guarda en el servidor con valor y motivo y activa la tasa manual', async () => {
    apiMock.post.mockResolvedValue({ tasa: { valor: 42.5, motivo: 'Tasa acordada', fijada_por_nombre: 'Admin', observado_en: '2026-09-27T10:00:00Z' } })
    const { result } = renderHook(() => useMonedaNomina(), { wrapper })
    await act(async () => { await result.current.fijarTasaManual(42.5, 'Tasa acordada') })
    expect(apiMock.post).toHaveBeenCalledWith('/api/nomina/tasa-manual', { valor: 42.5, motivo: 'Tasa acordada' })
    await waitFor(() => expect(result.current.tipoTasa).toBe('manual'))
    expect(result.current.tasaManual).toBe(42.5)
    expect(result.current.tasaFallback).toBeNull()
  })
})
