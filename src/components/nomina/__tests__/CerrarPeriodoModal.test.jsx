// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({
  cerrar: vi.fn().mockResolvedValue({ ok: true, pagado: true }),
  lineas: [
    { id: 'l1', total_bruto_usd: 75, deducciones_usd: 5, total_neto_usd: 70, horas_extra: 2, monto_extra_usd: 5, dias_ausencia: 1, dias_sabado: 0, dias_feriado: 1 },
  ],
}))

vi.mock('../../../hooks/useNomina', () => ({
  useNominaLineas: () => ({ data: mocks.lineas, isLoading: false }),
  useCerrarPeriodo: () => ({ mutateAsync: mocks.cerrar, isPending: false }),
}))
vi.mock('../../../hooks/useAutoCalculoPeriodo.js', () => ({
  default: () => ({ calculando: false, error: '' }),
}))
vi.mock('../../../hooks/useTasaCambioNomina.js', () => ({
  default: () => ({ usd: 420, eur: 460, usdt: 480 }),
}))
vi.mock('../../../hooks/useMonedaNomina.js', () => ({
  default: () => ({ tipoTasa: 'bcv_usd', tasaActiva: 420, tasaManual: 0 }),
  formatBs: n => `Bs ${(Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
}))

import CerrarPeriodoModal from '../CerrarPeriodoModal.jsx'

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('CerrarPeriodoModal', () => {
  const periodo = { id: 'p1', nombre: 'Semana 47-2026 (12 nov – 18 nov)', desde: '2026-11-12', hasta: '2026-11-18', estado: 'abierto' }

  it('muestra resumen semanal, convierte el neto con la tasa elegida y envía tasaPago al cerrar', async () => {
    const onClose = vi.fn()
    render(<CerrarPeriodoModal periodo={periodo} onClose={onClose} />)

    expect(screen.getByText(/Cerrar Semana 47-2026/)).toBeInTheDocument()
    expect(screen.getByText('$70,00 USD')).toBeInTheDocument()
    expect(screen.getByText('2.0 h')).toBeInTheDocument()
    // 70 * 420 (BCV $) = Bs 29.400,00
    expect(screen.getByText('Bs 29.400,00')).toBeInTheDocument()

    // Cambiar a tasa USDT (480) -> 70 * 480 = Bs 33.600,00
    fireEvent.click(screen.getByRole('button', { name: /USDT/ }))
    expect(screen.getByText('Bs 33.600,00')).toBeInTheDocument()

    // Ajustar manualmente con coma decimal -> 500,5 -> 70 * 500.5 = Bs 35.035,00
    const input = screen.getByLabelText(/Tasa aplicada/)
    fireEvent.change(input, { target: { value: '500,5' } })
    expect(screen.getByText('Bs 35.035,00')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Confirmar cierre y pagar/ }))
    await waitFor(() => expect(mocks.cerrar).toHaveBeenCalledWith(expect.objectContaining({
      periodoId: 'p1',
      tasaPago: 500.5,
      fuenteTasaPago: 'USDT',
    })))
    expect(onClose).toHaveBeenCalled()
  })

  it('bloquea el cierre si la tasa es 0 o inválida', () => {
    render(<CerrarPeriodoModal periodo={periodo} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Tasa aplicada/), { target: { value: '0' } })
    expect(screen.getByRole('button', { name: /Confirmar cierre y pagar/ })).toBeDisabled()
  })
})
