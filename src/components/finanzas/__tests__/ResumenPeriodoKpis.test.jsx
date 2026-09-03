// @vitest-environment jsdom
// src/components/finanzas/__tests__/ResumenPeriodoKpis.test.jsx
// Pruebas del selector de moneda y renderizado adaptativo de KPIs financieros.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ResumenPeriodoKpis from '../ResumenPeriodoKpis.jsx'

const SUMMARY = {
  ingresos_usd: 100,
  egresos_usd: 25,
  balance_usd: 75,
  ingresos_ves: 80481,
  egresos_ves: 20120.25,
  balance_ves: 60360.75,
  ingresos_usd_puro: 50,
  ingresos_usdt_puro: 30,
  ingresos_ves_puro: 16096.2,
  egresos_usd_puro: 25,
  egresos_usdt_puro: 0,
  egresos_ves_puro: 0,
  balance_usd_puro: 25,
  balance_usdt_puro: 30,
  balance_ves_puro: 16096.2,
}

describe('ResumenPeriodoKpis', () => {
  it('renderiza desglose triple de tesorería (USD, USDT y Bolívares) en vista Todas', () => {
    render(<ResumenPeriodoKpis summary={SUMMARY} loading={false} />)
    expect(screen.getByText(/Ingresos del período/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Dólares \(\$\):/i)).toHaveLength(3)
    expect(screen.getAllByText(/USDT:/i)).toHaveLength(3)
    expect(screen.getAllByText(/Bolívares \(Bs\):/i)).toHaveLength(3)
    expect(screen.getAllByText(/≈ Total estimado:/i)).toHaveLength(3)
    expect(screen.getByText(/\$50,00/i)).toBeInTheDocument()
    expect(screen.getAllByText(/30,00 USDT/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Bs\.\s*16\.096,20/i).length).toBeGreaterThanOrEqual(1)
  })

  it('al seleccionar VES muestra las cifras prominentes en Bs y equivalencia en USD', () => {
    render(<ResumenPeriodoKpis summary={SUMMARY} loading={false} moneda="VES" />)
    expect(screen.getByText(/Ingresos en Bolívares/i)).toBeInTheDocument()
    expect(screen.getByText(/Bs\.\s*80\.481,00/i)).toBeInTheDocument()
    expect(screen.getByText(/~\$\s*100,00\s*equiv\./i)).toBeInTheDocument()
    expect(screen.getByText(/Gastos en Bolívares/i)).toBeInTheDocument()
    expect(screen.getByText(/Bs\.\s*20\.120,25/i)).toBeInTheDocument()
    expect(screen.getByText(/Flujo neto en Bolívares/i)).toBeInTheDocument()
    expect(screen.getByText(/Bs\.\s*60\.360,75/i)).toBeInTheDocument()
  })

  it('al seleccionar USDT muestra las cifras en formato USDT', () => {
    render(<ResumenPeriodoKpis summary={{ ...SUMMARY, ingresos_usd: 150 }} loading={false} moneda="USDT" />)
    expect(screen.getByText(/Ingresos en USDT/i)).toBeInTheDocument()
    expect(screen.getByText(/150,00\s*USDT/i)).toBeInTheDocument()
  })

  it('dispara onSelectMoneda al pulsar cualquiera de las píldoras', () => {
    const onSelect = vi.fn()
    render(<ResumenPeriodoKpis summary={SUMMARY} loading={false} moneda="" onSelectMoneda={onSelect} />)

    const btnVes = screen.getByRole('button', { name: /Bolívares \(VES\)/i })
    fireEvent.click(btnVes)
    expect(onSelect).toHaveBeenCalledWith('VES')

    const btnUsdt = screen.getByRole('button', { name: /USDT/i })
    fireEvent.click(btnUsdt)
    expect(onSelect).toHaveBeenCalledWith('USDT')

    const btnTodas = screen.getByRole('button', { name: /Todas \(Consolidado\)/i })
    fireEvent.click(btnTodas)
    expect(onSelect).toHaveBeenCalledWith('')
  })
})
