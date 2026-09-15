import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import DetalleCuentaModal from '../DetalleCuentaModal.jsx'
const account = { id: '10000000-0000-4000-8000-000000000001', nombre: 'Caja A', moneda: 'USD', saldo: 7500, saldoConfirmado: true, disponible: true }
const other = { ...account, id: '10000000-0000-4000-8000-000000000002', nombre: 'Caja B' }
const rows = Array.from({ length: 25 }, (_, i) => ({ id: `row-${i}`, cuenta_custodia_id: account.id, moneda: 'USD', monto: 100, tipo: 'ingreso', concepto: `Receipt ${i}`, fecha: '2026-09-13' }))
const mount = (extra = {}) => render(<DetalleCuentaModal open cuenta={account} cuentas={[account,other]} movimientos={rows} onClose={vi.fn()} onOpenTransferencia={vi.fn()} {...extra} />)
describe('Account detail uses the full ledger balance', () => {
  it('keeps the full balance separate from the loaded subset and paginates all rows', () => {
    mount()
    expect(screen.getByText('$7.500,00 USD')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    expect(screen.queryByText('Receipt 24')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByText('Receipt 24')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })
  it('does not mix accounts that share the same type or legacy name', () => {
    mount({ movimientos: [rows[0], { ...rows[1], cuenta_custodia_id: other.id, cuenta_origen: account.nombre }] })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText('Receipt 1')).not.toBeInTheDocument()
  })
  it('never displays missing balance as zero and blocks transfer', () => {
    mount({ cuenta: { ...account, saldo: null, saldoConfirmado: false, disponible: false } })
    const balance = screen.getByRole('region', { name: 'Saldo de la cuenta' })
    expect(within(balance).getByText('Sin confirmar')).toBeInTheDocument()
    expect(balance.textContent).not.toMatch(/0,00/)
    expect(screen.getByRole('button', { name: 'Mover fondos desde esta cuenta' })).toBeDisabled()
  })
  it('shows incomplete history errors and requests more without claiming completeness', () => {
    const load = vi.fn(); mount({ hasMore: true, onLoadMore: load, errorCarga: 'Read failed' })
    expect(screen.getByRole('alert')).toHaveTextContent('Read failed')
    expect(screen.getByText(/puede haber m/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más historial' }))
    expect(load).toHaveBeenCalledOnce()
  })
})
