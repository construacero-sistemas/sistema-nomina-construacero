// compat/modules/auth/__tests__/OperatorPicker.test.jsx
// F2 — barrera de acceso: la pantalla de selección solo elige al operador; el
// PIN se envía al store (y de ahí al Worker). Un PIN rechazado no debe parecer
// un éxito: el modal permanece abierto y limpia los dígitos.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const storeState = vi.hoisted(() => ({
  operadoresDisponibles: [],
  seleccionarOperador: vi.fn(),
  logout: vi.fn(),
  error: null,
  limpiarError: vi.fn(),
}))
vi.mock('../../../store/useAuthStore', () => ({ default: selector => selector(storeState) }))

import OperatorPicker from '../OperatorPicker.jsx'

const OPERADORES = [
  { id: 'op-admin', nombre: 'Jefe', rol: 'jefe', color: null },
  { id: 'op-finanzas', nombre: 'Cajera Finanzas', rol: 'finanzas', color: '#3b82f6' },
]

beforeEach(() => {
  vi.clearAllMocks()
  storeState.operadoresDisponibles = OPERADORES
  storeState.seleccionarOperador.mockResolvedValue(true)
  // jsdom no implementa matchMedia; el modal lo consulta para elegir el teclado.
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})

describe('F2 — OperatorPicker', () => {
  it('lista los operadores operativos con su etiqueta de rol y sin modal al inicio', () => {
    render(<OperatorPicker />)

    expect(screen.getByRole('heading', { name: /quién está trabajando/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ingresar como Jefe' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ingresar como Cajera Finanzas' })).toBeInTheDocument()
    // La etiqueta de rol se deriva de la matriz única (etiquetaRol).
    expect(screen.getByText('Finanzas')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('al elegir un operador abre el PIN y lo envía al store', async () => {
    const user = userEvent.setup()
    render(<OperatorPicker />)

    await user.click(screen.getByRole('button', { name: 'Ingresar como Cajera Finanzas' }))

    expect(storeState.limpiarError).toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    // finanzas usa PIN de 4 dígitos (derivado de la matriz única).
    expect(screen.getByText(/ingresa tu pin de 4 dígitos/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText('PIN de 4 dígitos'), '4829')

    await waitFor(() => expect(storeState.seleccionarOperador).toHaveBeenCalledWith('op-finanzas', '4829'))
    expect(storeState.seleccionarOperador).toHaveBeenCalledTimes(1)
  })

  it('un PIN incorrecto mantiene el modal abierto y limpia los dígitos', async () => {
    storeState.seleccionarOperador.mockResolvedValue(false)
    const user = userEvent.setup()
    render(<OperatorPicker />)

    await user.click(screen.getByRole('button', { name: 'Ingresar como Jefe' }))
    const input = screen.getByLabelText('PIN de 6 dígitos')
    await user.type(input, '999999')

    await waitFor(() => expect(storeState.seleccionarOperador).toHaveBeenCalledWith('op-admin', '999999'))
    await waitFor(() => expect(input).toHaveValue(''))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // El fallo del PIN no cierra la selección ni cierra la sesión de la cuenta.
    expect(storeState.logout).not.toHaveBeenCalled()
  })

  it('permite abandonar la selección cerrando la sesión de la cuenta', async () => {
    const user = userEvent.setup()
    render(<OperatorPicker />)

    await user.click(screen.getByRole('button', { name: /cambiar de cuenta/i }))

    expect(storeState.logout).toHaveBeenCalledTimes(1)
  })
})
