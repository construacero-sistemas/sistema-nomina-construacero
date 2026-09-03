// @vitest-environment jsdom
// src/components/finanzas/__tests__/MovimientoTable.test.jsx
// Tests del botón "Restaurar" en filas anuladas: la anulación siempre es reversible.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import MovimientoTable from '../MovimientoTable.jsx'

const mkMov = (overrides = {}) => ({
  id: 'm-1',
  fecha: '2026-09-01',
  tipo: 'egreso',
  categoria: 'Proveedores',
  concepto: 'Cemento',
  monto: 100,
  moneda: 'USD',
  monto_ves: 40000,
  estado: 'activo',
  ...overrides,
})

function renderTable(movimientos, { onAnular = vi.fn(), onRevertir = vi.fn() } = {}) {
  return render(<MovimientoTable movimientos={movimientos} onAnular={onAnular} onRevertir={onRevertir} />)
}

describe('MovimientoTable — reversibilidad de anulaciones', () => {
  beforeEach(() => vi.clearAllMocks())

  it('las filas activas ofrecen Anular y las anuladas ofrecen Restaurar', () => {
    renderTable([
      mkMov({ id: 'm-activo' }),
      mkMov({ id: 'm-anulado', estado: 'anulado' }),
    ])

    expect(screen.getByLabelText('Anular movimiento')).toBeInTheDocument()
    expect(screen.getByLabelText('Revertir anulación')).toBeInTheDocument()
  })

  it('Restaurar invoca onRevertir con el movimiento anulado', () => {
    const onRevertir = vi.fn()
    const anulado = mkMov({ id: 'm-anulado', estado: 'anulado' })
    renderTable([anulado], { onRevertir })

    fireEvent.click(screen.getByLabelText('Revertir anulación'))
    expect(onRevertir).toHaveBeenCalledTimes(1)
    expect(onRevertir).toHaveBeenCalledWith(anulado)
  })

  it('Anular sigue invocando onAnular con el movimiento activo', () => {
    const onAnular = vi.fn()
    const activo = mkMov({ id: 'm-activo' })
    renderTable([activo], { onAnular })

    fireEvent.click(screen.getByLabelText('Anular movimiento'))
    expect(onAnular).toHaveBeenCalledWith(activo)
  })
})
