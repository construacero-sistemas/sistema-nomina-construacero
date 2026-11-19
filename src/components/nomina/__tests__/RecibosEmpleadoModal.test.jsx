// @vitest-environment jsdom
// Mejora del 19/11/2026: recibos del trabajador desde su ficha, paginados, con PDF.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const estado = { data: null, isLoading: false, isError: false, refetch: vi.fn() }
const usarRecibos = vi.fn(() => estado)
vi.mock('../../../hooks/useRecibosEmpleado.js', () => ({ default: (...a) => usarRecibos(...a) }))
vi.mock('../../../../compat/hooks/useConfigNegocio.js', () => ({ useConfigNegocio: () => ({ data: {} }) }))
vi.mock('../../../../compat/utils/errorLogger.js', () => ({ logClientError: vi.fn() }))
vi.mock('../../../../compat/components/ui/Modal.jsx', () => ({
  Modal: ({ title, children }) => <div role="dialog" aria-label={title}>{children}</div>,
}))
const pdf = vi.fn(async () => {})
vi.mock('../../../services/pdf/nominaReciboPDF', () => ({ generarNominaReciboPDF: (...a) => pdf(...a) }))

const { default: RecibosEmpleadoModal } = await import('../RecibosEmpleadoModal.jsx')
const config = { empleado_id: 'e-1', empleado: { nombre: 'ana perez' } }
const recibo = (id, nombre, pagado) => ({ id, total_neto_usd: 48, pagado, total_pagado_bs: pagado ? 43200 : null, periodo: { nombre, desde: '2026-11-12', hasta: '2026-11-18' } })

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('RecibosEmpleadoModal', () => {
  it('lista los recibos con su estado y descarga el PDF de cada uno', async () => {
    estado.data = { recibos: [recibo('l-1', 'Semana 46', true), recibo('l-2', 'Semana 47', false)], pagina: 1, hayMas: false }
    render(<RecibosEmpleadoModal config={config} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Recibos de Ana Perez' })).toBeInTheDocument()
    expect(screen.getByText('Pagado')).toBeInTheDocument()
    expect(screen.getByText('Por pagar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Siguiente/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Descargar recibo de Semana 46' }))
    await waitFor(() => expect(pdf).toHaveBeenCalledWith(expect.objectContaining({ linea: expect.objectContaining({ id: 'l-1' }), periodo: expect.objectContaining({ nombre: 'Semana 46' }) })))
  })

  it('pagina de 10 en 10 con Anterior y Siguiente', () => {
    estado.data = { recibos: [recibo('l-1', 'Semana 46', true)], pagina: 1, hayMas: true }
    render(<RecibosEmpleadoModal config={config} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /Anterior/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    expect(usarRecibos).toHaveBeenLastCalledWith('e-1', 2)
  })
})
