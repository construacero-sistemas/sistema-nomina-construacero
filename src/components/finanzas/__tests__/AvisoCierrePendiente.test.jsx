// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AvisoCierrePendiente from '../AvisoCierrePendiente.jsx'
import { esUltimoDiaDelMes } from '../fechasRapidas.js'

describe('esUltimoDiaDelMes', () => {
  it('detecta el último día de cada mes, bisiesto incluido', () => {
    expect(esUltimoDiaDelMes('2026-10-31', '2026-10-01')).toBe(true)
    expect(esUltimoDiaDelMes('2026-10-30', '2026-10-01')).toBe(false)
    expect(esUltimoDiaDelMes('2026-11-30', '2026-11-01')).toBe(true)
    expect(esUltimoDiaDelMes('2028-02-29', '2028-02-01')).toBe(true)
    expect(esUltimoDiaDelMes('2026-02-28', '2026-02-01')).toBe(true)
    expect(esUltimoDiaDelMes('2026-11-30', '2026-10-01')).toBe(false)
  })
})

describe('AvisoCierrePendiente', () => {
  it('con el mes anterior abierto avisa que ya toca cerrar y ofrece ir a hacerlo', () => {
    const onIr = vi.fn()
    render(<AvisoCierrePendiente previo={{ mes: '2026-10-01', estado: 'abierto' }} actual={{ mes: '2026-11-01', estado: 'sin_apertura' }} hoy="2026-11-01" onIr={onIr} />)
    expect(screen.getByText(/Ya toca cerrar Octubre 2026/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ir a cerrar el mes' }))
    expect(onIr).toHaveBeenCalled()
  })

  it('el último día del mes abierto recuerda que mañana toca (sin botón)', () => {
    render(<AvisoCierrePendiente previo={{ mes: '2026-10-01', estado: 'cerrado' }} actual={{ mes: '2026-11-01', estado: 'abierto' }} hoy="2026-11-30" onIr={vi.fn()} />)
    expect(screen.getByText(/Hoy es el último día de Noviembre 2026/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('no muestra nada un día cualquiera, con el mes sin abrir o ya cerrado', () => {
    const { container, rerender } = render(<AvisoCierrePendiente previo={{ mes: '2026-10-01', estado: 'cerrado' }} actual={{ mes: '2026-11-01', estado: 'abierto' }} hoy="2026-11-15" onIr={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<AvisoCierrePendiente previo={{ mes: '2026-10-01', estado: 'cerrado' }} actual={{ mes: '2026-11-01', estado: 'sin_apertura' }} hoy="2026-11-30" onIr={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
