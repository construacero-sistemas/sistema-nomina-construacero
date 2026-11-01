// El reporte de movimientos acepta un cierre mensual: saldos de apertura/cierre por cuenta
// + totales y desglose por categoría; el detallado añade cada movimiento.
import { describe, expect, it } from 'vitest'
import { generarFinanzasResumenPDFImpl } from '../finanzasResumenPDF.impl.js'
import { flujoPorCuenta } from '../cierreSaldosSeccion.js'

const cierre = {
  mes: '2026-10-01', hasta: '2026-10-31', estado: 'cerrado', cerradoEn: '2026-11-01T14:00:00Z',
  cuentas: [{ cuentaCustodiaId: 'c1', nombre: 'Caja USD', moneda: 'USD', saldoApertura: '100', saldoAperturaUsd: '100', saldoCierreLibro: '160', saldoCierreReal: '150', saldoCierreUsd: '150', diferenciaCierre: '-10', motivoCierre: 'Faltante verificado' }],
}
const mov = (i, tipo, categoria, extra = {}) => ({
  id: `m${i}`, fecha: '2026-10-05', tipo, categoria, concepto: `Movimiento ${i}`, cuenta_origen: 'Caja USD', cuenta_custodia_id: 'c1',
  monto: 10, moneda: 'USD', tasa_ves: 400, tasa_usd_ves: 400, monto_ves: 4000, tasa_registrada_en: '2026-10-05T12:00:00Z', estado: 'activo', ...extra,
})
const movimientos = [
  ...Array.from({ length: 60 }, (_, i) => mov(i, i % 3 ? 'egreso' : 'ingreso', i % 2 ? 'Materiales' : 'Ventas')),
  mov(99, 'egreso', 'Materiales', { estado: 'anulado' }),
]
const generar = args => generarFinanzasResumenPDFImpl({ movimientos, resumen: { tipoFiltro: '' }, rango: { desde: '2026-10-01', hasta: '2026-10-31' }, action: 'return', ...args })

describe('finanzasResumenPDF — cierre mensual', () => {
  it('flujoPorCuenta ignora anulados y otras cuentas', () => {
    expect(flujoPorCuenta([mov(1, 'ingreso', 'A'), mov(2, 'egreso', 'A'), mov(3, 'egreso', 'A', { estado: 'anulado' }), mov(4, 'ingreso', 'A', { cuenta_custodia_id: 'c2' })], 'c1')).toEqual({ ingresos: 10, egresos: 10 })
  })

  it('genera el resumido y el detallado; el detallado es más largo', async () => {
    const resumido = await generar({ tipoReporte: 'resumido', cierre })
    const detallado = await generar({ tipoReporte: 'completo', cierre })
    // Los anulados no salen: con o sin ellos en la entrada, el PDF es idéntico en páginas.
    const sinAnulados = await generar({ tipoReporte: 'completo', cierre, movimientos: movimientos.filter(m => m.estado !== 'anulado') })
    expect(sinAnulados.internal.getNumberOfPages()).toBe(detallado.internal.getNumberOfPages())
    expect(detallado.internal.getNumberOfPages()).toBeGreaterThan(resumido.internal.getNumberOfPages())
  })
})
