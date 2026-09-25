// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const session = vi.hoisted(() => ({ perfil: { rol: 'finanzas', nombre: 'QA' } }))
const custody = vi.hoisted(() => ({ cuentas: [{ id: 'cash-usd', nombre: 'Caja USD', moneda: 'USD' }, { id: 'cash-ves', nombre: 'Caja Bs', moneda: 'VES' }] }))
vi.mock('../../../../compat/store/useAuthStore.js', () => ({ default: selector => selector(session) }))
vi.mock('../../../hooks/useFinanzas.js', () => ({
  usePuedeFinanzas: () => true,
  useFinanzasCategorias: () => ({ data: { categorias: [], eliminadas: [] }, isLoading: false }),
  useFinanzasMovimientos: () => ({ data: { pages: [{ movimientos: [{ id: 'mov-1', estado: 'activo' }] }] }, isLoading: false, isError: false, refetch: vi.fn(), hasNextPage: false, fetchNextPage: vi.fn() }),
  useFinanzasResumen: () => ({ data: { resumen: { ingresos_usd: 100 } }, isLoading: false, isError: false, refetch: vi.fn() }),
  useAnularMovimiento: () => ({ mutate: vi.fn(), isPending: false }),
  useRevertirAnulacion: () => ({ mutate: vi.fn() }),
  useEliminarCategoria: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, variables: null }),
  useRestaurarCategoria: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, variables: null }),
  useCrearCategoria: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePreviewConciliacion: () => ({ data: null, isPending: false, reset: vi.fn(), mutate: vi.fn() }),
}))
vi.mock('../../../hooks/useMonedaNomina.js', () => ({ default: () => ({ tasaActiva: {}, nombreTasa: 'BCV' }) }))
vi.mock('../../../hooks/useTasaCambioNomina.js', () => ({ default: () => ({ usd: 1, usdt: 1 }) }))
vi.mock('../../../hooks/useCuentasCustodia.js', () => ({ useCuentasCustodia: () => ({ cuentas: custody.cuentas, cuentasEliminadas: [], saldos: null, saldosCargando: false, saldosError: false, conciliacionPendiente: false, refetch: vi.fn(), agregarCuenta: vi.fn(), editarCuenta: vi.fn(), eliminarCuenta: vi.fn(), restaurarCuentaEliminada: vi.fn(), descartarCuentaEliminada: vi.fn(), vaciarPapelera: vi.fn(), restaurarPredeterminadas: vi.fn() }) }))
vi.mock('../../../hooks/useCustodySave.js', () => ({ default: () => vi.fn() }))
vi.mock('../../../../compat/utils/errorLogger.js', () => ({ logClientError: vi.fn() }))
vi.mock('../../../../compat/components/ui/toastBus.js', () => ({ showToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('../../../../compat/components/ui/DatePicker.jsx', () => ({ default: () => <div /> }))
vi.mock('../../../../compat/components/ui/CustomSelect.jsx', () => ({ default: () => <div /> }))
vi.mock('../FinanzasFiltrosUI.jsx', () => ({ FinanzasFiltrosSeccion: () => <div>Filtros</div>, InlineError: ({ message }) => <div>{message}</div> }))
vi.mock('../MovimientoForm.jsx', () => ({ default: ({ onClose, cuentas = [] }) => <div role="dialog" aria-label="Nuevo movimiento">Formulario movimiento · {cuentas.length} cuentas disponibles <button onClick={onClose}>Cerrar formulario</button></div> }))
vi.mock('../MovimientoTable.jsx', () => ({ default: () => <div>Tabla de movimientos</div> }))
vi.mock('../SyncPosModal.jsx', () => ({ default: () => null }))
vi.mock('../CarterasHeader.jsx', () => ({ default: () => <div data-testid="tesoreria-consolidado">Consolidado de tesorería</div> }))
vi.mock('../TransferenciaCarterasModal.jsx', () => ({ default: ({ validarFondosEnServidor }) => <div role="dialog" aria-label="Mover entre carteras">El servidor validará los fondos: {String(validarFondosEnServidor)}</div> }))
vi.mock('../DetalleCuentaModal.jsx', () => ({ default: () => null }))
vi.mock('../ConciliacionPreviewModal.jsx', () => ({ default: () => null }))
vi.mock('../CuentasCustodiaGrid.jsx', () => ({ default: () => <div>Cuentas de custodia</div> }))
vi.mock('../CuentaFormModal.jsx', () => ({ default: () => null }))
vi.mock('../CategoriasModal.jsx', () => ({ default: () => null }))
vi.mock('../AnularDialog.jsx', () => ({ default: () => null }))

import FinanzasView from '../FinanzasView.jsx'

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(<QueryClientProvider client={client}><FinanzasView /></QueryClientProvider>)
  return { ...result, client }
}

beforeEach(() => { session.perfil = { rol: 'finanzas', nombre: 'QA' } })
afterEach(cleanup)

describe('FinanzasView — acceso por capacidad', () => {
  it('rol finanzas solo ve movimientos: no muestra pestaña ni resumen de saldos', () => {
    renderView()
    expect(screen.getByRole('button', { name: /Movimientos/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mover entre carteras/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Nuevo movimiento/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tesorería/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('tesoreria-consolidado')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Resumen financiero' })).not.toBeInTheDocument()
    expect(screen.getByText('Tabla de movimientos')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Nuevo movimiento/ }))
    expect(screen.getByRole('dialog', { name: 'Nuevo movimiento' })).toHaveTextContent('2 cuentas disponibles')
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar formulario' }))
    fireEvent.click(screen.getByRole('button', { name: /Mover entre carteras/ }))
    expect(screen.getByRole('dialog', { name: 'Mover entre carteras' })).toHaveTextContent('El servidor validará los fondos: true')
  })

  it('al cambiar de jefe a finanzas mientras Tesorería está activa vuelve a mostrar movimientos', () => {
    session.perfil = { rol: 'jefe', nombre: 'QA' }
    const view = renderView()
    fireEvent.click(screen.getByRole('button', { name: /Tesorería/ }))
    expect(screen.getByTestId('tesoreria-consolidado')).toBeInTheDocument()

    session.perfil = { rol: 'finanzas', nombre: 'QA' }
    view.rerender(<QueryClientProvider client={view.client}><FinanzasView /></QueryClientProvider>)

    expect(screen.queryByRole('button', { name: /Tesorería/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('tesoreria-consolidado')).not.toBeInTheDocument()
    expect(screen.getByText('Tabla de movimientos')).toBeInTheDocument()
  })

  it('jefe conserva acceso a operaciones, tesorería y resumen', () => {
    session.perfil = { rol: 'jefe', nombre: 'QA' }
    renderView()
    expect(screen.getByRole('button', { name: /Mover entre carteras/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Nuevo movimiento/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tesorería/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Resumen financiero' })).toBeInTheDocument()
  })
})
