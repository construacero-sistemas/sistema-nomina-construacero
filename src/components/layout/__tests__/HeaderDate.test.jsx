// @vitest-environment jsdom
// src/components/layout/__tests__/HeaderDate.test.jsx
// Test suite para verificar el componente HeaderDate en la cabecera en PC.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import HeaderDate from '../HeaderDate.jsx'

vi.mock('../../../hooks/useTasaCambioNomina.js', () => ({
  default: () => ({
    lastUpdate: '2026-09-03T17:02:18Z',
  }),
}))

describe('HeaderDate Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renderiza la fecha formateada en la cabecera en PC', () => {
    render(<HeaderDate />)
    const element = screen.getByTitle('Fecha y hora oficial (Caracas)')
    expect(element).toBeInTheDocument()
    expect(element).toHaveAttribute('aria-label')
    expect(element.textContent).toMatch(/03/i)
  })
})
