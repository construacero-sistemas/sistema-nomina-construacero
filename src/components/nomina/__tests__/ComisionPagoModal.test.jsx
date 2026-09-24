// src/components/nomina/__tests__/ComisionPagoModal.test.jsx
// El pago manual de comisiones nace SIEMPRE enlazado a su cuenta de custodia
// (invariante anti-huérfanos): selector visible para bancos, auto-asignación
// de caja en efectivo, payload correcto y error claro sin cuenta.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const hooks = vi.hoisted(() => ({
  crearMovimiento: vi.fn(async () => ({ movimiento: {} })),
  cuentas: [],
  configs: [],
}))
vi.mock('../../../../compat/components/ui/Modal.jsx', () => ({
  Modal: ({ isOpen, title, children }) => (isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null),
}))
// OJO: los mocks resuelven desde este directorio (__tests__) → hasta src/hooks
// hay TRES niveles (misma convención que MovimientoForm.test.jsx).
vi.mock('../../../hooks/useFinanzas.js', () => ({
  useCrearMovimiento: () => ({ mutateAsync: hooks.crearMovimiento, isPending: false }),
}))
vi.mock('../../../hooks/useNomina.js', () => ({
  useConfigEmpleados: () => ({ data: hooks.configs }),
  useNominaEmpleados: () => ({ data: [] }),
}))
vi.mock('../../../../compat/hooks/useConfigNegocio.js', () => ({
  useConfigNegocio: () => ({ data: null }),
}))
vi.mock('../../../hooks/useMonedaNomina.js', () => ({
  default: () => ({ fmtBs: n => `Bs ${(n * 40).toLocaleString('es-VE')}`, shortLabelTasa: 'BCV' }),
}))
vi.mock('../../../hooks/useTasaCambioNomina.js', () => ({
  default: () => ({ usd: 40, eur: 43, usdt: 41 }),
}))
vi.mock('../../../hooks/useCuentasCustodia.js', () => ({
  useCuentasCustodia: () => ({ cuentas: hooks.cuentas }),
}))
// El módulo real de cuentasCompatibles importa utils que tiran de authFetch;
// el mapeo de compatibilidad ya se cubre en cuentasCompatibles.test.jsx.
vi.mock('../../finanzas/cuentasCompatibles.js', () => ({
  getCuentasCompatibles: (metodo, cuentas) => {
    const activas = (cuentas || []).filter(c => c.activo !== false)
    if (metodo === 'Efectivo $') return activas.filter(c => c.tipo === 'efectivo_usd')
    if (metodo === 'Efectivo Bs') return activas.filter(c => c.tipo === 'efectivo_ves')
    if (['Banco en Bolívares', 'Transferencia', 'Pago Móvil', 'Punto de Venta'].includes(metodo)) {
      return activas.filter(c => c.tipo === 'banco_ves')
    }
    if (metodo === 'USDT') return activas.filter(c => c.tipo === 'usdt')
    if (metodo === 'Zelle') return activas.filter(c => c.tipo === 'zelle_usd')
    return []
  },
}))
vi.mock('../../../../compat/services/authFetch.js', () => ({ authFetch: vi.fn() }))

import ComisionPagoModal from '../ComisionPagoModal.jsx'

const EMPLEADO_INICIAL = { empleado_id: 'emp-1', empleado: { nombre: 'Edgar Ramírez', documento: '12345678' }, cargo: 'Vendedor' }
const CAJA = { id: 'c-caja-1', nombre: 'Caja Efectivo $', tipo: 'efectivo_usd', moneda: 'USD', activo: true }
const CAJA_BS = { id: 'c-caja-2', nombre: 'Caja Efectivo Bs', tipo: 'efectivo_ves', moneda: 'VES', activo: true }
const BANCOS = [
  { id: 'c-ban-1', nombre: 'Banco Venezuela', tipo: 'banco_ves', moneda: 'VES', activo: true },
  { id: 'c-ban-2', nombre: 'Provincial', tipo: 'banco_ves', moneda: 'VES', activo: true },
]

function renderModal(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ComisionPagoModal empleadoInicial={EMPLEADO_INICIAL} onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hooks.crearMovimiento.mockResolvedValue({ movimiento: {} })
  hooks.cuentas = [CAJA]
  hooks.configs = []
})

async function llenarValido(user) {
  await user.type(screen.getByPlaceholderText('0.00'), '25')
  await user.type(screen.getByPlaceholderText(/estructuras/i), 'Comisión de prueba')
}

describe('ComisionPagoModal — invariante anti-huérfanos', () => {
  afterEach(cleanup)

  it('en efectivo la caja queda auto-asignada y el payload lleva su id', async () => {
    const user = userEvent.setup()
    renderModal()
    await llenarValido(user)
    // La caja aparece como auto-asignada (sin selector).
    expect(screen.getByText('Caja de efectivo (auto-asignada)')).toBeInTheDocument()
    expect(screen.getByText('Caja Efectivo $')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /registrar egreso de comisión/i }))
    await vi.waitFor(() => expect(hooks.crearMovimiento).toHaveBeenCalledTimes(1))
    const payload = hooks.crearMovimiento.mock.calls[0][0]
    expect(payload.cuentaCustodiaId).toBe('c-caja-1')
    expect(payload.categoria).toBe('Comisiones')
    expect(payload.moneda).toBe('USD')
    expect(payload.tipo).toBe('egreso')
  })

  it('con método bancario muestra selector de cuentas compatibles y envía la elegida', async () => {
    const user = userEvent.setup()
    hooks.cuentas = [...BANCOS, CAJA, CAJA_BS]
    renderModal()
    await llenarValido(user)

    // Cambiar a Banco en Bolívares → selector con los dos bancos.
    const metodo = screen.getAllByRole('combobox').find(c => c.textContent.includes('Efectivo $'))
    await user.click(metodo)
    await user.click(await screen.findByRole('option', { name: /banco en bolívares/i }))
    const cuentaSelect = screen.getAllByRole('combobox').find(c => /desde qué cuenta paga/i.test(c.textContent))
    await user.click(cuentaSelect)
    await user.click(await screen.findByRole('option', { name: /provincial/i }))

    await user.click(screen.getByRole('button', { name: /registrar egreso de comisión/i }))
    await vi.waitFor(() => expect(hooks.crearMovimiento).toHaveBeenCalledTimes(1))
    const payload = hooks.crearMovimiento.mock.calls[0][0]
    expect(payload.cuentaCustodiaId).toBe('c-ban-2')
  })

  it('sin caja registrada para el método, muestra el aviso y NO envía nada', async () => {
    const user = userEvent.setup()
    hooks.cuentas = [] // sin cuentas en absoluto
    renderModal()
    await llenarValido(user)

    expect(screen.getByText(/no tienes una caja registrada/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /registrar egreso de comisión/i }))

    expect(await screen.findByText(/no tienes una caja de efectivo registrada/i)).toBeInTheDocument()
    expect(hooks.crearMovimiento).not.toHaveBeenCalled()
  })

  it('sin cuenta seleccionada en método bancario, no envía y avisa', async () => {
    const user = userEvent.setup()
    hooks.cuentas = [...BANCOS, CAJA, CAJA_BS]
    renderModal()
    await llenarValido(user)

    const metodo = screen.getAllByRole('combobox').find(c => c.textContent.includes('Efectivo $'))
    await user.click(metodo)
    await user.click(await screen.findByRole('option', { name: /banco en bolívares/i }))

    await user.click(screen.getByRole('button', { name: /registrar egreso de comisión/i }))
    expect(await screen.findByText(/selecciona la cuenta de origen/i)).toBeInTheDocument()
    expect(hooks.crearMovimiento).not.toHaveBeenCalled()
  })
})
