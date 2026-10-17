// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const session = vi.hoisted(() => ({ perfil: { rol: 'jefe', nombre: 'Boss' } }))
const periodos = vi.hoisted(() => ({ previoKey: '', previo: null, actual: null }))
const custody = vi.hoisted(() => ({ cuentas: [{ id: 'cash-usd', nombre: 'Caja USD', moneda: 'USD' }, { id: 'cash-ves', nombre: 'Caja Bs', moneda: 'VES' }] }))
vi.mock('../../../../compat/store/useAuthStore.js', () => ({ default: selector => selector(session) }))
vi.mock('../../../hooks/useFinanzas.js', () => ({
  usePuedeFinanzas: () => true,
  useFinanzasCategorias: () => ({ data: { categorias: [], eliminadas: [] }, isLoading: false }),
  useFinanzasMovimientos: () => ({ data: { pages: [{ movimientos: [{ id: 'mov-1', estado: 'activo' }] }] }, isLoading: false, isError: false, refetch: vi.fn(), hasNextPage: false, fetchNextPage: vi.fn() }),
  useFinanzasResumen: () => ({ data: { resumen: { ingresos_usd: 100 } }, isLoading: false, isError: false, refetch: vi.fn() }),
  useAnularMovimiento: () => ({ mutate: vi.fn(), isPending: false }),
  useRevertirAnulacion: () => ({ mutate: vi.fn() }),
  useActualizarMovimiento: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useEliminarCategoria: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, variables: null }),
  useRestaurarCategoria: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, variables: null }),
  useCrearCategoria: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePreviewConciliacion: () => ({ data: null, isPending: false, reset: vi.fn(), mutate: vi.fn() }),
  // El panel consulta el mes corriente y el previo: el cierre solo puede
  // ejecutarse sobre el mes anterior, así que la UI debe mostrar ese mes.
  useFinanzasPeriodoMensual: mes => ({
    data: mes === periodos.previoKey ? periodos.previo : periodos.actual,
    isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useOperarFinanzasPeriodoMensual: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRegistrarCuentaEnPeriodoMensual: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../../hooks/useMonedaNomina.js', () => ({ default: () => ({ tasaActiva: 410, nombreTasa: 'BCV', tipoTasa: 'bcv_usd', tasaFallback: null }) }))
vi.mock('../../../hooks/useTasaCambioNomina.js', () => ({ default: () => ({ usd: 410, usdt: 450, source: 'BCV', lastUpdate: '2026-10-01', stale: false }) }))
vi.mock('../../../hooks/useCuentasCustodia.js', () => ({ useCuentasCustodia: () => ({ cuentas: custody.cuentas, cuentasEliminadas: [], saldos: null, saldosCargando: false, saldosError: false, conciliacionPendiente: false, refetch: vi.fn(), agregarCuenta: vi.fn(), editarCuenta: vi.fn(), eliminarCuenta: vi.fn(), restaurarCuentaEliminada: vi.fn(), descartarCuentaEliminada: vi.fn(), vaciarPapelera: vi.fn(), restaurarPredeterminadas: vi.fn() }) }))
vi.mock('../../../hooks/useCustodySave.js', () => ({ default: () => vi.fn() }))
vi.mock('../../../../compat/utils/errorLogger.js', () => ({ logClientError: vi.fn() }))
vi.mock('../../../../compat/components/ui/toastBus.js', () => ({ showToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock('../../../../compat/components/ui/DatePicker.jsx', () => ({ default: () => <div /> }))
vi.mock('../../../../compat/components/ui/CustomSelect.jsx', () => ({ default: () => <div /> }))
vi.mock('../FinanzasFiltrosUI.jsx', () => ({ FinanzasFiltrosSeccion: () => <div>Filtros</div>, InlineError: ({ message }) => <div>{message}</div> }))
vi.mock('../MovimientoForm.jsx', () => ({ default: ({ onClose }) => <div role="dialog" aria-label="Nuevo movimiento">Formulario movimiento <button onClick={onClose}>Cerrar formulario</button></div> }))
vi.mock('../MovimientoTable.jsx', () => ({ default: () => <div>Tabla de movimientos</div> }))
vi.mock('../MovimientoEditarModal.jsx', () => ({ default: () => null }))
vi.mock('../SyncPosModal.jsx', () => ({ default: () => null }))
vi.mock('../CarterasHeader.jsx', () => ({ default: () => <div data-testid="tesoreria-consolidado">Consolidado de tesorería</div> }))
vi.mock('../TransferenciaCarterasModal.jsx', () => ({ default: () => null }))
vi.mock('../DetalleCuentaModal.jsx', () => ({ default: () => null }))
vi.mock('../ConciliacionPreviewModal.jsx', () => ({ default: () => null }))
vi.mock('../CuentasCustodiaGrid.jsx', () => ({ default: () => <div>Cuentas de custodia</div> }))
vi.mock('../CuentaFormModal.jsx', () => ({ default: () => null }))
vi.mock('../CategoriasModal.jsx', () => ({ default: () => null }))
vi.mock('../AnularDialog.jsx', () => ({ default: () => null }))

import FinanzasView from '../FinanzasView.jsx'
import { mesAnteriorIso, monthStart } from '../fechasRapidas.js'

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(<QueryClientProvider client={client}><FinanzasView /></QueryClientProvider>)
  return { ...result, client }
}

function walletRow(overrides = {}) {
  return {
    cuentaCustodiaId: 'cash-usd', nombre: 'Caja USD', moneda: 'USD', activo: true,
    saldoApertura: 100, saldoAperturaUsd: 100, saldoCalculado: 120,
    metodoApertura: 'saldo_real', diferenciaApertura: null, diferenciaCierre: null,
    ...overrides,
  }
}

beforeEach(() => {
  session.perfil = { rol: 'jefe', nombre: 'Boss' }
  periodos.previoKey = mesAnteriorIso(monthStart())
  periodos.previo = { mes: periodos.previoKey, estado: 'cerrado', cuentas: [], cuentasPendientes: [], cierreAnterior: [] }
  periodos.actual = { mes: monthStart(), estado: 'sin_apertura', cuentas: [], cuentasPendientes: [], cierreAnterior: [] }
})
afterEach(cleanup)

describe('FinanzasView — ventana de cierre mensual', () => {
  it('con el cierre del mes anterior pendiente muestra ese mes y ofrece cerrarlo', () => {
    periodos.previo = { ...periodos.previo, estado: 'abierto', cuentas: [walletRow()] }
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /Tesorería/ }))
    // El panel gira al mes con cierre pendiente: el servidor solo cierra el mes anterior.
    expect(screen.getByText(`(${periodos.previoKey})`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cerrar mes/ })).toBeInTheDocument()
    expect(screen.getByText(/Cierre pendiente de/)).toBeInTheDocument()
  })

  it('sin cierre pendiente muestra el mes corriente y no ofrece cerrarlo', () => {
    periodos.actual = { mes: monthStart(), estado: 'abierto', cuentas: [walletRow()] }
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /Tesorería/ }))
    expect(screen.getByText(`(${monthStart()})`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cerrar mes/ })).not.toBeInTheDocument()
    expect(screen.getByText(/se habilita el primer día del mes siguiente/)).toBeInTheDocument()
  })
})
