import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
const operation = vi.hoisted(() => ({ mutateAsync: vi.fn(), checkStatus: vi.fn(), isPending: false, operationId: null }))
vi.mock('../../../hooks/useFinancialOperation.js', () => ({ default: () => operation }))
vi.mock('../../../hooks/useTasaCambioNomina.js', () => ({ default: () => ({ usd: 400, usdt: 440, eur: 450 }) }))
import TransferenciaCarterasModal from '../TransferenciaCarterasModal.jsx'
const accounts = [
  { id: '10000000-0000-4000-8000-000000000001', nombre: 'Caja USD', moneda: 'USD', saldo: 50, saldoConfirmado: true, disponible: true },
  { id: '10000000-0000-4000-8000-000000000002', nombre: 'Banco VES', moneda: 'VES', saldo: 0, saldoConfirmado: true, disponible: true },
  { id: '10000000-0000-4000-8000-000000000003', nombre: 'Binance', moneda: 'USDT', saldo: 150, saldoConfirmado: true, disponible: true },
]
const mount = (props = {}) => render(<TransferenciaCarterasModal open cuentas={accounts} onClose={vi.fn()} {...props} />)
const target = async user => { await user.click(screen.getByRole('combobox', { name: 'Hacia' })); await user.click(screen.getByRole('option', { name: /Banco VES/ })) }
beforeEach(() => { vi.clearAllMocks(); operation.isPending = false; operation.operationId = null; operation.mutateAsync.mockResolvedValue({ estado: 'confirmada' }) })
describe('Traspasos: confirmación única, saldos y unidades', () => {
  it('muestra saldo confirmado y requiere destino explícito', () => {
    mount()
    expect(screen.getByText('Disponible: 50 USD')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar traspaso' })).toBeDisabled()
  })
  it('permite a finanzas elegir una cuenta sin revelar saldo y delega el control de fondos al servidor', async () => {
    const user = userEvent.setup(), onClose = vi.fn()
    mount({ cuentas: accounts.map(({ saldo, disponible, saldoConfirmado, ...cuenta }) => cuenta), validarFondosEnServidor: true, onClose })
    expect(screen.getByText('Disponible: El servidor validará el saldo al confirmar')).toBeInTheDocument()
    expect(screen.queryByText(/50 USD/)).not.toBeInTheDocument()
    await target(user)
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '10' } })
    expect(screen.getByRole('button', { name: 'Confirmar traspaso' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Confirmar traspaso' }))
    await waitFor(() => expect(operation.mutateAsync).toHaveBeenCalledTimes(1))
  })
  it.each([null, 500])('saldo %s sin confirmar no habilita transferencias', saldo => {
    mount({ cuentas: accounts.map(c => ({ ...c, saldo, saldoConfirmado: false, disponible: false })) })
    expect(screen.getByRole('status')).toHaveTextContent('Sin saldo disponible')
    expect(screen.getByRole('button', { name: 'Confirmar traspaso' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Usar máximo confirmado' })).not.toBeInTheDocument()
  })
  it('máximo usa unidades nativas y exceso bloquea la confirmación', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Usar máximo confirmado' }))
    expect(screen.getByPlaceholderText('0.00')).toHaveValue('50')
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '51' } })
    expect(screen.getByRole('alert')).toHaveTextContent('excede el saldo')
    expect(screen.getByRole('button', { name: 'Confirmar traspaso' })).toBeDisabled()
  })
  it('envía una sola operación con tasa, cuentas y fecha, nunca dos movimientos', async () => {
    const user = userEvent.setup(), onClose = vi.fn()
    mount({ onClose })
    await target(user)
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '10' } })
    expect(screen.getByText('4.000 VES')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmar traspaso' }))
    await waitFor(() => expect(operation.mutateAsync).toHaveBeenCalledTimes(1))
    expect(operation.mutateAsync.mock.calls[0][0]).toMatchObject({ origenCuentaId: accounts[0].id, destinoCuentaId: accounts[1].id, montoOrigen: '10', tasaCambio: '400', tasaUsdVes: '400' })
    expect(operation.mutateAsync.mock.calls[0][0].fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('una respuesta fallida conserva el formulario y el importe', async () => {
    operation.mutateAsync.mockRejectedValueOnce(new Error('Resultado no confirmado'))
    const user = userEvent.setup(), onClose = vi.fn()
    mount({ onClose }); await target(user)
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '10' } })
    await user.click(screen.getByRole('button', { name: 'Confirmar traspaso' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Resultado no confirmado')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('0.00')).toHaveValue('10')
  })
  it('bloquea Escape y envío durante la confirmación', async () => {
    operation.isPending = true
    const user = userEvent.setup(), onClose = vi.fn()
    mount({ onClose }); await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirmando...' })).toBeDisabled()
  })
  it('permite comprobar una operación incierta sin reenviar una transferencia', async () => {
    operation.operationId = '10000000-0000-4000-8000-000000000004'
    operation.checkStatus.mockResolvedValueOnce({ estado: 'confirmada' })
    const user = userEvent.setup(), onClose = vi.fn()
    mount({ onClose }); await user.click(screen.getByRole('button', { name: 'Comprobar resultado' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(operation.mutateAsync).not.toHaveBeenCalled()
  })
})
