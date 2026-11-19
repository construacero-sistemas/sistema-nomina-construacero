// @vitest-environment jsdom
// src/components/nomina/__tests__/TabPeriodos.test.jsx
// Escrituras de cada período usan su propia capacidad; pagar y gestionar siguen separados.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import TabPeriodos from '../TabPeriodos.jsx'

const periodos = [
  { id: 'p-pendiente', nombre: 'Semana 37', desde: '2026-09-07', hasta: '2026-09-12', tipo: 'semanal', estado: 'abierto', total_empleados: 0, total_bruto_usd: 0, total_deducciones_usd: 0, total_neto_usd: 0 },
  { id: 'p-abierto', nombre: 'Semana 36', desde: '2026-08-31', hasta: '2026-09-05', tipo: 'semanal', estado: 'abierto', total_empleados: 4, total_bruto_usd: 200, total_deducciones_usd: 25, total_neto_usd: 175 },
  { id: 'p-cerrado', nombre: 'Semana 35', desde: '2026-08-24', hasta: '2026-08-29', tipo: 'semanal', estado: 'cerrado', total_empleados: 4, total_bruto_usd: 160, total_deducciones_usd: 10, total_neto_usd: 150 },
]
const mockEliminar = vi.fn()
const mockAsegurar = vi.fn()
let configActual = { nomina_periodo_modo: 'automatico', nomina_semana_inicio: 4 }

vi.mock('../../../hooks/useNomina', () => ({
  useNominaPeriodos: () => ({ data: periodos, isLoading: false, isError: false, refetch: vi.fn() }),
  useCalcularPeriodo: () => ({ mutate: vi.fn(), isPending: false }),
  useCerrarPeriodo: () => ({ mutate: vi.fn(), isPending: false }),
  useEliminarPeriodo: () => ({ mutate: mockEliminar, isPending: false }),
  useConfigNomina: () => ({ data: configActual, isSuccess: true, isLoading: false }),
  useAsegurarSemanaActual: () => ({ mutate: mockAsegurar, isPending: false }),
}))

vi.mock('../../../hooks/useMonedaNomina.js', () => ({
  default: () => ({ fmtBs: value => `Bs ${value}`, shortLabelTasa: 'BCV' }),
  formatBs: value => `Bs ${value}`,
  formatUsd: value => `$${value}`,
}))

vi.mock('../RateSelector.jsx', () => ({ default: () => <div data-testid="rate-selector" /> }))
vi.mock('../PeriodoFormModal', () => ({ default: () => <div role="dialog" aria-label="Nuevo período" /> }))
vi.mock('../PeriodoDetalleModal', () => ({ default: () => <div role="dialog" aria-label="Detalle del período" /> }))
vi.mock('../../../compat/components/ui/Modal.jsx', () => ({
  Modal: ({ isOpen, title, children }) => isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null,
}))

function renderTab(props = {}) {
  return render(<TabPeriodos {...props} />)
}

describe('TabPeriodos — tarjetas de período y permisos', () => {
  // Regla del usuario (19/11/2026): cerrar = marcar todo pagado (sin «Pagar» aparte).
  it('muestra importe neto, deducciones y el cierre que marca todo pagado', () => {
    renderTab({ puedeGestionarNomina: true, puedePagarNomina: true })

    expect(screen.getAllByText('Neto a pagar · USD')).toHaveLength(3)
    expect(screen.getAllByText('Deducciones')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Calcular nómina' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recalcular' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Cerrar y marcar pagado' })).toHaveLength(2)
    // Un período «cerrado» de antes de la regla solo se marca pagado.
    expect(screen.getByRole('button', { name: 'Marcar pagado' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pagar recibos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cerrar para pago' })).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar y marcar pagado' })[1])
    const confirmacion = screen.getByRole('group', { name: 'Confirmar cierre de Semana 36' })
    expect(confirmacion).toHaveClass('col-span-2')
    expect(within(confirmacion).getByText(/se marcarán TODOS como pagados/)).toBeInTheDocument()
    expect(within(confirmacion).getByRole('button', { name: 'Sí, cerrar' })).toBeInTheDocument()
    expect(within(confirmacion).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByText('≈ Bs 175')).toBeInTheDocument()
  })

  it('avisa las semanas que ya terminaron y siguen abiertas', () => {
    renderTab({ puedeGestionarNomina: true })
    expect(screen.getByText(/semanas ya terminaron y siguen abiertas/)).toBeInTheDocument()
    expect(screen.getAllByText('La semana terminó · ciérrala para marcarla pagada')).toHaveLength(2)
  })

  it('oculta las acciones de escritura sin su capacidad correspondiente', () => {
    renderTab()
    expect(screen.queryByRole('button', { name: /Crear Nuevo Período/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Calcular nómina/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cerrar y marcar pagado|Marcar pagado/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pagar recibos/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Más acciones para/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Ver recibos/i })).toHaveLength(3)
  })

  it('cerrar (y marcar pagado) requiere gestionar la nómina; pagar por sí solo no basta', () => {
    const view = renderTab({ puedeGestionarNomina: true })
    expect(screen.getByRole('button', { name: 'Calcular nómina' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Cerrar y marcar pagado' }).length).toBeGreaterThan(0)
    view.unmount()

    renderTab({ puedePagarNomina: true })
    expect(screen.queryByRole('button', { name: /Cerrar y marcar pagado|Marcar pagado|Pagar recibos/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recalcular' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Más acciones para/i })).not.toBeInTheDocument()
  })

  it('pone eliminar en un menú secundario y pide confirmación antes de mutar', () => {
    mockEliminar.mockClear()
    renderTab({ puedeGestionarNomina: true })

    expect(screen.queryByRole('button', { name: 'Eliminar período' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Más acciones para Semana 36' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Eliminar período' }))

    expect(screen.getByRole('dialog', { name: 'Eliminar período de nómina' })).toBeInTheDocument()
    expect(screen.getByText(/Esta acción no se puede deshacer/)).toBeInTheDocument()
    expect(mockEliminar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mockEliminar).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Más acciones para Semana 36' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Eliminar período' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar período' }))
    expect(mockEliminar).toHaveBeenCalledWith('p-abierto', expect.objectContaining({ onSuccess: expect.any(Function) }))
  })

  it('en modo automático abre sola la semana (jueves → miércoles) y oculta «Crear Nuevo Período»', () => {
    mockAsegurar.mockClear()
    configActual = { nomina_periodo_modo: 'automatico', nomina_semana_inicio: 4 }
    renderTab({ puedeGestionarNomina: true })
    expect(mockAsegurar).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /Crear Nuevo Período/i })).not.toBeInTheDocument()
    expect(screen.getByText('jueves')).toBeInTheDocument()
    expect(screen.getByText('miércoles')).toBeInTheDocument()
  })

  it('en modo manual no crea nada solo y ofrece «Crear Nuevo Período»', () => {
    mockAsegurar.mockClear()
    configActual = { nomina_periodo_modo: 'manual', nomina_semana_inicio: 4 }
    renderTab({ puedeGestionarNomina: true })
    expect(mockAsegurar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Crear Nuevo Período/i })).toBeInTheDocument()
    configActual = { nomina_periodo_modo: 'automatico', nomina_semana_inicio: 4 }
  })
})
