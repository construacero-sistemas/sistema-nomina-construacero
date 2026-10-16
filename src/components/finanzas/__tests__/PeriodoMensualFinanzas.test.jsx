// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import PeriodoMensualFinanzas from '../PeriodoMensualFinanzas.jsx'

const rates = { usd: 410, usdt: 450, source: 'BCV', lastUpdate: '2026-10-01', stale: false }

function wallet(overrides = {}) {
  return {
    cuentaCustodiaId: 'wallet-1', nombre: 'Caja USD', moneda: 'USD', activo: true,
    saldoApertura: null, saldoAperturaUsd: null, saldoCalculado: null,
    metodoApertura: null, diferenciaApertura: null, diferenciaCierre: null,
    ...overrides,
  }
}

function renderPanel(props = {}) {
  const onOpen = vi.fn(async () => ({}))
  const onClose = vi.fn(async () => ({}))
  const onRefresh = vi.fn(async () => {})
  const utils = render(
    <PeriodoMensualFinanzas
      periodo={{ mes: '2026-10-01', estado: 'sin_apertura', cuentas: [], cuentasPendientes: [], cierreAnterior: [], ...props.periodo }}
      saldos={null}
      cuentas={props.cuentas || [{ id: 'wallet-1', nombre: 'Caja USD', moneda: 'USD', activo: true }]}
      loading={false}
      error=""
      pending={false}
      rates={props.rates || rates}
      onRefresh={onRefresh}
      onOpen={onOpen}
      onClose={onClose}
    />,
  )
  return { ...utils, onOpen, onClose, onRefresh }
}

afterEach(cleanup)

describe('PeriodoMensualFinanzas — aviso y apertura guiada', () => {
  it('muestra el aviso pre-apertura y bloquea el wizard sin tasas confirmadas', () => {
    renderPanel({ rates: { ...rates, usd: 0 } })
    expect(screen.getByRole('status')).toHaveTextContent(/no está aperturado/i)
    expect(screen.getByRole('button', { name: /Iniciar apertura guiada/ })).toBeDisabled()
  })

  it('el wizard congela las tasas y envía el saldo físico de cada cuenta', async () => {
    const { onOpen, onRefresh } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Iniciar apertura guiada/ }))
    expect(screen.getByText(/Las tasas se fijan ahora y no se actualizan/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    const saldoInput = screen.getByLabelText(/Saldo contado/)
    fireEvent.change(saldoInput, { target: { value: '250.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByText(/Tasas congeladas: USD\/VES 410; USDT\/VES 450/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Confirmar apertura/ }))
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1))
    const call = onOpen.mock.calls[0][0]
    expect(call.accion).toBe('aperturar')
    expect(call.mesInicio).toBe('2026-10-01')
    expect(call.idempotencyKey).toBeTruthy()
    expect(call.payload.tasaUsdVes).toBe('410')
    expect(call.payload.tasaUsdtVes).toBe('450')
    expect(call.payload.cuentas).toEqual([
      { cuentaCustodiaId: 'wallet-1', metodo: 'saldo_real', saldoReal: 250.5, tasaUsdVes: '410', tasaUsdtVes: '450' },
    ])
    await vi.waitFor(() => {
      expect(onRefresh).toHaveBeenCalled()
      expect(screen.getByText(/Apertura mensual confirmada/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /Confirmar apertura/ })).not.toBeInTheDocument()
  })
})

describe('PeriodoMensualFinanzas — cierre con diferencias', () => {
  const periodoAbierto = {
    periodo: {
      mes: '2026-10-01', estado: 'abierto', cuentasPendientes: [], cierreAnterior: [],
      cuentas: [wallet({ saldoApertura: 100, saldoAperturaUsd: 100, saldoCalculado: 120, metodoApertura: 'saldo_real' })],
    },
  }

  it('sin motivo exige justificación y no confirma el cierre', () => {
    const { onClose } = renderPanel(periodoAbierto)
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '130' } })
    fireEvent.click(screen.getByRole('button', { name: /Cerrar mes/ }))
    expect(screen.getByRole('status')).toHaveTextContent(/Justifica con al menos 8 caracteres/)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('con motivo documentado congela el saldo contado y confirma', async () => {
    const { onClose, onRefresh } = renderPanel(periodoAbierto)
    fireEvent.change(screen.getByLabelText(/Saldo contado/), { target: { value: '130' } })
    fireEvent.change(screen.getByLabelText(/Motivo de diferencia/), { target: { value: 'Conteo físico documentado' } })
    fireEvent.click(screen.getByRole('button', { name: /Cerrar mes/ }))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const call = onClose.mock.calls[0][0]
    expect(call.accion).toBe('cerrar')
    expect(call.payload.cuentas).toEqual([
      { cuentaCustodiaId: 'wallet-1', saldoReal: 130, motivo: 'Conteo físico documentado', tasaUsdVes: '410', tasaUsdtVes: '450' },
    ])
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })
})
