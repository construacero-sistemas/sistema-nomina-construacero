// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import MesAMesResumen from '../MesAMesResumen.jsx'
import { rangoDeMes } from '../fechasRapidas.js'

const movimientos = [
  { id: 'm1', fecha: '2026-10-02', tipo: 'ingreso', categoria: 'Ventas', concepto: 'Venta mostrador', monto: 100, moneda: 'USD', tasa_ves: 400, tasa_usd_ves: 400, estado: 'activo', cuenta_custodia_id: 'c1' },
  { id: 'm2', fecha: '2026-10-05', tipo: 'egreso', categoria: 'Proveedores', concepto: 'Cemento', monto: 40, moneda: 'USD', tasa_ves: 400, tasa_usd_ves: 400, estado: 'activo', cuenta_custodia_id: 'c1' },
  { id: 'm3', fecha: '2026-10-06', tipo: 'egreso', categoria: 'Proveedores', concepto: 'Arena', monto: 2000, moneda: 'VES', tasa_ves: 1, tasa_usd_ves: 400, estado: 'activo', cuenta_custodia_id: 'c2' },
  { id: 'm4', fecha: '2026-10-07', tipo: 'egreso', categoria: 'Anulados', concepto: 'Borrado', monto: 999, moneda: 'USD', tasa_ves: 400, tasa_usd_ves: 400, estado: 'anulado', cuenta_custodia_id: 'c1' },
]
const cuentas = [
  { id: 'c1', nombre: 'Caja USD', moneda: 'USD', saldo: 60 },
  { id: 'c2', nombre: 'Banco Bs', moneda: 'VES', saldo: 4000 },
]

afterEach(cleanup)

describe('MesAMesResumen — portada de gasto y ganancia', () => {
  it('resume entró, salió y ganancia del período ignorando los anulados', () => {
    render(<MesAMesResumen movimientos={movimientos} cuentas={cuentas} desde="2026-10-01" hasta="2026-10-31" />)
    expect(screen.getByRole('region', { name: 'Resumen financiero' })).toHaveTextContent(/Mes a mes/)
    // Ingresos 100 USD; gastos 40 USD + 2000 VES (5 USD a tasa 400) = 45; ganancia 55 (55%).
    expect(screen.getByText('$100,00 USD')).toBeInTheDocument()
    expect(screen.getByText('$45,00 USD')).toBeInTheDocument()
    expect(screen.getByText('$55,00 USD · 55,00%')).toBeInTheDocument()
    expect(screen.queryByText(/999/)).not.toBeInTheDocument()
  })

  it('expande el detalle de cada categoría con sus movimientos', () => {
    render(<MesAMesResumen movimientos={movimientos} cuentas={cuentas} desde="2026-10-01" hasta="2026-10-31" />)
    fireEvent.click(screen.getByRole('button', { name: /Proveedores/ }))
    expect(screen.getByText(/Cemento/)).toBeInTheDocument()
    expect(screen.getByText(/2\.000,00 VES · \$5,00/)).toBeInTheDocument()
  })

  it('muestra cuánto entró y salió de cada cuenta con su saldo', () => {
    render(<MesAMesResumen movimientos={movimientos} cuentas={cuentas} desde="2026-10-01" hasta="2026-10-31" />)
    const caja = screen.getByText('Caja USD').closest('li')
    expect(caja).toHaveTextContent('+$100,00')
    expect(caja).toHaveTextContent('−$40,00')
    expect(caja).toHaveTextContent('Saldo: 60,00 USD')
    const banco = screen.getByText('Banco Bs').closest('li')
    expect(banco).toHaveTextContent('−$5,00')
    expect(banco).toHaveTextContent('Saldo: 4.000,00 VES')
  })

  it('usa el resumen del servidor cuando existe y avisa el detalle parcial', () => {
    render(
      <MesAMesResumen
        movimientos={movimientos.slice(0, 2)}
        cuentas={cuentas}
        summary={{ ingresos_usd: 250, egresos_usd: 90, balance_usd: 160, movimientos_sin_usd: 0 }}
        totalServidor={10}
        desde="2026-10-01"
        hasta="2026-10-31"
      />,
    )
    expect(screen.getByText('$250,00 USD')).toBeInTheDocument()
    expect(screen.getByText('$90,00 USD')).toBeInTheDocument()
    expect(screen.getByText('$160,00 USD · 64,00%')).toBeInTheDocument()
    expect(screen.getByText(/2 de 10 movimientos cargados/)).toBeInTheDocument()
  })

  it('marca el consolidado pendiente cuando hay movimientos sin valorar', () => {
    render(
      <MesAMesResumen
        movimientos={movimientos}
        cuentas={cuentas}
        summary={{ ingresos_usd: 100, egresos_usd: 45, balance_usd: 55, movimientos_sin_usd: 2 }}
        desde="2026-10-01"
        hasta="2026-10-31"
      />,
    )
    expect(screen.getAllByText('Consolidado pendiente').length).toBe(3)
    expect(screen.getByText(/pendiente de valoración/)).toBeInTheDocument()
  })
})

describe('MesAMesResumen — ver otros meses', () => {
  it('rangoDeMes cubre el mes completo y llega solo hasta hoy en el mes en curso', () => {
    expect(rangoDeMes('2026-10-01', '2026-11-02')).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' })
    expect(rangoDeMes('2026-11-01', '2026-11-02')).toEqual({ desde: '2026-11-01', hasta: '2026-11-02' })
    expect(rangoDeMes('2028-02-01', '2028-03-05')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' })
  })

  it('las flechas piden el mes anterior y el siguiente; el siguiente se bloquea en el mes en curso', () => {
    const onRango = vi.fn()
    const { rerender } = render(<MesAMesResumen movimientos={movimientos} cuentas={cuentas} desde="2026-10-01" hasta="2026-10-31" onRango={onRango} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }))
    expect(onRango).toHaveBeenLastCalledWith({ desde: '2026-09-01', hasta: '2026-09-30' })
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }))
    expect(onRango.mock.calls.at(-1)[0].desde).toBe('2026-11-01')
    const hoy = new Date()
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`
    rerender(<MesAMesResumen movimientos={movimientos} cuentas={cuentas} desde={mesActual} hasta={mesActual} onRango={onRango} />)
    expect(screen.getByRole('button', { name: 'Mes siguiente' })).toBeDisabled()
  })

  it('sin onRango no muestra flechas', () => {
    render(<MesAMesResumen movimientos={movimientos} cuentas={cuentas} desde="2026-10-01" hasta="2026-10-31" />)
    expect(screen.queryByRole('button', { name: 'Mes anterior' })).not.toBeInTheDocument()
  })
})

