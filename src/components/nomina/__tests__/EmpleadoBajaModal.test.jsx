// @vitest-environment jsdom
// src/components/nomina/__tests__/EmpleadoBajaModal.test.jsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EmpleadoBajaModal from '../EmpleadoBajaModal.jsx'

describe('EmpleadoBajaModal', () => {
  it('renderiza advertencia y nombre del empleado', () => {
    const empleado = { empleado: { nombre: 'Pedro Pérez' } }
    render(
      <EmpleadoBajaModal
        isOpen
        empleado={empleado}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    )

    expect(screen.getByText('Confirmar baja del trabajador')).toBeTruthy()
    expect(screen.getByText(/Pedro Pérez/)).toBeTruthy()
    expect(screen.getByText('Confirmar Baja')).toBeTruthy()
  })

  it('llama a onConfirm al presionar el botón de confirmación', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <EmpleadoBajaModal
        isOpen
        empleado={{ nombre: 'Ana Gómez' }}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    )

    fireEvent.click(screen.getByText('Confirmar Baja'))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Cancelar'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
