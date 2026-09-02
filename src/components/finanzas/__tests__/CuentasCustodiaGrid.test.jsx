// @vitest-environment jsdom
// src/components/finanzas/__tests__/CuentasCustodiaGrid.test.jsx
// Tests del borrado seguro de cuentas de custodia: bloqueo con saldo, permitir
// dejar el sistema SIN cuentas y estado vacío con restauración.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import CuentasCustodiaGrid from '../CuentasCustodiaGrid.jsx'

const mkCuenta = (overrides = {}) => ({
  id: 'c-1',
  nombre: 'Banesco',
  moneda: 'VES',
  banco: 'Banesco',
  saldo: 0,
  ...overrides,
})

function renderGrid(cuentas, onEliminarCuenta = vi.fn(), extraProps = {}) {
  const utils = render(
    <CuentasCustodiaGrid
      cuentas={cuentas}
      onNuevaCuenta={vi.fn()}
      onEditarCuenta={vi.fn()}
      onEliminarCuenta={onEliminarCuenta}
      onVerDetalle={vi.fn()}
      onTransferir={vi.fn()}
      {...extraProps}
    />
  )
  // Expandir todas las cuentas
  fireEvent.click(screen.getByText(/Ver cuentas a detalle/i))
  return utils
}

describe('CuentasCustodiaGrid — borrado seguro', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra el botón eliminar en todas las cuentas (incluidas las predeterminadas)', () => {
    const cuenta = mkCuenta({ predeterminada: true })
    renderGrid([cuenta])
    expect(screen.getAllByLabelText(/Eliminar cuenta/i)).toHaveLength(1)
  })

  it('bloquea la eliminación de una cuenta con saldo distinto de 0 y no llama al callback', () => {
    const onEliminar = vi.fn()
    const cuenta = mkCuenta({ saldo: 1500 })
    renderGrid([cuenta, mkCuenta({ id: 'c-2', nombre: 'Otra' })], onEliminar)

    fireEvent.click(screen.getByLabelText(/Eliminar cuenta Banesco/i))

    // El modal de bloqueo no debe ofrecer el botón de confirmación destructivo
    expect(screen.queryByRole('button', { name: 'Eliminar cuenta' })).toBeNull()
    expect(screen.getByText(/deja primero el saldo en 0/i)).toBeInTheDocument()

    // Botón de cierre del modal de bloqueo
    fireEvent.click(screen.getByRole('button', { name: /Entendido/i }))
    expect(onEliminar).not.toHaveBeenCalled()
  })

  it('PERMITE eliminar la última cuenta (el sistema puede quedar sin cuentas)', () => {
    const onEliminar = vi.fn()
    const cuenta = mkCuenta()
    renderGrid([cuenta], onEliminar)

    fireEvent.click(screen.getByLabelText(/Eliminar cuenta Banesco/i))
    // Ofrece la confirmación destructiva (no bloquea por ser la última)
    expect(screen.getByRole('button', { name: 'Eliminar cuenta' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar cuenta' }))

    expect(onEliminar).toHaveBeenCalledTimes(1)
    expect(onEliminar).toHaveBeenCalledWith(cuenta.id)
  })

  it('muestra estado vacío con botones de crear y restaurar cuando no hay cuentas', () => {
    const onNueva = vi.fn()
    const onRestaurar = vi.fn()
    renderGrid([], vi.fn(), { onNuevaCuenta: onNueva, onRestaurar })

    expect(screen.getByText(/Sin cuentas de custodia/i)).toBeInTheDocument()
    // La descripción menciona las cuentas de ejemplo (1 match en párrafo + 1 en botón)
    expect(screen.getAllByText(/cuentas de ejemplo/i).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Crear primera cuenta/i }))
    expect(onNueva).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /Restaurar cuentas de ejemplo/i }))
    expect(onRestaurar).toHaveBeenCalledTimes(1)
  })

  it('oculta el botón restaurar en el estado vacío si no se pasa onRestaurar', () => {
    renderGrid([], vi.fn())
    expect(screen.getByText(/Sin cuentas de custodia/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Restaurar cuentas de ejemplo/i })).toBeNull()
  })

  it('pide confirmación y elimina cuando la cuenta no tiene saldo', () => {
    const onEliminar = vi.fn()
    const cuenta = mkCuenta()
    renderGrid([cuenta, mkCuenta({ id: 'c-2', nombre: 'Mercantil' })], onEliminar)

    fireEvent.click(screen.getByLabelText(/Eliminar cuenta Banesco/i))
    // Confirmación destructiva visible
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar cuenta' }))

    expect(onEliminar).toHaveBeenCalledTimes(1)
    expect(onEliminar).toHaveBeenCalledWith(cuenta.id)
  })
})
