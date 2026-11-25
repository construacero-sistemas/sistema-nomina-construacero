// @vitest-environment jsdom
// src/components/nomina/__tests__/RateSelector.test.jsx
// Guardarraíles: (1) el desplegable no desborda en móvil (regresión del scroll
// horizontal); (2) avisa cuando la tasa elegida no tiene dato; (3) la tasa
// manual se fija sin motivo y solo la ve quien administra nómina.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const fijarMock = vi.fn(async () => {})
const auth = vi.hoisted(() => ({ rol: 'jefe' }))

vi.mock('../../../../compat/store/useAuthStore.js', () => {
  const useAuthStore = vi.fn(selector => {
    const state = { perfil: { rol: auth.rol } }
    return selector ? selector(state) : state
  })
  useAuthStore.getState = () => ({ perfil: { rol: auth.rol } })
  return { default: useAuthStore }
})

const base = {
  tipoTasa: 'bcv_usd',
  setTipoTasa: vi.fn(),
  tasaManual: 0,
  tasaActiva: 857.01,
  shortLabelTasa: 'BCV $',
  opcionesTasa: [
    { id: 'bcv_usd', label: 'BCV Dólar ($)', shortLabel: 'BCV $' },
    { id: 'bcv_eur', label: 'BCV Euro (€)', shortLabel: 'BCV €' },
    { id: 'usdt', label: 'USDT (Paralelo)', shortLabel: 'USDT' },
    { id: 'manual', label: 'Tasa Manual', shortLabel: 'Manual' },
  ],
  tasasMercado: { bcv_usd: 857.01, bcv_eur: 976.9, usdt: 966.54, manual: 0 },
  loading: false,
  refresh: vi.fn(),
  tasaManualInfo: null,
  fijarTasaManual: fijarMock,
  guardandoTasaManual: false,
  errorTasaManual: '',
  tasaFallback: null,
  stale: false,
}

const hookState = { ...base }

vi.mock('../../../hooks/useMonedaNomina.js', () => ({
  default: () => hookState,
  formatBs: n => `Bs ${Number(n).toFixed(2)}`,
}))

const { RateSelector } = await import('../RateSelector.jsx')

function abrirMenu(props = {}) {
  render(<RateSelector {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Cambiar (mi )?tasa/i }))
}

beforeEach(() => {
  Object.assign(hookState, base)
  auth.rol = 'jefe'
  fijarMock.mockClear()
  fijarMock.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RateSelector — contención del desplegable (regresión scroll horizontal)', () => {
  it('el popover limita su ancho a la pantalla y oculta desbordamiento horizontal', () => {
    abrirMenu()
    const popover = screen.getByText(/Tasa secundaria \(Bs\)/i).closest('div.fixed')
    expect(popover).toBeTruthy()
    expect(popover.className).toContain('overflow-x-hidden')
    expect(popover.className).toContain('max-w-[calc(100vw-1.5rem)]')
    expect(popover.className).toContain('overflow-y-auto')
  })

  it('la fila del tasa manual no desborda: input comprimible y botón fijo', () => {
    abrirMenu()
    fireEvent.click(screen.getByRole('button', { name: /Tasa Manual/i }))
    const botonFijar = screen.getByRole('button', { name: /Fijar/i })
    expect(botonFijar.className).toContain('shrink-0')
    const fila = botonFijar.parentElement
    expect(fila.className).toContain('min-w-0')
    expect(fila.querySelector('input').className).toContain('min-w-0')
  })
})

describe('RateSelector — avisos de tasa de respaldo', () => {
  it('muestra el aviso cuando la tasa elegida no tiene dato y se usa la del dólar', () => {
    hookState.tipoTasa = 'usdt'
    hookState.tasaFallback = 'bcv_usd'
    abrirMenu()
    expect(screen.getByRole('status')).toHaveTextContent(/BCV Dólar como referencia/i)
  })

  it('sin ninguna tasa disponible avisa que no hay equivalencias', () => {
    hookState.tasaFallback = 'sin_datos'
    abrirMenu()
    expect(screen.getByRole('status')).toHaveTextContent(/No hay tasas disponibles/i)
  })

  it('marca las opciones sin dato en vez de un guion engañoso', () => {
    hookState.tasasMercado = { bcv_usd: 857.01, bcv_eur: 0, usdt: 966.54, manual: 0 }
    abrirMenu()
    expect(screen.getByText('Sin dato')).toBeInTheDocument()
  })
})

describe('RateSelector — tasa manual de Nómina', () => {
  it('se fija sin pedir motivo', async () => {
    abrirMenu()
    fireEvent.click(screen.getByRole('button', { name: /Tasa Manual/i }))
    expect(screen.queryByPlaceholderText(/Tasa acordada/i)).toBeNull()
    expect(screen.getByText(/Solo cambia la tasa de Nómina/i)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/Ej\. 42\.50/i), { target: { value: '950' } })
    fireEvent.click(screen.getByRole('button', { name: /Fijar/i }))
    await vi.waitFor(() => expect(fijarMock).toHaveBeenCalledWith(950))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Regla del usuario (19/11/2026): solo el jefe cambia la tasa general; para los
  // demás es informativa. El rol nómina tiene su tasa personal para recibos y hoja.
  it.each(['nomina', 'finanzas'])('para el rol %s la tasa general es solo informativa', rol => {
    auth.rol = rol
    render(<RateSelector />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByLabelText(/solo informativa/i)).toHaveTextContent('857.01')
  })

  it('el rol nómina fija su tasa personal (solo para sí) en recibos y hoja', async () => {
    auth.rol = 'nomina'
    abrirMenu({ personal: true })
    expect(screen.getByText(/Mi tasa \(solo para mí\)/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Tasa Manual/i }))
    expect(screen.getByText(/no cambia la tasa de nadie más/i)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/Ej\. 42\.50/i), { target: { value: '950' } })
    fireEvent.click(screen.getByRole('button', { name: /Fijar/i }))
    await vi.waitFor(() => expect(fijarMock).toHaveBeenCalledWith(950))
  })

  it('muestra quién fijó la tasa manual', () => {
    hookState.tasaManualInfo = { valor: 42.5, motivo: null, fijada_por_nombre: 'Admin Test', observado_en: '2026-09-27T10:00:00Z' }
    abrirMenu()
    expect(screen.getByText(/fijada por/i)).toHaveTextContent('Admin Test')
  })

  it('en modo claro (light) usa alto contraste y evita amarillo sobre fondo blanco', () => {
    render(<RateSelector light />)
    const trigger = screen.getByRole('button', { name: /Cambiar tasa/i })
    const valor = trigger.querySelectorAll('span')[1]
    expect(valor).toHaveClass('text-primary')
    expect(valor).not.toHaveClass('text-amber-300')
  })
})
