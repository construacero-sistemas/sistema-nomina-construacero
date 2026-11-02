// src/components/finanzas/__tests__/HistorialCierresFinanzas.test.jsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const estado = vi.hoisted(() => ({ query: {} }))
const pdfMock = vi.hoisted(() => vi.fn(async () => {}))
const movimientosMock = vi.hoisted(() => vi.fn(async () => [{ id: 'm1', fecha: '2026-10-05', tipo: 'ingreso', monto: 10, moneda: 'USD' }]))
const reabrirMock = vi.hoisted(() => vi.fn())
vi.mock('../../../hooks/useHistorialCierres.js', () => ({ useHistorialCierres: () => estado.query, cargarMovimientosCierre: movimientosMock, useReabrirCierre: () => ({ mutate: reabrirMock, isPending: false }) }))
vi.mock('../fechasRapidas.js', async importOriginal => ({ ...(await importOriginal()), isoToday: () => '2026-11-05' }))
vi.mock('../../../services/pdf/finanzasResumenPDF.js', () => ({ generarFinanzasResumenPDF: pdfMock }))

import HistorialCierresFinanzas from '../HistorialCierresFinanzas.jsx'

const cierre = {
  mes: '2026-10-01', estado: 'cerrado', cerradoEn: '2026-11-01T14:00:00Z',
  cuentas: [{
    cuentaCustodiaId: 'c1', nombre: 'Caja USD', moneda: 'USD', saldoApertura: '100', saldoCierreLibro: '150',
    saldoCierreReal: '140', saldoCierreUsd: '140', diferenciaCierre: '-10', motivoCierre: 'Billete falso detectado',
    tasaCierreUsdVes: '400', tasaCierreUsdtVes: '450',
  }],
}

beforeEach(() => { vi.clearAllMocks(); estado.query = { data: [cierre], isLoading: false, isError: false } })

describe('HistorialCierresFinanzas', () => {
  it('lista los cierres guardados y muestra el detalle por cuenta al abrirlos', () => {
    render(<HistorialCierresFinanzas />)
    expect(screen.getByText('Octubre 2026')).toBeTruthy()
    expect(screen.queryByText('Caja USD')).toBeNull()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Caja USD')).toBeTruthy()
    expect(screen.getByText(/Billete falso detectado/)).toBeTruthy()
  })

  it('el PDF resumido y el detallado usan la estructura del reporte de movimientos con el cierre', async () => {
    render(<HistorialCierresFinanzas />)
    fireEvent.click(screen.getByRole('button', { name: 'Descargar PDF resumido de Octubre 2026' }))
    await waitFor(() => expect(pdfMock).toHaveBeenCalledTimes(1))
    expect(movimientosMock).toHaveBeenCalledWith('2026-10-01')
    expect(pdfMock.mock.calls[0][0]).toMatchObject({ tipoReporte: 'resumido', cierre, rango: { desde: '2026-10-01' } })
    expect(pdfMock.mock.calls[0][0].movimientos).toHaveLength(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Descargar PDF detallado de Octubre 2026' }).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Descargar PDF detallado de Octubre 2026' }))
    await waitFor(() => expect(pdfMock).toHaveBeenCalledTimes(2))
    expect(pdfMock.mock.calls[1][0]).toMatchObject({ tipoReporte: 'completo', cierre })
  })

  it('solo ofrece PDF (sin Excel/CSV) y avisa cuando aún no hay cierres', () => {
    const { rerender } = render(<HistorialCierresFinanzas />)
    expect(screen.queryByRole('button', { name: /CSV|Excel/ })).toBeNull()
    estado.query = { data: [], isLoading: false, isError: false }
    rerender(<HistorialCierresFinanzas />)
    expect(screen.getByText('Todavía no hay meses cerrados.')).toBeTruthy()
  })

  it('el mes anterior se puede reabrir con motivo; otros meses no', () => {
    estado.query = { data: [cierre, { ...cierre, mes: '2026-09-01' }], isLoading: false, isError: false }
    render(<HistorialCierresFinanzas />)
    const botones = screen.getAllByRole('button', { name: 'Reabrir mes' })
    expect(botones).toHaveLength(1) // solo Octubre 2026 (el mes anterior a la fecha simulada)
    fireEvent.click(botones[0])
    const confirmar = screen.getByRole('button', { name: 'Sí, reabrir mes' })
    expect(confirmar.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Motivo de la reapertura/), { target: { value: 'Cerré el mes por error' } })
    expect(confirmar.disabled).toBe(false)
    fireEvent.click(confirmar)
    expect(reabrirMock).toHaveBeenCalledWith({ mesInicio: '2026-10-01', motivo: 'Cerré el mes por error' }, expect.any(Object))
  })
})
