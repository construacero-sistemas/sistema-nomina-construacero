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

vi.mock('../../../hooks/useNomina', () => ({
  useNominaPeriodos: () => ({ data: periodos, isLoading: false, isError: false, refetch: vi.fn() }),
  useCalcularPeriodo: () => ({ mutate: vi.fn(), isPending: false }),
  useCerrarPeriodo: () => ({ mutate: vi.fn(), isPending: false }),
  useEliminarPeriodo: () => ({ mutate: mockEliminar, isPending: false }),
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
  it('muestra importe neto, deducciones y pasos; la acción principal cambia según el estado', () => {
    renderTab({ puedeGestionarNomina: true, puedePagarNomina: true })

    expect(screen.getAllByText('Neto a pagar · USD')).toHaveLength(3)
    expect(screen.getAllByText('Deducciones')).toHaveLength(3)
    expect(screen.getByText('Pendiente de cálculo')).toBeInTheDocument()
    expect(screen.getByText('Calculado · revisar antes de cerrar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Calcular nómina' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recalcular' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar para pago' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pagar recibos' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar para pago' }))
    const confirmacion = screen.getByRole('group', { name: 'Confirmar cierre de Semana 36' })
    expect(confirmacion).toHaveClass('col-span-2')
    expect(within(confirmacion).getByRole('button', { name: 'Confirmar cierre' })).toBeInTheDocument()
    expect(within(confirmacion).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.getByText('≈ Bs 175')).toBeInTheDocument()
  })

  it('oculta las acciones de escritura sin su capacidad correspondiente', () => {
    renderTab()
    expect(screen.queryByRole('button', { name: /Crear Nuevo Período/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Calcular nómina/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cerrar para pago/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pagar recibos/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Más acciones para/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Ver recibos/i })).toHaveLength(3)
  })

  it('gestionar y pagar siguen siendo capacidades separadas', () => {
    const view = renderTab({ puedeGestionarNomina: true })
    expect(screen.getByRole('button', { name: 'Calcular nómina' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recalcular' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pagar recibos' })).not.toBeInTheDocument()
    view.unmount()

    renderTab({ puedePagarNomina: true })
    expect(screen.getByRole('button', { name: 'Pagar recibos' })).toBeInTheDocument()
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
})
