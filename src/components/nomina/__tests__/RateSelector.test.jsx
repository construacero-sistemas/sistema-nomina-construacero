// @vitest-environment jsdom
// src/components/nomina/__tests__/RateSelector.test.jsx
// Guardarraíles: (1) el desplegable no desborda en móvil (regresión del scroll
// horizontal); (2) avisa cuando la tasa elegida no tiene dato; (3) la tasa
// manual exige motivo y se guarda trazable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const fijarMock = vi.fn(async () => {})

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

function abrirMenu() {
  render(<RateSelector />)
  fireEvent.click(screen.getByRole('button', { name: /Cambiar tasa de conversión/i }))
}

beforeEach(() => {
  Object.assign(hookState, base)
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

describe('RateSelector — tasa manual trazable', () => {
  it('exige motivo antes de fijar la tasa', () => {
    abrirMenu()
    fireEvent.click(screen.getByRole('button', { name: /Tasa Manual/i }))
    fireEvent.change(screen.getByPlaceholderText(/Ej\. 42\.50/i), { target: { value: '42.5' } })
    fireEvent.click(screen.getByRole('button', { name: /Fijar/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/motivo/i)
    expect(fijarMock).not.toHaveBeenCalled()
  })

  it('guarda la tasa con el motivo declarado', async () => {
    abrirMenu()
    fireEvent.click(screen.getByRole('button', { name: /Tasa Manual/i }))
    fireEvent.change(screen.getByPlaceholderText(/Ej\. 42\.50/i), { target: { value: '42.5' } })
    fireEvent.change(screen.getByPlaceholderText(/Ej\. Tasa acordada/i), { target: { value: 'Tasa acordada con finanzas' } })
    fireEvent.click(screen.getByRole('button', { name: /Fijar/i }))
    await vi.waitFor(() => expect(fijarMock).toHaveBeenCalledWith(42.5, 'Tasa acordada con finanzas'))
  })

  it('muestra quién fijó la tasa manual y por qué', () => {
    hookState.tasaManualInfo = { valor: 42.5, motivo: 'Acuerdo con finanzas', fijada_por_nombre: 'Admin Test', observado_en: '2026-09-27T10:00:00Z' }
    abrirMenu()
    expect(screen.getByText(/fijada por/i)).toHaveTextContent('Admin Test')
    expect(screen.getByText(/fijada por/i)).toHaveTextContent('Acuerdo con finanzas')
  })
})
