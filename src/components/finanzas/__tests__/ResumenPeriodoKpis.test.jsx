import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ResumenPeriodoKpis from '../ResumenPeriodoKpis.jsx'
const summary = { ingresos_usd: 110, egresos_usd: 20, balance_usd: 90, movimientos_sin_usd: 0,
  ingresos_usd_puro: 50, ingresos_usdt_puro: 30, ingresos_ves_puro: 12000,
  egresos_usd_puro: 20, egresos_usdt_puro: 0, egresos_ves_puro: 0,
  balance_usd_puro: 30, balance_usdt_puro: 30, balance_ves_puro: 12000 }
describe('Resumen de flujo con valoración histórica', () => {
  it('separa la valoración USD de las tres monedas nativas', () => {
    render(<ResumenPeriodoKpis summary={summary} />)
    expect(screen.getByText('$110,00 USD')).toBeInTheDocument()
    expect(screen.getAllByText('Dólares ($)')).toHaveLength(3)
    expect(screen.getAllByText('USDT')).toHaveLength(3)
    expect(screen.getAllByText('Bolívares (Bs)')).toHaveLength(3)
    expect(screen.getByText('Ingresos del período')).toBeInTheDocument()
    expect(screen.getByText('Flujo neto del período')).toBeInTheDocument()
  })
  it('un cambio de tasa de consulta no revalúa el historial', () => {
    const view = render(<ResumenPeriodoKpis summary={summary} tasaActiva={100} />)
    view.rerender(<ResumenPeriodoKpis summary={summary} tasaActiva={999} />)
    expect(screen.getByText('$110,00 USD')).toBeInTheDocument()
  })
  it('no etiqueta el consolidado USD como unidades USDT al filtrar', () => {
    render(<ResumenPeriodoKpis summary={summary} moneda="USDT" />)
    expect(screen.getByText('$110,00 USD')).toBeInTheDocument()
    expect(screen.queryByText('110,00 USDT')).not.toBeInTheDocument()
  })
  it('no inventa ceros cuando falla el resumen', () => {
    render(<ResumenPeriodoKpis summary={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('Resumen sin confirmar')
    expect(screen.queryByText('$0,00 USD')).not.toBeInTheDocument()
    expect(screen.getAllByText('Sin confirmar')).toHaveLength(9)
  })
  it('con tasa faltante conserva nativos pero oculta el consolidado incompleto', () => {
    render(<ResumenPeriodoKpis summary={{ ...summary, movimientos_sin_usd: 1 }} />)
    expect(screen.getByRole('status')).toHaveTextContent('sin tasa histórica')
    expect(screen.queryByText('$110,00 USD')).not.toBeInTheDocument()
    expect(screen.getAllByText('Consolidado pendiente')).toHaveLength(3)
  })
  it('permite ignorar el aviso de movimientos sin tasa histórica', () => {
    render(<ResumenPeriodoKpis summary={{ ...summary, movimientos_sin_usd: 1 }} />)
    expect(screen.getByRole('button', { name: 'Ignorar aviso de tasas históricas' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ignorar aviso de tasas históricas' }))
    expect(screen.queryByText('1 movimiento(s) sin tasa histórica. El consolidado USD está pendiente de valoración.')).not.toBeInTheDocument()
  })
  it('permite cambiar moneda con botones que anuncian el estado seleccionado', () => {
    const onSelect = vi.fn()
    render(<ResumenPeriodoKpis summary={summary} moneda="VES" onSelectMoneda={onSelect} />)
    expect(screen.getByRole('button', { name: 'Bolívares (VES)' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'USDT' }))
    expect(onSelect).toHaveBeenCalledWith('USDT')
    fireEvent.click(screen.getByRole('button', { name: 'Todas (Consolidado)' }))
    expect(onSelect).toHaveBeenCalledWith('')
  })
})
