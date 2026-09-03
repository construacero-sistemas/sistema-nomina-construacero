// @vitest-environment jsdom
// src/components/layout/__tests__/RateHeader.test.jsx
// Test suite para verificar la visualización y funcionalidad de RateHeader en móvil y desktop.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import RateHeader from '../RateHeader.jsx'

const mockSetTipoTasa = vi.fn()
const mockSetTasaManual = vi.fn()
const mockRefresh = vi.fn()

vi.mock('../../../hooks/useTasaCambioNomina.js', () => ({
  default: () => ({
    usd: 73.5,
    eur: 79.2,
    usdt: 73.8,
    lastUpdate: '2026-09-03T12:00:00Z',
    loading: false,
    stale: false,
    error: false,
    refresh: mockRefresh,
  }),
}))

vi.mock('../../../hooks/useMonedaNomina.js', () => ({
  default: () => ({
    tipoTasa: 'bcv_usd',
    setTipoTasa: mockSetTipoTasa,
    tasaManual: '',
    setTasaManual: mockSetTasaManual,
    tasaActiva: 73.5,
    shortLabelTasa: 'BCV $',
    opcionesTasa: [
      { id: 'bcv_usd', label: 'BCV Dólar ($)', shortLabel: 'BCV $' },
      { id: 'bcv_eur', label: 'BCV Euro (€)', shortLabel: 'BCV €' },
      { id: 'usdt', label: 'USDT (Paralelo)', shortLabel: 'USDT' },
      { id: 'manual', label: 'Tasa Manual', shortLabel: 'Manual' },
    ],
    tasasMercado: { bcv_usd: 73.5, bcv_eur: 79.2, usdt: 73.8 },
    loading: false,
    refresh: mockRefresh,
  }),
  formatBs: (n) => `Bs ${Number(n).toFixed(2)}`,
}))

describe('RateHeader Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renderiza la barra de tasas y el selector en el header', () => {
    render(<RateHeader />)
    const headerDiv = screen.getByLabelText('Tasas de cambio')
    expect(headerDiv).toBeInTheDocument()

    // El botón del RateSelector debe estar presente y ser accesible en móvil y desktop
    const button = screen.getByRole('button', { name: /Cambiar tasa de conversión/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveTextContent('BCV $')
    expect(button).toHaveTextContent('73.50')
  })

  it('despliega el menú de tasas al pulsar el botón del selector', () => {
    render(<RateHeader />)
    const trigger = screen.getByRole('button', { name: /Cambiar tasa de conversión/i })
    
    // Abre el popover
    fireEvent.click(trigger)

    expect(screen.getByText(/Tasa secundaria \(Bs\)/i)).toBeInTheDocument()
    expect(screen.getByText('BCV Dólar ($)')).toBeInTheDocument()
    expect(screen.getByText('BCV Euro (€)')).toBeInTheDocument()
    expect(screen.getByText('USDT (Paralelo)')).toBeInTheDocument()
  })

  it('permite cambiar la tasa activa seleccionando otra opción', () => {
    render(<RateHeader />)
    const trigger = screen.getByRole('button', { name: /Cambiar tasa de conversión/i })
    fireEvent.click(trigger)

    const opcionEur = screen.getByRole('button', { name: /BCV Euro/i })
    fireEvent.click(opcionEur)

    expect(mockSetTipoTasa).toHaveBeenCalledWith('bcv_eur')
  })
})
