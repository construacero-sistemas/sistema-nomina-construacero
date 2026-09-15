import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReasignarCuentaModal from '../ReasignarCuentaModal.jsx'
const account = { id: '10000000-0000-4000-8000-000000000001', nombre: 'Caja USD', moneda: 'USD' }
const rows = [
  { id: 'one', concepto: 'Cemento', moneda: 'USD', monto: 50, tipo: 'egreso', fecha: '2026-09-01' },
  { id: 'two', concepto: 'Venta', moneda: 'USD', monto: 100, tipo: 'ingreso', fecha: '2026-09-01', cuenta_origen: 'Caja USD' },
  { id: 'ves', concepto: 'Otra moneda', moneda: 'VES', monto: 1000, tipo: 'ingreso' },
  { id: 'known', concepto: 'Ya confirmado', moneda: 'USD', monto: 100, cuenta_custodia_id: account.id },
]
const mount = (extra = {}) => {
  const onConfirm = vi.fn().mockResolvedValue({ ok: true }), onClose = vi.fn()
  return { ...render(<ReasignarCuentaModal open movimientos={rows} cuentas={[account]} onConfirm={onConfirm} onClose={onClose} {...extra} />), onConfirm, onClose }
}
async function selectAccount() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Cuenta de destino' }))
  await user.click(screen.getByRole('option', { name: /Caja USD/ }))
}
describe('Explicit classification with confirmed completion', () => {
  it('keeps legacy-name records pending until the UUID is confirmed', () => {
    mount()
    expect(screen.getByText('Venta')).toBeInTheDocument()
    expect(screen.queryByText('Ya confirmado')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Asignar cuenta' })).toBeDisabled()
  })
  it('filters currency and submits UUIDs, not a legacy display name', async () => {
    const { onConfirm, onClose } = mount(); await selectAccount()
    expect(screen.queryByText('Otra moneda')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Venta/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Asignar cuenta' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onConfirm).toHaveBeenCalledWith({ ids: ['two'], cuentaCustodiaId: account.id })
  })
  it('selects compatible records and preserves selection on server failure', async () => {
    const rejected = vi.fn().mockRejectedValue(new Error('No se pudo confirmar'))
    const { onClose } = mount({ onConfirm: rejected }); await selectAccount()
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar hasta 100 compatibles' }))
    fireEvent.click(screen.getByRole('button', { name: 'Asignar cuenta' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo confirmar')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: /Venta/ })).toBeChecked()
    expect(rejected).toHaveBeenCalledWith({ ids: ['one','two'], cuentaCustodiaId: account.id })
  })
  it('paginates loaded candidates and describes the limited scope of an empty result', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...rows[0], id: String(i), concepto: `Candidate ${i}` }))
    const view = mount({ movimientos: many })
    expect(screen.getAllByRole('listitem')).toHaveLength(10)
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' })); fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByText('Candidate 24')).toBeInTheDocument()
    view.rerender(<ReasignarCuentaModal open movimientos={[]} cuentas={[account]} />)
    expect(screen.getByText(/Todo clasificado en los registros cargados/)).toBeInTheDocument()
  })
  it('does not allow closing while awaiting confirmation', async () => {
    const { onClose } = mount({ confirmando: true })
    await userEvent.setup().keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  })
})
