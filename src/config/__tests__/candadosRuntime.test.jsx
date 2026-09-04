// @vitest-environment jsdom
// src/config/__tests__/candadosRuntime.test.jsx
// Tests del runtime de candados y del comando secreto de desbloqueo.
// Verifica el CABLEADO: el runtime nace de los flags estáticos, el comando
// levanta los candados de la sesión y los consumidores reaccionan.
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bloquearSesion,
  desbloquearSesion,
  useCandados,
} from '../candadosRuntime.js'
import { NOMINA_BLOQUEADA, SYNC_POS_BLOQUEADO, CODIGO_DESBLOQUEO } from '../modulos.js'
import ComandoDesbloqueo from '../../components/ComandoDesbloqueo.jsx'
import {
  PALABRA_SECRETA,
  TOQUES_REQUERIDOS,
  useComandoDesbloqueo,
} from '../../components/comandoDesbloqueoListener.js'
import { showToast } from '../../../compat/components/ui/toastBus.js'
vi.mock('../../../compat/components/ui/toastBus.js', () => ({
  showToast: vi.fn(),
}))

function Sonda() {
  const c = useCandados()
  return (
    <div>
      <span data-testid="nomina">{String(c.nomina)}</span>
      <span data-testid="syncPos">{String(c.syncPos)}</span>
    </div>
  )
}

describe('candadosRuntime', () => {
  beforeEach(() => {
    bloquearSesion()
    vi.clearAllMocks()
  })

  it('el runtime nace del estado de los interruptores estáticos', () => {
    render(<Sonda />)
    expect(screen.getByTestId('nomina').textContent).toBe(String(NOMINA_BLOQUEADA))
    expect(screen.getByTestId('syncPos').textContent).toBe(String(SYNC_POS_BLOQUEADO))
  })

  it('desbloquearSesion levanta los candados de la sesión sin recargar', () => {
    render(<Sonda />)
    if (NOMINA_BLOQUEADA) expect(screen.getByTestId('nomina').textContent).toBe('true')
    act(() => desbloquearSesion())
    expect(screen.getByTestId('nomina').textContent).toBe('false')
    expect(screen.getByTestId('syncPos').textContent).toBe('false')
  })

  it('bloquearSesion restaura el estado estático', () => {
    render(<Sonda />)
    desbloquearSesion()
    bloquearSesion()
    expect(screen.getByTestId('nomina').textContent).toBe(String(NOMINA_BLOQUEADA))
    expect(screen.getByTestId('syncPos').textContent).toBe(String(SYNC_POS_BLOQUEADO))
  })
})

function Probre({ onAbrir }) {
  useComandoDesbloqueo(onAbrir)
  return null
}

describe('comando secreto de desbloqueo (listener)', () => {
  it('escribir la palabra secreta abre el diálogo', () => {
    const onAbrir = vi.fn()
    render(<Probre onAbrir={onAbrir} />)
    for (const letra of PALABRA_SECRETA) {
      fireEvent.keyDown(window, { key: letra })
    }
    expect(onAbrir).toHaveBeenCalledTimes(1)
  })

  it('no se dispara mientras se escribe en un input', () => {
    const onAbrir = vi.fn()
    render(<Probre onAbrir={onAbrir} />)
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    for (const letra of PALABRA_SECRETA) {
      fireEvent.keyDown(window, { key: letra })
    }
    expect(onAbrir).not.toHaveBeenCalled()
    input.blur()
    input.remove()
  })

  it(`${TOQUES_REQUERIDOS} toques rápidos en el logo abren el diálogo`, () => {
    const onAbrir = vi.fn()
    render(<Probre onAbrir={onAbrir} />)
    for (let i = 0; i < TOQUES_REQUERIDOS; i += 1) {
      fireEvent(window, new CustomEvent('logo-tap'))
    }
    expect(onAbrir).toHaveBeenCalledTimes(1)
  })

  it('los toques por debajo del requerido no abren el diálogo', () => {
    const onAbrir = vi.fn()
    render(<Probre onAbrir={onAbrir} />)
    for (let i = 0; i < TOQUES_REQUERIDOS - 1; i += 1) {
      fireEvent(window, new CustomEvent('logo-tap'))
    }
    expect(onAbrir).not.toHaveBeenCalled()
  })
})

describe('diálogo ComandoDesbloqueo', () => {
  it('con código correcto desbloquea la sesión y muestra toast', async () => {
    render(<ComandoDesbloqueo />)
    // Abrir vía palabra secreta
    for (const letra of PALABRA_SECRETA) {
      fireEvent.keyDown(window, { key: letra })
    }
    const input = screen.getByPlaceholderText('Código')
    fireEvent.change(input, { target: { value: CODIGO_DESBLOQUEO } })
    fireEvent.submit(input.closest('form'))
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('Módulos desbloqueados para esta sesión', 'success')
    })
    // El runtime queda desbloqueado
    expect(screen.queryByPlaceholderText('Código')).toBeNull()
    bloquearSesion()
  })

  it('con código incorrecto muestra error y NO desbloquea', async () => {
    render(<ComandoDesbloqueo />)
    for (const letra of PALABRA_SECRETA) {
      fireEvent.keyDown(window, { key: letra })
    }
    const input = screen.getByPlaceholderText('Código')
    fireEvent.change(input, { target: { value: '000000' } })
    fireEvent.submit(input.closest('form'))
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Código incorrecto')
    })
    bloquearSesion()
  })

  it('con módulos desbloqueados ofrece volver a bloquear y lo hace', async () => {
    render(<ComandoDesbloqueo />)
    desbloquearSesion()
    // Abrir vía palabra secreta
    for (const letra of PALABRA_SECRETA) {
      fireEvent.keyDown(window, { key: letra })
    }
    // No hay input de código; hay botón de volver a bloquear
    expect(screen.queryByPlaceholderText('Código')).toBeNull()
    const btn = screen.getByRole('button', { name: /volver a bloquear/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith('Módulos bloqueados de nuevo', 'info')
    })
    bloquearSesion()
  })

  it('toques de más o clics en el fondo (backdrop) no cierran el diálogo', () => {
    const { container } = render(<ComandoDesbloqueo />)
    // Dar 10 toques en el logo (3 toques de más)
    for (let i = 0; i < TOQUES_REQUERIDOS + 3; i += 1) {
      fireEvent(window, new CustomEvent('logo-tap'))
    }
    // El diálogo debe estar visible
    expect(screen.getByPlaceholderText('Código')).toBeInTheDocument()

    // Clic en el backdrop no debe cerrar el diálogo
    const backdrop = container.querySelector('.bg-slate-900\\/60')
    if (backdrop) {
      fireEvent.click(backdrop)
    }
    expect(screen.getByPlaceholderText('Código')).toBeInTheDocument()
  })
})
