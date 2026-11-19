// @vitest-environment jsdom
// «Hoja semanal» (docs/PLAN_HOJA_SEMANAL.md): columnas de la planilla, totales de
// TODAS las filas, descuento manual desde la hoja y exportación a Excel.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({ hoja: { data: null, isLoading: false, isError: false, refetch: vi.fn() } }))
vi.mock('../../../hooks/useHojaSemanal.js', () => ({ default: () => mocks.hoja }))

import HojaSemanal from '../HojaSemanal.jsx'
import { hojaACsv } from '../hojaSemanalCsv.js'

const PERIODO = { id: 'p-1', nombre: 'Semana 05–11/11', desde: '2026-11-05', hasta: '2026-11-11', estado: 'abierto' }
const fila = (extra) => ({
  sueldoMensual: 240, diasTrabajados: 5, valorDiasTrabajados: 40, diasDescansoPagados: 2, valorDescansoPagado: 16, semana: 56, sueldoSemanal: 21, bonoSemanal: 35, horasExtra: 2, totalExtras: 5,
  diasDescansoTrabajados: 0, valorDescansoTrabajado: 0, otrosPagos: 0, totalACobrar: 61, descuentos: 0, neto: 61, pagado: false, ...extra,
})
const FILAS = [
  fila({ lineaId: 'l-1', empleadoId: 'e-1', nombre: 'fralin lozano', sueldoMensual: 280, valorDiasTrabajados: 46.67, valorDescansoPagado: 18.66, sueldoSemanal: 30.33, semana: 65.33, totalExtras: 7.5, horasExtra: 3, diasDescansoTrabajados: 1, valorDescansoTrabajado: 9.34, totalACobrar: 82.17, neto: 82.17 }),
  fila({ lineaId: 'l-2', empleadoId: 'e-2', nombre: 'julian guaina', pagado: true, tasaPago: 1000, totalPagadoBs: 61000 }),
]
const TOTALES = { empleados: 2, valorDiasTrabajados: 86.67, valorDescansoPagado: 34.66, sueldoSemanal: 51.33, bonoSemanal: 70, horasExtra: 5, totalExtras: 12.5, diasDescansoTrabajados: 1, valorDescansoTrabajado: 9.34, otrosPagos: 0, totalACobrar: 143.17, descuentos: 0, neto: 143.17 }
const bsDe = f => (f.pagado ? f.totalPagadoBs : f.neto * 1000)

function renderHoja(props = {}) {
  const onAgregarDescuento = vi.fn()
  const vista = render(
    <HojaSemanal periodo={PERIODO} lineas={[{ id: 'l-1' }, { id: 'l-2' }]} abierto puedeGestionarNomina
      bsDe={bsDe} onAgregarDescuento={onAgregarDescuento} {...props} />,
  )
  return { ...vista, onAgregarDescuento }
}

afterEach(() => {
  cleanup()
  mocks.hoja = { data: { periodo: PERIODO, bonoSemanal: 35, filas: FILAS, totales: TOTALES }, isLoading: false, isError: false, refetch: vi.fn() }
})
mocks.hoja = { data: { periodo: PERIODO, bonoSemanal: 35, filas: FILAS, totales: TOTALES }, isLoading: false, isError: false, refetch: vi.fn() }

describe('HojaSemanal', () => {
  it('muestra las columnas de la planilla con el bono en el primer recuadro y sin tabla de «sueldo legal»', () => {
    renderHoja()
    const tabla = screen.getByRole('table', { name: 'Hoja semanal del período' })
    const encabezados = within(tabla).getAllByRole('columnheader').map(th => th.textContent)
    expect(encabezados).toEqual(['Nombre', 'Días trab.', 'Descanso', 'Sueldo semanal', 'Bono semanal', 'Horas extra',
      'Desc. o feriado trab.', 'Total a cobrar', 'Descuentos', 'Neto'])
    expect(screen.queryByText(/sueldo legal/i)).toBeNull()
    const fralin = within(tabla).getByRole('rowheader', { name: /^Fralin Lozano/ }).closest('tr')
    expect(fralin).toHaveTextContent('30,33')
    expect(fralin).toHaveTextContent('35,00')
    expect(fralin).toHaveTextContent('82,17')
    // Cada cantidad va debajo de su monto y el sueldo mensual debajo del nombre.
    expect(fralin).toHaveTextContent('280,00 al mes')
    expect(fralin).toHaveTextContent('46,675 días')
    expect(fralin).toHaveTextContent('18,662 días')
    expect(fralin).toHaveTextContent('7,503 h')
    expect(fralin).toHaveTextContent('9,341 día')
  })

  it('agrupa las columnas (Semana · Pago · Adicionales) y no corta palabras a la mitad', () => {
    renderHoja()
    const tabla = screen.getByRole('table', { name: 'Hoja semanal del período' })
    expect(tabla).toHaveClass('[overflow-wrap:normal]')
    const grupos = tabla.querySelector('thead tr[aria-hidden="true"]')
    expect(grupos).toHaveTextContent(/Semana.*Pago.*Adicionales/)
  })

  it('muestra la tasa de nómina y el total a cobrar en bolívares (los pagados con su tasa guardada)', () => {
    renderHoja({ tasa: 950, tasaOrigen: 'activa' })
    expect(screen.getAllByText(/Tasa de nómina/)[0].closest('p')).toHaveTextContent(/Bs 950,00 por \$1.*activa.*tasa guardada al pagar/)
    const tabla = screen.getByRole('table', { name: 'Hoja semanal del período' })
    // Fralin: total $82,17 × 950 = Bs 78.061,50
    expect(within(tabla).getByRole('rowheader', { name: /^Fralin Lozano/ }).closest('tr')).toHaveTextContent('78.061,50')
    // Julián ya pagado: $61 × 1.000 (tasa guardada) = Bs 61.000
    expect(within(tabla).getByRole('rowheader', { name: /^Julian Guaina/ }).closest('tr')).toHaveTextContent('61.000,00')
    // Pie: 78.061,50 + 61.000,00 = 139.061,50
    expect(screen.getByRole('rowheader', { name: 'Totales (2)' }).closest('tr')).toHaveTextContent('139.061,50')
  })

  it('sin tasa no muestra el aviso de tasa', () => {
    renderHoja()
    expect(screen.queryByText(/Tasa de nómina/)).toBeNull()
  })

  it('«Otros pagos» solo aparece si alguien tiene un monto', () => {
    expect(screen.queryByRole('columnheader', { name: 'Otros pagos' })).toBeNull()
    cleanup()
    mocks.hoja = { ...mocks.hoja, data: { ...mocks.hoja.data, filas: [FILAS[0], { ...FILAS[1], otrosPagos: 12 }] } }
    renderHoja()
    expect(screen.getByRole('columnheader', { name: 'Otros pagos' })).toBeInTheDocument()
  })

  it('la fila de totales suma todas las filas, incluido el neto en Bs', () => {
    renderHoja()
    const totales = screen.getByRole('rowheader', { name: 'Totales (2)' }).closest('tr')
    expect(totales).toHaveTextContent('143,17')
    expect(totales).toHaveTextContent('70,00')
    // 82,17 × 1000 + 61.000 (congelado al pagar) = 143.170 Bs
    expect(totales).toHaveTextContent(/143\.170,00/)
  })

  it('el descuento manual se agrega desde la hoja (solo período abierto, con permiso y sin pagar)', () => {
    const { onAgregarDescuento } = renderHoja()
    fireEvent.click(screen.getByRole('button', { name: 'Descuento a Fralin Lozano' }))
    expect(onAgregarDescuento).toHaveBeenCalledWith({ id: 'l-1' })
    expect(screen.queryByRole('button', { name: 'Descuento a Julian Guaina' })).toBeNull() // ya pagado
  })

  // Responsiva sin recortar: en teléfono cada persona es una ficha con TODOS los
  // campos de la planilla (sin desplazamiento lateral), más una ficha de totales.
  it('en teléfono muestra una ficha por persona con todos los campos y la de totales', () => {
    const { onAgregarDescuento } = renderHoja()
    const lista = screen.getByRole('list', { name: 'Hoja semanal por persona' })
    expect(lista).toHaveClass('lg:hidden')
    expect(screen.getByRole('table', { name: 'Hoja semanal del período' }).closest('.hidden')).toHaveClass('lg:block')
    const fralin = within(lista).getByRole('heading', { name: 'Fralin Lozano' }).closest('li')
    for (const etiqueta of ['Días trab.', 'Descanso', 'Sueldo semanal', 'Bono semanal', 'Horas extra',
      'Desc. o feriado trab.', 'Total a cobrar', 'Descuentos']) {
      expect(within(fralin).getByText((_, el) => el?.tagName === 'DT' && el.textContent.startsWith(etiqueta))).toBeInTheDocument()
    }
    expect(fralin).toHaveTextContent('280,00 al mes')
    expect(fralin).toHaveTextContent('82,17')
    expect(fralin).not.toHaveClass('truncate')
    fireEvent.click(within(fralin).getByRole('button', { name: 'Agregar descuento a Fralin Lozano' }))
    expect(onAgregarDescuento).toHaveBeenCalledWith({ id: 'l-1' })
    const totales = within(lista).getByRole('listitem', { name: 'Totales de la semana' })
    expect(totales).toHaveTextContent('143,17')
    expect(document.querySelectorAll('.truncate')).toHaveLength(0)
  })

  it('sin permiso o con el período cerrado no ofrece agregar descuentos', () => {
    const { rerender, onAgregarDescuento } = renderHoja({ puedeGestionarNomina: false })
    expect(screen.queryByRole('button', { name: /^Descuento a/ })).toBeNull()
    rerender(<HojaSemanal periodo={PERIODO} lineas={[{ id: 'l-1' }]} abierto={false} puedeGestionarNomina bsDe={bsDe} onAgregarDescuento={onAgregarDescuento} />)
    expect(screen.queryByRole('button', { name: /^Descuento a/ })).toBeNull()
  })

  it('sin recibos calculados pide calcular, y ante un error no muestra ceros', () => {
    mocks.hoja = { ...mocks.hoja, data: { ...mocks.hoja.data, filas: [] } }
    const { unmount } = renderHoja()
    expect(screen.getByText(/Aún no se ha calculado/)).toBeInTheDocument()
    unmount()
    mocks.hoja = { ...mocks.hoja, isError: true }
    renderHoja()
    expect(screen.getByRole('alert')).toHaveTextContent('No se muestran totales en cero')
  })

  it('«Descargar Excel» genera el archivo de la semana', () => {
    const crear = vi.fn(() => 'blob:hoja')
    URL.createObjectURL = crear
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderHoja()
    fireEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }))
    expect(crear).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })
})

describe('hojaACsv', () => {
  it('usa «;», coma decimal, BOM y una fila de totales', () => {
    const csv = hojaACsv({ periodo: PERIODO, filas: FILAS, totales: TOTALES, bsDe })
    expect(csv.startsWith('﻿')).toBe(true)
    const lineas = csv.slice(1).split('\r\n')
    expect(lineas[0]).toContain('Semana 05–11/11 (2026-11-05 a 2026-11-11)')
    expect(lineas[1].split(';')[7]).toBe('"Bono semanal"')
    expect(lineas[2]).toContain('"Fralin Lozano"')
    expect(lineas[2]).toContain('"82,17"')
    expect(lineas.at(-1)).toMatch(/^"TOTALES";/)
    expect(lineas.at(-1)).toContain('"143,17"')
    expect(lineas.at(-1)).toContain('"143170,00"')
  })
})
