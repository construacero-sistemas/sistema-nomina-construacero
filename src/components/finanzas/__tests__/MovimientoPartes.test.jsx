// @vitest-environment jsdom
// src/components/finanzas/__tests__/MovimientoPartes.test.jsx
// Tests del editor de pago en varias partes: activar, añadir y sumar tramos.
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import MovimientoPartes from '../MovimientoPartes.jsx'

function setup() {
  const onChange = vi.fn()
  const props = {
    montoTotal: 300000,
    partes: [],
    onChange,
    disabled: false,
    moneda: 'VES',
  }
  const utils = render(<MovimientoPartes {...props} />)
  return { onChange, ...utils }
}

describe('MovimientoPartes', () => {
  it('al activar el toggle siembra un tramo inicial con el monto total', () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledTimes(1)
    const [partes] = onChange.mock.calls[0]
    expect(partes).toEqual([{ monto: 300000, referencia: '' }])
  })

  it('muestra la suma y marca el total cuando las partes coinciden', () => {
    const onChange = vi.fn()
    render(<MovimientoPartes montoTotal={300000} partes={[{ monto: 100000, referencia: 'OP-1' }, { monto: 200000, referencia: 'OP-2' }]} onChange={onChange} disabled={false} moneda="VES" />)
    expect(screen.getByText(/suma:/i)).toBeInTheDocument()
    expect(screen.getByText(/total 300\.000,00 ves/i)).toBeInTheDocument()
  })

  it('advierte cuando falta monto por asignar', () => {
    const onChange = vi.fn()
    render(<MovimientoPartes montoTotal={300000} partes={[{ monto: 100000, referencia: '' }]} onChange={onChange} disabled={false} moneda="VES" />)
    expect(screen.getByText(/falta 200\.000,00 ves/i)).toBeInTheDocument()
  })
})
