// @vitest-environment jsdom
// src/hooks/__tests__/useCuentasCustodia.test.jsx
// Tests del hook de cuentas de custodia: saldos calculados por cuenta explícita,
// sin doble conteo cuando varias cuentas comparten subcuentaId. El hook consulta
// el backend; se mockea la API para aislar la lógica de saldos.
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CUENTAS_DEFAULT } from '../../utils/cuentasCustodiaUtils.js'

vi.mock('../../../compat/services/authFetch.js', () => ({
  authFetch: vi.fn(async (path) => {
    if (path === '/api/finanzas/cuentas-custodia') {
      // Por defecto el backend devuelve las semillas; cada test puede sobreescribirlo.
      const payload = globalThis.__mockCuentasPayload ?? CUENTAS_DEFAULT
      return new Response(JSON.stringify({ cuentas: payload }), { status: 200 })
    }
    if (path.startsWith('/api/finanzas/cuentas-custodia/')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    return new Response(JSON.stringify({ error: 'no route' }), { status: 404 })
  }),
}))

vi.mock('../../../compat/store/useAuthStore.js', () => {
  const perfil = { rol: 'administracion', cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' }
  // El hook usa selectores (state => state.perfil); el mock debe aplicarlos.
  const useAuthStore = vi.fn(selector => (selector ? selector({ perfil }) : { perfil }))
  useAuthStore.getState = () => ({ perfil })
  return { default: useAuthStore }
})

import { useCuentasCustodia } from '../useCuentasCustodia.js'

beforeEach(() => localStorage.clear())
afterEach(() => vi.clearAllMocks())

function wrapper({ children }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

// Esperar a que el hook resuelva los datos del backend (fuente de verdad).
async function renderCustodia(movimientos) {
  const utils = renderHook(() => useCuentasCustodia(movimientos), { wrapper })
  await waitFor(() => expect(utils.result.current.cargando).toBe(false))
  return utils
}

describe('useCuentasCustodia — saldos por cuenta explícita', () => {
  it('no duplica el saldo cuando BNC y Mercantil comparten subcuentaId', async () => {
    const movimientos = [
      { id: 'm1', estado: 'activo', tipo: 'egreso', moneda: 'VES', monto: 1000, monto_ves: 1000, cuenta_origen: 'Banco BNC (Principal)' },
    ]

    const { result } = await renderCustodia(movimientos)

    const bnc = result.current.cuentas.find(c => c.nombre === 'Banco BNC (Principal)')
    const mercantil = result.current.cuentas.find(c => c.nombre === 'Banco Mercantil')

    expect(bnc).toBeDefined()
    expect(mercantil).toBeDefined()
    expect(bnc.saldo).toBe(-1000)
    expect(mercantil.saldo).toBe(0)
  })

  it('agrega el ingreso a la cuenta explícita correcta', async () => {
    const movimientos = [
      { id: 'm1', estado: 'activo', tipo: 'ingreso', moneda: 'VES', monto: 500, monto_ves: 500, cuenta_origen: 'Banco Mercantil' },
    ]

    const { result } = await renderCustodia(movimientos)
    const mercantil = result.current.cuentas.find(c => c.nombre === 'Banco Mercantil')

    expect(mercantil.saldo).toBe(500)
  })

  it('no suma movimientos sin cuenta explícita a ninguna cuenta de custodia', async () => {
    const movimientos = [
      { id: 'm1', estado: 'activo', tipo: 'ingreso', moneda: 'VES', monto: 800, monto_ves: 800 },
    ]

    const { result } = await renderCustodia(movimientos)
    const bnc = result.current.cuentas.find(c => c.nombre === 'Banco BNC (Principal)')
    const mercantil = result.current.cuentas.find(c => c.nombre === 'Banco Mercantil')
    const caja = result.current.cuentas.find(c => c.nombre === 'Caja Efectivo Bs')

    expect(bnc.saldo).toBe(0)
    expect(mercantil.saldo).toBe(0)
    expect(caja.saldo).toBe(0)
  })

  it('respeta una lista VACÍA del backend sin caer a las semillas', async () => {
    // El tenant eliminó todas sus cuentas: el backend devuelve [] y se respeta.
    // OJO: con placeholderData, isPending es false al montar; hay que esperar
    // a que llegue el dato REAL del servidor.
    globalThis.__mockCuentasPayload = []
    try {
      const { result } = renderHook(() => useCuentasCustodia([]), { wrapper })
      await waitFor(() => expect(result.current.cuentas).toHaveLength(0), { timeout: 3000 })
    } finally {
      delete globalThis.__mockCuentasPayload
    }
  })
})
