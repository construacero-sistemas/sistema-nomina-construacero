// compat/components/ui/__tests__/AvisoActualizacion.test.jsx
// El aviso de versión nueva aparece, desaparece solo y su botón aplica la versión.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const estadoMock = vi.hoisted(() => ({ oyente: null, aplicar: vi.fn(() => true), aplicarSeguro: vi.fn() }))
vi.mock('../../../lib/actualizacionApp.js', () => ({
  suscribirActualizacion: fn => { estadoMock.oyente = fn; fn({ lista: false }); return () => {} },
  aplicarActualizacion: (...args) => estadoMock.aplicar(...args),
  aplicarSiEsSeguro: (...args) => estadoMock.aplicarSeguro(...args),
}))
const toastMock = vi.hoisted(() => ({ warning: vi.fn() }))
vi.mock('../toastBus.js', () => ({ showToast: toastMock }))

import AvisoActualizacion, { AVISO_DURACION_MS } from '../AvisoActualizacion.jsx'

beforeEach(() => {
  vi.useFakeTimers()
  estadoMock.aplicar.mockReset().mockReturnValue(true)
  toastMock.warning.mockReset()
})
afterEach(() => vi.useRealTimers())

function avisar(extra = {}) {
  act(() => estadoMock.oyente({ lista: true, avisoEn: 1, ...extra }))
}

describe('AvisoActualizacion', () => {
  it('no muestra nada sin versión nueva', () => {
    render(<MemoryRouter><AvisoActualizacion /></MemoryRouter>)
    expect(screen.queryByText('Hay una versión nueva del sistema')).not.toBeInTheDocument()
  })

  it('aparece con la versión nueva y desaparece solo', () => {
    render(<MemoryRouter><AvisoActualizacion /></MemoryRouter>)
    avisar()
    expect(screen.getByText('Hay una versión nueva del sistema')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(AVISO_DURACION_MS))
    expect(screen.queryByText('Hay una versión nueva del sistema')).not.toBeInTheDocument()
  })

  it('«Actualizar ahora» aplica la versión; si hay una operación en curso, avisa', () => {
    render(<MemoryRouter><AvisoActualizacion /></MemoryRouter>)
    avisar()
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar ahora' }))
    expect(estadoMock.aplicar).toHaveBeenCalledWith({ forzar: true })
    expect(toastMock.warning).not.toHaveBeenCalled()

    estadoMock.aplicar.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar ahora' }))
    expect(toastMock.warning).toHaveBeenCalledTimes(1)
  })

  it('los botones tienen al menos 44 px de alto', () => {
    render(<MemoryRouter><AvisoActualizacion /></MemoryRouter>)
    avisar()
    expect(screen.getByRole('button', { name: 'Actualizar ahora' }).className).toMatch(/\bh-11\b/)
    expect(screen.getByRole('button', { name: 'Cerrar aviso' }).className).toMatch(/\bh-11\b/)
  })
})
