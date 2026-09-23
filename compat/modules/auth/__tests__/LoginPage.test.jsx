// compat/modules/auth/__tests__/LoginPage.test.jsx
// Arranque de cuenta: la pantalla de error de «sin operadores activos» debe
// ofrecer crear el primer usuario (rol jefe) en lugar de un callejón sin salida.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const storeState = vi.hoisted(() => ({
  initialized: true,
  user: { id: 'account-a', email: 'a@example.invalid' },
  authStatus: 'denied',
  error: 'No hay un usuario operativo configurado',
  cuentaSinOperadores: true,
  seleccionPendiente: false,
  loading: false,
  _cargandoPerfil: false,
  operadoresDisponibles: [],
  seleccionarOperador: vi.fn(),
  limpiarError: vi.fn(),
  crearPrimerOperador: vi.fn(),
  retryProfile: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
}))
vi.mock('../../../store/useAuthStore', () => {
  const useStore = selector => selector(storeState)
  useStore.getState = () => storeState
  return { default: useStore }
})

import LoginPage from '../LoginPage.jsx'

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(storeState, {
    initialized: true,
    user: { id: 'account-a', email: 'a@example.invalid' },
    authStatus: 'denied',
    error: 'No hay un usuario operativo configurado',
    cuentaSinOperadores: true,
    seleccionPendiente: false,
    operadoresDisponibles: [],
    loading: false,
    _cargandoPerfil: false,
  })
  storeState.crearPrimerOperador.mockResolvedValue(true)
  // jsdom no implementa matchMedia (lo usan el picker y PwaInstallButton).
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})

describe('arranque de cuenta — pantalla de error', () => {
  it('con SIN_OPERADORES ofrece crear el primer usuario desde la propia pantalla', () => {
    render(<LoginPage />)
    expect(screen.getByRole('heading', { name: 'Crea el primer usuario' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nombre del usuario')).toBeInTheDocument()
    expect(screen.getByLabelText(/PIN de acceso/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Crear usuario y entrar/ })).toBeInTheDocument()
  })

  it('envía nombre y PIN de 6 dígitos al store', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.type(screen.getByLabelText('Nombre del usuario'), 'María Pérez')
    await user.type(screen.getByLabelText(/PIN de acceso/), '123456')
    await user.click(screen.getByRole('button', { name: /Crear usuario y entrar/ }))
    expect(storeState.crearPrimerOperador).toHaveBeenCalledWith({ nombre: 'María Pérez', pin: '123456' })
  })

  it('el botón queda deshabilitado hasta tener nombre y PIN completos', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    const boton = screen.getByRole('button', { name: /Crear usuario y entrar/ })
    expect(boton).toBeDisabled()
    await user.type(screen.getByLabelText('Nombre del usuario'), 'María Pérez')
    expect(boton).toBeDisabled()
    await user.type(screen.getByLabelText(/PIN de acceso/), '123456')
    expect(boton).toBeEnabled()
  })

  it('sin el código SIN_OPERADORES no aparece el formulario (denegación normal)', () => {
    storeState.cuentaSinOperadores = false
    render(<LoginPage />)
    expect(screen.getByRole('heading', { name: 'No pudimos abrir tu cuenta' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Crear usuario/ })).toBeNull()
  })

  it('una revalidación de fondo no remonta el picker de operadores', () => {
    // La regresión del parpadeo: con selección asentada y _cargarPerfil corriendo
    // (TOKEN_REFRESHED), la pantalla debe seguir en el picker, no en la tarjeta.
    Object.assign(storeState, {
      authStatus: 'seleccion-pendiente', seleccionPendiente: true,
      cuentaSinOperadores: false, error: null, _cargandoPerfil: true,
    })
    render(<LoginPage />)
    expect(screen.getByRole('heading', { name: /quién está trabajando/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /comprobando tu acceso/i })).toBeNull()
  })

  it('una revalidación de fondo no cambia el título asentado de la tarjeta', () => {
    storeState._cargandoPerfil = true
    render(<LoginPage />)
    expect(screen.getByRole('heading', { name: 'Crea el primer usuario' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /comprobando tu acceso/i })).toBeNull()
  })
})
