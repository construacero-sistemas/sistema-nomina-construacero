// @vitest-environment jsdom
// src/components/finanzas/__tests__/FinanzasView.syncPos.test.jsx
// Regresión de producto: la sincronización POS queda oculta a todos los perfiles.
// Los flujos de sincronización permanecen probados en SyncPosModal y sus handlers.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Mock de los hooks de datos de Finanzas (sin red).
vi.mock('../../../hooks/useFinanzas.js', () => ({
  usePuedeFinanzas: () => true,
  useFinanzasCategorias: () => ({ data: { categorias: [], eliminadas: [] }, isLoading: false, isError: false }),
  useFinanzasMovimientos: () => ({
    data: { pages: [{ movimientos: [] }] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useFinanzasResumen: () => ({ data: { resumen: null }, isLoading: false, isError: false, refetch: vi.fn() }),
  useAnularMovimiento: () => ({ mutate: vi.fn(), isPending: false }),
  useRevertirAnulacion: () => ({ mutate: vi.fn(), isPending: false }),
  useActualizarMovimiento: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useEliminarCategoria: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, variables: null }),
  useRestaurarCategoria: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, variables: null }),
  useCrearCategoria: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReasignarCuenta: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  usePreviewConciliacion: () => ({ data: null, isPending: false, reset: vi.fn(), mutate: vi.fn(), mutateAsync: vi.fn() }),
  // El formulario y los modales de cuentas usan estos:
  useCrearMovimiento: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false }),
}))

vi.mock('../../../hooks/useMonedaNomina.js', () => ({
  default: () => ({ tasaActiva: { usd: 1, eur: 1, usdt: 1 }, tipoTasa: 'bcv_usd', tasaManual: 0, setTipoTasa: vi.fn() }),
}))

vi.mock('../../../hooks/useCuentasCustodia.js', () => ({
  useCuentasCustodia: () => ({
    cuentas: [],
    cuentasEliminadas: [],
    agregarCuenta: vi.fn(),
    editarCuenta: vi.fn(),
    eliminarCuenta: vi.fn(),
    restaurarCuentaEliminada: vi.fn(),
    restaurarPredeterminadas: vi.fn(),
  }),
}))

const session = vi.hoisted(() => ({ perfil: { rol: 'finanzas', nombre: 'QA' } }))
vi.mock('../../../../compat/store/useAuthStore.js', () => ({
  default: selector => selector ? selector(session) : session,
}))

vi.mock('../../../../compat/utils/errorLogger.js', () => ({
  logClientError: vi.fn(),
}))


import FinanzasView from '../FinanzasView.jsx'

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <FinanzasView />
    </QueryClientProvider>,
  )
}

beforeEach(() => { session.perfil = { rol: 'finanzas', nombre: 'QA' } })
afterEach(cleanup)

describe('FinanzasView — funciones POS ocultas', () => {
  it.each(['finanzas', 'jefe', 'desarrollador'])('no ofrece sincronización POS al rol %s', rol => {
    session.perfil = { rol, nombre: 'QA' }
    renderView()
    expect(screen.queryByRole('button', { name: /Sincronizar POS/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Nuevo movimiento/i })).toBeInTheDocument()
  })
})
