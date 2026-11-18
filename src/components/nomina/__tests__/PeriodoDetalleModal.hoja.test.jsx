// @vitest-environment jsdom
// Detalle del período → pestaña «Hoja semanal» (docs/PLAN_HOJA_SEMANAL.md): se abre
// desde el detalle y el descuento manual de la hoja abre el MISMO ajuste del recibo.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const LINEA = {
  id: 'l1', empleado: { nombre: 'pedro perez' }, cargo_snap: 'Obrero', salario_dia_usd_snap: 8, dias_trabajados: 5, dias_descanso: 2,
  horas_normales: 40, horas_extra: 0, monto_normal_usd: 56, monto_extra_usd: 0, monto_sabado_usd: 0, monto_feriado_usd: 0,
  bonos_usd: 0, comisiones_pos_usd: 0, deducciones_usd: 0, total_bruto_usd: 56, total_neto_usd: 56, pagado: false, descuentos: [],
}

vi.mock('../../../hooks/useNomina', () => ({
  useConfigNomina: () => ({ data: undefined, isLoading: false }),
  useNominaLineas: () => ({ data: [LINEA], isLoading: false, isError: false, refetch: vi.fn() }),
  useRevertirPagoLinea: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTasasPeriodo: () => ({ data: [], isLoading: false }),
  useAjustarLinea: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../../hooks/useHojaSemanal.js', () => ({
  default: () => ({
    isLoading: false, isError: false, refetch: vi.fn(),
    data: {
      bonoSemanal: 35,
      filas: [{ lineaId: 'l1', empleadoId: 'e1', nombre: 'pedro perez', sueldoMensual: 240, diasTrabajados: 5, semana: 56, sueldoSemanal: 21, bonoSemanal: 35,
        horasExtra: 0, totalExtras: 0, diasDescansoTrabajados: 0, valorDescansoTrabajado: 0, otrosPagos: 0, totalACobrar: 56, descuentos: 0, neto: 56, pagado: false }],
      totales: { empleados: 1, sueldoSemanal: 21, bonoSemanal: 35, horasExtra: 0, totalExtras: 0, diasDescansoTrabajados: 0, valorDescansoTrabajado: 0, otrosPagos: 0, totalACobrar: 56, descuentos: 0, neto: 56 },
    },
  }),
}))
vi.mock('../../../hooks/useMonedaNomina.js', () => ({
  default: () => ({ aBs: n => Number(n) * 100, fmtBs: n => `${n} Bs`, tasaActiva: 100, shortLabelTasa: 'BCV' }),
  formatBs: n => `${Number(n).toFixed(2)} Bs`,
  formatUsd: n => `$${n}`,
}))
vi.mock('../../../../compat/hooks/useConfigNegocio.js', () => ({ useConfigNegocio: () => ({ data: {} }) }))

const PeriodoDetalleModal = (await import('../PeriodoDetalleModal.jsx')).default

describe('Detalle del período → Hoja semanal', () => {
  it('abre la hoja en su pestaña y el descuento manual abre el ajuste de esa persona', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PeriodoDetalleModal periodo={{ id: 'p1', nombre: 'Semana', estado: 'abierto', desde: '2026-11-05', hasta: '2026-11-11' }} puedeGestionarNomina onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('tab', { name: 'Recibos' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Hoja semanal' }))
    expect(screen.getByRole('tab', { name: 'Hoja semanal' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('table', { name: 'Hoja semanal del período' })).toBeInTheDocument()
    // Neto en Bs con la tasa activa: 56 × 100.
    expect(screen.getByRole('rowheader', { name: 'Pedro Perez' }).closest('tr')).toHaveTextContent('5600.00 Bs')

    fireEvent.click(screen.getByRole('button', { name: 'Descuento a Pedro Perez' }))
    expect(screen.getByRole('dialog', { name: /Ajustar pago: Pedro Perez/ })).toBeInTheDocument()
  })
})
