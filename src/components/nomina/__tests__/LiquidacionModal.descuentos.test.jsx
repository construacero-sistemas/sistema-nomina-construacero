// @vitest-environment jsdom
// src/components/nomina/__tests__/LiquidacionModal.descuentos.test.jsx
// Regla vigente: cada descuento del recibo exige motivo obligatorio (Anticipo,
// Préstamo, Falta, Multa u Otro) y el conjunto nunca deja el neto en negativo.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const capturas = { payload: null, llamadas: 0 }
vi.mock('../../../hooks/useNomina', () => ({
  useAjustarLinea: () => ({
    mutateAsync: async (campos) => { capturas.payload = campos; capturas.llamadas += 1; return { ok: true } },
    isPending: false,
  }),
}))

const LiquidacionModal = (await import('../LiquidacionModal.jsx')).default

function lineaBase(overrides = {}) {
  return {
    id: 'l1',
    empleado: { nombre: 'ana perez' },
    salario_dia_usd_snap: 10,
    dias_trabajados: 5,
    horas_extra: 0,
    dias_sabado: 0,
    dias_feriado: 0,
    dias_ausencia: 0,
    monto_normal_usd: 50,
    monto_extra_usd: 0,
    monto_sabado_usd: 0,
    monto_feriado_usd: 0,
    bonos_usd: 0,
    deducciones_usd: 0,
    descuentos: [],
    ...overrides,
  }
}

function renderModal(linea, onClose = vi.fn()) {
  render(<LiquidacionModal linea={linea} onClose={onClose} />)
  return onClose
}

describe('LiquidacionModal — descuentos con motivo obligatorio', () => {
  it('carga el desglose guardado con su motivo, monto y detalle', () => {
    renderModal(lineaBase({
      descuentos: [{ id: 'd1', motivo: 'prestamo', detalle: 'cuota 1 de 3', monto_usd: 25 }],
    }))
    expect(screen.getByText('Préstamo')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Monto del descuento' })).toHaveValue(25)
    expect(screen.getByLabelText('Detalle del descuento')).toHaveValue('cuota 1 de 3')
  })

  it('una fila nueva exige motivo: queda bloqueada hasta completarla', () => {
    renderModal(lineaBase())
    fireEvent.click(screen.getByRole('button', { name: /Agregar descuento/ }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Elige el motivo del descuento/)
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  })

  it('bloquea el conjunto de descuentos que dejaría el neto en negativo', () => {
    renderModal(lineaBase({
      descuentos: [{ id: 'd1', motivo: 'falta', detalle: null, monto_usd: 9999 }],
    }))
    expect(screen.getByRole('alert')).toHaveTextContent(/neto no puede quedar en negativo/)
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  })

  it('guarda la lista con motivo, monto y detalle', async () => {
    const onClose = renderModal(lineaBase({
      descuentos: [{ id: 'd1', motivo: 'anticipo', detalle: 'Adelanto', monto_usd: 10 }],
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await vi.waitFor(() => expect(capturas.llamadas).toBe(1))
    expect(capturas.payload).toMatchObject({
      lineaId: 'l1',
      bonosUsd: 0,
      descuentos: [{ motivo: 'anticipo', detalle: 'Adelanto', monto: 10 }],
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('un recibo histórico sin desglose conserva su deducción global con motivo Otro', () => {
    renderModal(lineaBase({ deducciones_usd: 15, nota_deducciones: 'Anticipo quincenal' }))
    expect(screen.getByText('Otro')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Monto del descuento' })).toHaveValue(15)
    expect(screen.getByLabelText('Detalle del descuento')).toHaveValue('Anticipo quincenal')
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled()
  })
})
