// src/components/sistema/__tests__/UsuariosPanel.test.jsx
// Panel de usuarios: el selector NUNCA ofrece `administracion` (rol histórico)
// y el campo de PIN adopta la longitud del rol elegido (finanzas/nomina: 4;
// el resto: 6) derivada de la matriz única.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const hooks = vi.hoisted(() => ({
  useOperadores: vi.fn(),
  useCrearOperador: vi.fn(),
  useCambiarEstadoOperador: vi.fn(),
  useCambiarPinOperador: vi.fn(),
  useCambiarRolOperador: vi.fn(),
  useCambiarNombreOperador: vi.fn(),
}))
vi.mock('../../../hooks/useGestionOperadores.js', () => hooks)
vi.mock('../../../../compat/components/ui/toastBus.js', () => ({ showToast: vi.fn() }))
vi.mock('../../../../compat/components/ui/Modal.jsx', () => ({
  Modal: ({ isOpen, title, children }) => (isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null),
}))
// Selector visual simulado: lista las opciones como botones para poder afirmar
// qué roles ofrece (sin usar el selector nativo cuadrado que prohíbe el guardrail).
vi.mock('../../../../compat/components/ui/CustomSelect.jsx', () => ({
  default: ({ options, value, onChange, placeholder }) => (
    <div data-testid="custom-select" aria-label={placeholder}>
      {options.map(option => (
        <button key={option.value} type="button" data-selected={option.value === value ? 'true' : 'false'}
          onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
}))

import { showToast } from '../../../../compat/components/ui/toastBus.js'
import UsuariosPanel from '../UsuariosPanel.jsx'

const crearMock = vi.fn(async () => ({}))
const nombreMock = vi.fn(async () => ({}))

beforeEach(() => {
  vi.clearAllMocks()
  hooks.useOperadores.mockReturnValue({ data: { usuarios: [] }, isLoading: false, error: null })
  hooks.useCrearOperador.mockReturnValue({ mutateAsync: crearMock, isPending: false })
  hooks.useCambiarEstadoOperador.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  hooks.useCambiarPinOperador.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  hooks.useCambiarRolOperador.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  hooks.useCambiarNombreOperador.mockReturnValue({ mutateAsync: nombreMock, isPending: false })
})

function opcionesDelSelector(label) {
  return within(screen.getByLabelText(label)).getAllByRole('button').map(boton => boton.textContent)
}

describe('UsuariosPanel — selector de roles', () => {
  it('no ofrece administracion al crear: solo jefe, finanzas y nomina', () => {
    render(<UsuariosPanel open onClose={vi.fn()} />)

    expect(opcionesDelSelector('Selecciona el rol')).toEqual(['Jefe', 'Finanzas', 'Nómina'])
  })

  it('al cambiar rol ofrece solo los roles vigentes', () => {
    hooks.useOperadores.mockReturnValue({
      data: { usuarios: [{ id: 'u1', nombre: 'Jefe Principal', rol: 'jefe', activo: true, tiene_pin: true }] },
      isLoading: false,
      error: null,
    })
    const user = userEvent.setup()
    render(<UsuariosPanel open onClose={vi.fn()} />)

    return user.click(screen.getByLabelText('Cambiar rol de Jefe Principal')).then(() => {
      expect(opcionesDelSelector('Selecciona el nuevo rol')).toEqual(['Jefe', 'Finanzas', 'Nómina'])
    })
  })
})

describe('UsuariosPanel — filas de usuario (mapa completo)', () => {
  it('renderiza varias filas con estados e editores abiertos sin errores', async () => {
    // Regresión 22/09: un icono sin import en el mapa de filas rompía todo el
    // panel en runtime. Este caso ejercita TODA la superficie de renderizado.
    hooks.useOperadores.mockReturnValue({
      data: {
        usuarios: [
          { id: 'u1', nombre: 'La Admin', rol: 'administracion', activo: true, tiene_pin: true },
          { id: 'u2', nombre: 'Cajera Finanzas', rol: 'finanzas', activo: true, tiene_pin: false },
          { id: 'u3', nombre: 'Nómina RRHH', rol: 'nomina', activo: false, tiene_pin: true },
        ],
      },
      isLoading: false,
      error: null,
    })
    const user = userEvent.setup()
    render(<UsuariosPanel open onClose={vi.fn()} />)

    // Las tres filas existen con su chip de estado y etiqueta de rol.
    expect(screen.getByText('La Admin')).toBeInTheDocument()
    expect(screen.getByText('Cajera Finanzas')).toBeInTheDocument()
    expect(screen.getByText('Nómina RRHH')).toBeInTheDocument()
    expect(screen.getAllByText('Activo')).toHaveLength(2)
    expect(screen.getByText('Inactivo')).toBeInTheDocument()

    // Editor de PIN abierto (con el largo del rol de esa fila: finanzas → 4).
    await user.click(screen.getByLabelText('Asignar PIN de Cajera Finanzas'))
    expect(screen.getByText('Nuevo PIN (4 dígitos)')).toBeInTheDocument()
    const fila = screen.getByText('Nuevo PIN (4 dígitos)').closest('article')
    await user.type(within(fila).getByPlaceholderText('4 dígitos'), '4829')

    // Editor de nombre abierto (input prefijado con el nombre actual de la fila).
    await user.click(screen.getByLabelText('Cambiar nombre de Cajera Finanzas'))
    expect(screen.getByLabelText('Nuevo nombre')).toHaveValue('Cajera Finanzas')

    // Editor de rol abierto sobre una fila inactiva (botón deshabilitado, pero
    // su icono debe renderizar igual).
    expect(screen.getByLabelText('Cambiar rol de Nómina RRHH')).toBeDisabled()

    // Todos los iconos de acciones renderizan (KeyRound, UserCog, ShieldOff…).
    expect(screen.getByLabelText('Desactivar a La Admin')).toBeInTheDocument()
    expect(screen.getByLabelText('Reactivar a Nómina RRHH')).toBeInTheDocument()
  })
})

describe('UsuariosPanel — PIN por rol', () => {
  it('finanzas pide PIN de 4 dígitos y lo envía tal cual', async () => {
    const user = userEvent.setup()
    render(<UsuariosPanel open onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('Ej: María Pérez'), 'María Pérez')
    expect(screen.getByPlaceholderText('4 dígitos')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('4 dígitos'), '4829')
    await user.click(screen.getByRole('button', { name: /crear usuario/i }))

    expect(crearMock).toHaveBeenCalledWith({ nombre: 'María Pérez', rol: 'finanzas', pin: '4829' })
  })

  it('jefe pide PIN de 6 dígitos', async () => {
    const user = userEvent.setup()
    render(<UsuariosPanel open onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('Ej: María Pérez'), 'El Jefe')
    // El <label> envolvente absorbe el nombre accesible de los botones: se
    // buscan por texto visible dentro del selector.
    await user.click(within(screen.getByLabelText('Selecciona el rol')).getByText('Jefe'))
    expect(screen.getByPlaceholderText('6 dígitos')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('6 dígitos'), '123456')
    await user.click(screen.getByRole('button', { name: /crear usuario/i }))

    expect(crearMock).toHaveBeenCalledWith({ nombre: 'El Jefe', rol: 'jefe', pin: '123456' })
  })

  it('un PIN incompleto muestra el largo correcto según el rol', async () => {
    const user = userEvent.setup()
    render(<UsuariosPanel open onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('Ej: María Pérez'), 'María Pérez')
    await user.type(screen.getByPlaceholderText('4 dígitos'), '482')
    await user.click(screen.getByRole('button', { name: /crear usuario/i }))

    expect(await screen.findByText('El PIN debe ser de 4 dígitos.')).toBeInTheDocument()
    expect(crearMock).not.toHaveBeenCalled()
  })
})

describe('UsuariosPanel — cambiar nombre', () => {
  const fila = [{ id: 'u1', nombre: 'Viejo Nombre', rol: 'nomina', activo: true, tiene_pin: true }]

  it('renombra con el texto limpio (espacios colapsados) y confirma', async () => {
    hooks.useOperadores.mockReturnValue({ data: { usuarios: fila }, isLoading: false, error: null })
    const user = userEvent.setup()
    render(<UsuariosPanel open onClose={vi.fn()} />)

    await user.click(screen.getByLabelText('Cambiar nombre de Viejo Nombre'))
    const input = screen.getByLabelText('Nuevo nombre')
    expect(input).toHaveValue('Viejo Nombre') // prefijado con el nombre actual
    await user.clear(input)
    await user.type(input, '  María   Pérez  ')
    await user.click(screen.getByRole('button', { name: /guardar nombre/i }))

    expect(nombreMock).toHaveBeenCalledWith({ id: 'u1', nombre: 'María Pérez' })
    expect(showToast).toHaveBeenCalledWith('Nombre de Viejo Nombre actualizado a María Pérez', 'success')
  })

  it('rechaza nombres cortos sin llamar a la mutación', async () => {
    hooks.useOperadores.mockReturnValue({ data: { usuarios: fila }, isLoading: false, error: null })
    const user = userEvent.setup()
    render(<UsuariosPanel open onClose={vi.fn()} />)

    await user.click(screen.getByLabelText('Cambiar nombre de Viejo Nombre'))
    const input = screen.getByLabelText('Nuevo nombre')
    await user.clear(input)
    await user.type(input, 'Ab')
    await user.click(screen.getByRole('button', { name: /guardar nombre/i }))

    expect(nombreMock).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('El nombre debe tener al menos 3 caracteres', 'error')
  })

  it('permite renombrar usuarios inactivos: libera el nombre del histórico', async () => {
    hooks.useOperadores.mockReturnValue({
      data: { usuarios: [{ id: 'u1', nombre: 'Retirada', rol: 'finanzas', activo: false, tiene_pin: true }] },
      isLoading: false,
      error: null,
    })
    render(<UsuariosPanel open onClose={vi.fn()} />)

    // A diferencia de «Cambiar rol», el renombrado opera sobre filas inactivas.
    expect(screen.getByLabelText('Cambiar nombre de Retirada')).toBeEnabled()
    expect(screen.getByLabelText('Cambiar rol de Retirada')).toBeDisabled()
  })
})
