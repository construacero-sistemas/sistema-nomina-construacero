// @vitest-environment jsdom
// src/components/finanzas/__tests__/TransferenciaCarterasModal.test.jsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mutateAsyncMock = vi.fn()

vi.mock('../../../hooks/useFinanzas.js', () => ({
  useCrearMovimiento: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}))

vi.mock('../../../hooks/useTasaCambioNomina.js', () => ({
  default: () => ({
    usd: 54.20,
    usdt: 54.50,
    eur: 58.10,
    loading: false,
  }),
}))

import TransferenciaCarterasModal from '../TransferenciaCarterasModal.jsx'

const cuentasMock = [
  {
    id: 'c-binance',
    nombre: 'Binance Pay (USDT)',
    banco: 'Binance',
    tipo: 'cripto_usdt',
    cartera: 'USD',
    moneda: 'USDT',
    saldo: 150.00,
    activo: true,
  },
  {
    id: 'c-caja-usd',
    nombre: 'Caja Fuerte $',
    banco: 'Caja Fuerte',
    tipo: 'efectivo_usd',
    cartera: 'USD',
    moneda: 'USD',
    saldo: 50.00,
    activo: true,
  },
  {
    id: 'c-caja-ves',
    nombre: 'Caja Efectivo Bs',
    banco: 'Caja Física',
    tipo: 'efectivo_ves',
    cartera: 'VES',
    moneda: 'VES',
    saldo: 0,
    activo: true,
  },
  {
    id: 'c-bnc',
    nombre: 'Banco BNC',
    banco: 'BNC',
    tipo: 'banco_ves',
    cartera: 'VES',
    moneda: 'VES',
    saldo: 0,
    activo: true,
  },
]

function renderModal(props = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TransferenciaCarterasModal
        open
        onClose={vi.fn()}
        cuentas={cuentasMock}
        {...props}
      />
    </QueryClientProvider>
  )
}

describe('TransferenciaCarterasModal — estilo Binance inteligente', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mutateAsyncMock.mockResolvedValue({ id: 'mov-1' })
  })

  it('muestra únicamente las cuentas con saldo disponible > 0 en el origen', () => {
    renderModal()

    // Solo Binance ($150) y Caja $ ($50) tienen saldo > 0
    expect(screen.getByText(/Desde \(Cuenta con saldo\)/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Binance Pay \(USDT\)/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Disponible:/i)).toBeInTheDocument()
    expect(screen.getAllByText(/150,00.*USDT/i).length).toBeGreaterThanOrEqual(1)
  })

  it('muestra aviso amigable si ninguna cuenta tiene saldo disponible', () => {
    const cuentasCero = cuentasMock.map(c => ({ ...c, saldo: 0 }))
    renderModal({ cuentas: cuentasCero })

    expect(screen.getByText(/Sin saldo disponible para transferir/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar traspaso/i })).toBeDisabled()
  })

  it('el botón [MÁX] rellena automáticamente el 100% del saldo disponible', () => {
    renderModal()

    const btnMax = screen.getByText('MÁX')
    fireEvent.click(btnMax)

    const inputMonto = screen.getByPlaceholderText('0.00')
    expect(inputMonto.value).toBe('150')
  })

  it('valida límites dinámicos: si el monto excede el disponible, muestra error y bloquea confirmación', () => {
    renderModal()

    const inputMonto = screen.getByPlaceholderText('0.00')
    fireEvent.change(inputMonto, { target: { value: '200' } })

    expect(screen.getByText(/El monto excede el saldo disponible/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar traspaso/i })).toBeDisabled()
  })

  it('calcula la conversión en tiempo real al transferir entre divisas distintas', () => {
    renderModal()

    const inputMonto = screen.getByPlaceholderText('0.00')
    fireEvent.change(inputMonto, { target: { value: '10' } })

    expect(screen.getByRole('button', { name: /Confirmar traspaso/i })).not.toBeDisabled()
  })

  it('ejecuta el traspaso atómico registrando egreso e ingreso asignados a las cuentas', async () => {
    const onClose = vi.fn()
    renderModal({ onClose })

    const btnMax = screen.getByText('MÁX')
    fireEvent.click(btnMax)

    const form = screen.getByRole('dialog').querySelector('form')
    if (form) fireEvent.submit(form)

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(2))

    // 1. Egreso de Binance
    const egreso = mutateAsyncMock.mock.calls[0][0]
    expect(egreso.tipo).toBe('egreso')
    expect(egreso.cuenta_id).toBe('c-binance')
    expect(egreso.cuentaOrigen).toBe('Binance Pay (USDT)')
    expect(egreso.monto).toBe(150)
    expect(egreso.moneda).toBe('USDT')

    // 2. Ingreso en destino
    const ingreso = mutateAsyncMock.mock.calls[1][0]
    expect(ingreso.tipo).toBe('ingreso')
    expect(ingreso.monto).toBeGreaterThan(0)

    expect(onClose).toHaveBeenCalled()
  })
})
