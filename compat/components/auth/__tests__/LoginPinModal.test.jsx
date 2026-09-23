// compat/components/auth/__tests__/LoginPinModal.test.jsx
// F2 — barrera de acceso: el modal solo captura el PIN y lo entrega a onSubmit.
// No valida credenciales ni habla con la red: si eso cambiara, el PIN se
// compararía en el navegador y la barrera dejaría de existir. La longitud del
// PIN deriva de la matriz única (finanzas: 4; jefe: 6).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginPinModal from '../LoginPinModal.jsx'

const OPERADOR_FINANZAS = { id: 'op-finanzas', nombre: 'Cajera Finanzas', rol: 'finanzas', color: '#3b82f6' }
const OPERADOR_JEFE = { id: 'op-jefe', nombre: 'El Jefe', rol: 'jefe', color: '#B8860B' }

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})

function renderModal(onSubmit, user = OPERADOR_FINANZAS) {
  render(<LoginPinModal isOpen onClose={vi.fn()} user={user} onSubmit={onSubmit} />)
  return screen.getByLabelText(new RegExp(`PIN de \\d dígitos`))
}

describe('F2 — LoginPinModal (Dark Premium)', () => {
  it('muestra 4 puntos y autoenvía una sola vez al completar el PIN de finanzas', async () => {
    const onSubmit = vi.fn(async () => true)
    const user = userEvent.setup()
    const input = renderModal(onSubmit, OPERADOR_FINANZAS)

    // Longitud derivada de la matriz: finanzas → 4 dígitos (4 puntos).
    expect(screen.getByText(/ingresa tu pin de 4 dígitos/i)).toBeInTheDocument()
    expect(screen.getByLabelText('0 de 4 dígitos ingresados')).toBeInTheDocument()

    await user.type(input, '4829')

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith('4829')
  })

  it('jefe usa PIN de 6 dígitos (6 puntos)', () => {
    renderModal(vi.fn(async () => true), OPERADOR_JEFE)

    expect(screen.getByText(/ingresa tu pin de 6 dígitos/i)).toBeInTheDocument()
    expect(screen.getByLabelText('0 de 6 dígitos ingresados')).toBeInTheDocument()
  })

  it('un PIN rechazado limpia los dígitos y permite reintentar', async () => {
    const onSubmit = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const user = userEvent.setup()
    const input = renderModal(onSubmit)

    await user.type(input, '9999')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(input).toHaveValue(''))

    await user.type(input, '4829')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(onSubmit).toHaveBeenLastCalledWith('4829')
  })

  it('muestra el error del servidor sin congelar la interfaz', async () => {
    const onSubmit = vi.fn().mockResolvedValueOnce({ ok: false, error: 'PIN incorrecto' })
    const user = userEvent.setup()
    const input = renderModal(onSubmit)

    await user.type(input, '0000')

    await waitFor(() => expect(screen.getByText('PIN incorrecto')).toBeInTheDocument())
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('si el envío sigue pendiente no admite un segundo intento', async () => {
    let resolver
    const onSubmit = vi.fn(() => new Promise(resolve => { resolver = resolve }))
    const user = userEvent.setup()
    const input = renderModal(onSubmit)

    await user.type(input, '4829')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))

    // El modal sigue trabajando: el pad no puede encolar otro intento.
    await user.click(screen.getByRole('button', { name: 'Ingresar 1' }))
    await user.click(screen.getByRole('button', { name: 'Ingresar 2' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)

    resolver(true)
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('nunca valida el PIN contra la red por su cuenta', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const onSubmit = vi.fn(async () => true)
    const user = userEvent.setup()
    const input = renderModal(onSubmit)

    await user.type(input, '4829')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
