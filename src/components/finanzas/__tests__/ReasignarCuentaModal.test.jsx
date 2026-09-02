// @vitest-environment jsdom
// src/components/finanzas/__tests__/ReasignarCuentaModal.test.jsx
// Tests del flujo de re-asignación masiva de movimientos sin cuenta.
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

import ReasignarCuentaModal from '../ReasignarCuentaModal.jsx'
import { asignarMovimientoACuenta } from '../../../../server/lib/carterasHelper.js'

vi.mock('../../../../compat/components/ui/Modal.jsx', async importOriginal => {
  const actual = await importOriginal()
  return { Modal: actual.Modal }
})

const CUENTAS = [
  { id: 'c1', nombre: 'Banco BNC', banco: 'BNC', moneda: 'VES', subcuentaId: 'Banco en Bolívares' },
  { id: 'c2', nombre: 'Caja Efectivo Bs', banco: '', moneda: 'VES', subcuentaId: 'Efectivo Bs' },
]

const SIN_CUENTA = [
  { id: 'm1', fecha: '2026-09-01', tipo: 'egreso', categoria: 'Proveedores', concepto: 'Cemento', monto: 50, moneda: 'USD' },
  { id: 'm2', fecha: '2026-09-02', tipo: 'ingreso', categoria: 'Ventas', concepto: 'Venta mostrador', monto: 100, moneda: 'USD' },
]

const CON_CUENTA =
  { id: 'm3', fecha: '2026-09-03', tipo: 'ingreso', categoria: 'Ventas', concepto: 'Con cuenta', monto: 10, moneda: 'USD', cuenta_origen: 'Banco BNC' }

function setup(movimientos, props = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(
    <ReasignarCuentaModal
      open
      onClose={onClose}
      movimientos={movimientos}
      cuentas={CUENTAS}
      onConfirm={onConfirm}
      {...props}
    />,
  )
  return { onConfirm, onClose }
}

// Abre el CustomSelect de destino y elige la opción cuyo label coincida.
// El dropdown se renderiza en un portal; la opción es un <button role="option">.
async function pickCuenta(user, label) {
  await user.click(screen.getByText(/selecciona una cuenta/i))
  const opt = await screen.findByRole('option', { name: new RegExp(label, 'i') })
  await user.click(opt)
}

describe('ReasignarCuentaModal', () => {
  it('lista solo los movimientos activos sin cuenta asignada', () => {
    setup([...SIN_CUENTA, CON_CUENTA])
    expect(screen.getByText('Cemento')).toBeInTheDocument()
    expect(screen.getByText('Venta mostrador')).toBeInTheDocument()
    expect(screen.queryByText('Con cuenta')).not.toBeInTheDocument()
  })

  it('muestra estado vacío cuando todo está clasificado', () => {
    setup([CON_CUENTA])
    expect(screen.getByText('Todo clasificado')).toBeInTheDocument()
  })

  it('no permite confirmar sin cuenta destino ni selección', () => {
    const { onConfirm } = setup(SIN_CUENTA)
    const boton = screen.getByRole('button', { name: 'Asignar cuenta' })
    expect(boton).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirma con ids seleccionados y el nombre de la cuenta destino', async () => {
    const user = userEvent.setup()
    const { onConfirm } = setup(SIN_CUENTA)
    await pickCuenta(user, 'Banco BNC')
    fireEvent.click(screen.getByLabelText(/Venta mostrador/))
    fireEvent.click(screen.getByRole('button', { name: 'Asignar cuenta' }))
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith({ ids: ['m2'], cuentaOrigen: 'Banco BNC' })
    })
  })

  it("'Seleccionar todos' marca todos los movimientos listados", async () => {
    const user = userEvent.setup()
    const { onConfirm } = setup(SIN_CUENTA)
    await pickCuenta(user, 'Caja Efectivo Bs')
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar todos' }))
    fireEvent.click(screen.getByRole('button', { name: 'Asignar cuenta' }))
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith({ ids: ['m1', 'm2'], cuentaOrigen: 'Caja Efectivo Bs' })
    })
  })

  it('asignarMovimientoACuenta coincide por nombre exacto de cuenta_origen', () => {
    expect(asignarMovimientoACuenta({ cuenta_origen: 'Banco BNC' }, CUENTAS)?.id).toBe('c1')
    expect(asignarMovimientoACuenta({ cuenta_origen: 'Banesco' }, CUENTAS)).toBeNull()
  })
})
