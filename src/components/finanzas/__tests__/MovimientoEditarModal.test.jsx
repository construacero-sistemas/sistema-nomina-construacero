// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import MovimientoEditarModal from '../MovimientoEditarModal.jsx'

afterEach(cleanup)

const fakeMovimiento = {
  id: '10000000-0000-4000-8000-000000000001',
  fecha: '2026-09-01',
  tipo: 'egreso',
  categoria: 'Servicios',
  concepto: 'Pago electricidad',
  referencia: 'Factura 1234',
  monto: 50,
  moneda: 'USD',
}

const fakeCategorias = [
  { id: 'cat-1', nombre: 'Servicios' },
  { id: 'cat-2', nombre: 'Proveedores' },
  { id: 'cat-3', nombre: 'Ventas' },
]

describe('MovimientoEditarModal', () => {
  it('renderiza con los datos iniciales del movimiento', () => {
    render(
      <MovimientoEditarModal
        open={true}
        movimiento={fakeMovimiento}
        categorias={fakeCategorias}
        onClose={vi.fn()}
        onGuardar={vi.fn()}
      />
    )

    expect(screen.getByText('Editar Movimiento')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Pago electricidad')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Factura 1234')).toBeInTheDocument()
  })

  it('permite cambiar el concepto y llamar a onGuardar con los datos actualizados', async () => {
    const handleGuardar = vi.fn().mockResolvedValue({})
    render(
      <MovimientoEditarModal
        open={true}
        movimiento={fakeMovimiento}
        categorias={fakeCategorias}
        onClose={vi.fn()}
        onGuardar={handleGuardar}
      />
    )

    const conceptoInput = screen.getByDisplayValue('Pago electricidad')
    fireEvent.change(conceptoInput, { target: { value: 'Pago internet fibra' } })

    const saveButton = screen.getByRole('button', { name: /Guardar cambios/i })
    expect(saveButton).not.toBeDisabled()

    fireEvent.click(saveButton)
    expect(handleGuardar).toHaveBeenCalledWith({
      id: fakeMovimiento.id,
      categoria: 'Servicios',
      concepto: 'Pago internet fibra',
      referencia: 'Factura 1234',
    })
  })

  it('deshabilita el botón de guardar si el concepto está vacío', () => {
    render(
      <MovimientoEditarModal
        open={true}
        movimiento={fakeMovimiento}
        categorias={fakeCategorias}
        onClose={vi.fn()}
        onGuardar={vi.fn()}
      />
    )

    const conceptoInput = screen.getByDisplayValue('Pago electricidad')
    fireEvent.change(conceptoInput, { target: { value: '   ' } })

    const saveButton = screen.getByRole('button', { name: /Guardar cambios/i })
    expect(saveButton).toBeDisabled()
  })
})
