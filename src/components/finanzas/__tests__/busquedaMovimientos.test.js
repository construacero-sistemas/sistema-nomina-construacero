import { describe, expect, it } from 'vitest'
import { filtrarMovimientos, interpretarBusqueda, normalizarTexto, parsearMonto } from '../busquedaMovimientos.js'

const base = { estado: 'activo', metodo_pago: 'Bolívares digitales', moneda: 'VES' }
const filas = [
  { ...base, id: 'a', numero: 126, fecha: '2026-10-05', tipo: 'ingreso', categoria: 'INGRESOS', concepto: 'VENTA', monto: 1500000 },
  { ...base, id: 'b', numero: 129, fecha: '2026-10-05', tipo: 'ingreso', categoria: 'INGRESOS', concepto: 'VENTA', monto: 1500000 },
  { ...base, id: 'c', numero: 665, fecha: '2026-10-26', tipo: 'egreso', categoria: 'Proveedores', concepto: 'CEMENTO', monto: 4326566.4 },
  { ...base, id: 'd', numero: 524, fecha: '2026-10-21', tipo: 'egreso', categoria: 'NOMINA EMPRESA', concepto: 'Nómina', monto: 59590.56, referencia: 'Ref 4156' },
  { ...base, id: 'e', numero: 748, fecha: '2026-10-29', tipo: 'egreso', categoria: 'VUELTO EN BS', concepto: 'Vuelto', monto: 4131490 },
  { ...base, id: 'f', numero: 119, fecha: '2026-10-31', tipo: 'egreso', categoria: 'DONACION.', concepto: 'prueba', monto: 100, estado: 'anulado' },
]
const ids = texto => filtrarMovimientos(filas, texto).map(f => f.id)

describe('buscador de movimientos', () => {
  it('normaliza tildes y mayúsculas y entiende montos en formato es/en', () => {
    expect(normalizarTexto('  NÓMINA  Obra ')).toBe('nomina obra')
    expect(parsearMonto('1.500.000')).toBe(1500000)
    expect(parsearMonto('1.500.000,50')).toBe(1500000.5)
    expect(parsearMonto('1,500,000.25')).toBe(1500000.25)
    expect(parsearMonto('4326566,4')).toBe(4326566.4)
    expect(parsearMonto('abc')).toBeNull()
  })

  it('sin texto devuelve todo', () => {
    expect(ids('   ')).toHaveLength(filas.length)
  })

  it('busca por palabras sin importar tildes y combina varias con "y"', () => {
    expect(ids('nomina')).toEqual(['d'])
    expect(ids('venta ingresos')).toEqual(['a', 'b'])
    expect(ids('cemento nomina')).toEqual([])
  })

  it('busca por número de registro, monto exacto y número dentro de la referencia', () => {
    expect(ids('#665')).toEqual(['c'])
    expect(ids('1.500.000')).toEqual(['a', 'b'])
    expect(ids('4156')).toEqual(['d'])
  })

  it('entiende rangos y comparaciones de monto', () => {
    expect(ids('>1000000')).toEqual(['a', 'b', 'c', 'e'])
    expect(ids('100000..5000000 egreso')).toEqual(['c', 'e'])
    expect(ids('> 4000000')).toEqual(['c', 'e'])
    expect(ids('<=100')).toEqual(['f'])
  })

  it('entiende tipo, anulados y fechas', () => {
    expect(ids('ingresos')).toEqual(['a', 'b'])
    expect(ids('anulados')).toEqual(['f'])
    expect(ids('5 oct')).toEqual(['a', 'b'])
    expect(ids('26/10')).toEqual(['c'])
    expect(ids('2026-10-29')).toEqual(['e'])
    expect(ids('octubre egreso vuelto')).toEqual(['e'])
  })

  it('encuentra posibles repetidos', () => {
    expect(ids('repetidos')).toEqual(['a', 'b'])
    expect(ids('duplicados ingreso')).toEqual(['a', 'b'])
  })

  it('las frases entre comillas se buscan completas', () => {
    expect(ids('"vuelto en bs"')).toEqual(['e'])
    expect(ids('"en vuelto"')).toEqual([])
  })

  it('explica lo que entendió', () => {
    const { etiquetas } = interpretarBusqueda('ingresos >1.000.000 5 oct venta')
    expect(etiquetas).toEqual(['Fecha 5 oct', 'Solo ingresos', 'Monto > 1.000.000', 'Contiene «venta»'])
  })
})
