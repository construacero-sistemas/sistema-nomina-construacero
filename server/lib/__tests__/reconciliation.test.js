import { describe, expect, it } from 'vitest'
import { buildReconciliationPreview, resolveCanonicalAccount } from '../reconciliation.js'

const accounts = [
  { id: 'bvn', nombre: 'Banco Venezuela', banco: 'Banco de Venezuela', tipo: 'banco_ves', moneda: 'VES', activo: true },
  { id: 'prov', nombre: 'Banco Provincial', banco: 'BBVA Provincial', tipo: 'banco_ves', moneda: 'VES', activo: true },
  { id: 'usdt', nombre: 'Billetera USDT', tipo: 'cripto_usdt', moneda: 'USDT', activo: true },
  { id: 'cash', nombre: 'Caja Efectivo $', tipo: 'efectivo_usd', moneda: 'USD', activo: true },
  { id: 'cajabs', nombre: 'Caja Efectivo Bs', tipo: 'efectivo_ves', moneda: 'VES', activo: true },
]

describe('simulación de conciliación financiera', () => {
  it('propone Banco Venezuela cuando el origen contiene una señal inequívoca', () => {
    const { rows, counts, safeIds } = buildReconciliationPreview([
      { id: 'm1', moneda: 'VES', estado: 'activo', cuenta_origen: 'Cuenta Venezuela 4858' },
    ], accounts)
    expect(rows[0].propuesta).toMatchObject({ status: 'propuesta', cuentaCustodiaId: 'bvn' })
    expect(counts).toMatchObject({ total: 1, propuesta: 1, ambiguo: 0 })
    expect(safeIds).toEqual(['m1'])
  })

  it('propone Provincial sin confundirlo con el otro banco', () => {
    const { rows } = buildReconciliationPreview([
      { id: 'm2', moneda: 'VES', estado: 'activo', cuenta_origen: 'Gaby Provincial' },
    ], accounts)
    expect(rows[0].propuesta).toMatchObject({ status: 'propuesta', cuentaCustodiaId: 'prov' })
  })

  it('propone la única cuenta USDT y la única caja USD', () => {
    const { rows, counts } = buildReconciliationPreview([
      { id: 'm3', moneda: 'USDT', estado: 'activo', cuenta_origen: null },
      { id: 'm4', moneda: 'USD', estado: 'activo', cuenta_origen: null },
    ], accounts)
    expect(rows.map(row => row.propuesta.cuentaCustodiaId)).toEqual(['usdt', 'cash'])
    expect(counts.propuesta).toBe(2)
  })

  it('no inventa una cuenta para VES sin origen cuando hay dos bancos', () => {
    const { rows } = buildReconciliationPreview([
      { id: 'm5', moneda: 'VES', estado: 'activo', cuenta_origen: null },
    ], accounts)
    expect(rows[0].propuesta.status).toBe('ambiguo')
    expect(rows[0].propuesta.cuentaCustodiaId).toBeUndefined()
  })

  it('mapea cuentas actuales a nombres canónicos y bloquea una cuenta desconocida', () => {
    expect(resolveCanonicalAccount({ nombre: 'Cuenta Venezuela', moneda: 'VES', tipo: 'banco_ves' })).toMatchObject({ name: 'Banco de Venezuela', status: 'confirmada' })
    expect(resolveCanonicalAccount({ nombre: 'Gaby Provincial', moneda: 'VES', tipo: 'banco_ves' })).toMatchObject({ name: 'Banco Provincial', status: 'confirmada' })
    expect(resolveCanonicalAccount({ nombre: 'Gaby3737', moneda: 'VES', tipo: 'banco_ves' })).toMatchObject({ status: 'bloqueada' })
    const preview = buildReconciliationPreview([{ id: 'm9', moneda: 'VES', estado: 'activo', cuenta_origen: 'Gaby3737' }], [{ id: 'g', nombre: 'Gaby3737', moneda: 'VES', tipo: 'banco_ves', activo: true }])
    expect(preview.rows[0].propuesta.status).toBe('bloqueado')
    expect(preview.safeIds).toEqual([])
    expect(preview.blockedIds).toEqual(['m9'])
  })

  it('marca como incompatible una moneda sin catálogo y conserva filas ya asignadas', () => {
    const { rows, counts } = buildReconciliationPreview([
      { id: 'm6', moneda: 'EUR', estado: 'activo', cuenta_origen: null },
      { id: 'm7', moneda: 'VES', estado: 'activo', cuenta_custodia_id: 'prov' },
      { id: 'm8', moneda: 'VES', estado: 'anulado' },
    ], accounts)
    expect(rows.map(row => row.propuesta.status)).toEqual(['incompatible', 'asignado', 'omitido'])
    expect(counts).toMatchObject({ incompatible: 1, asignado: 1, omitido: 1 })
  })

  it('clasifica las patas de traspaso por su cartera propia en referencia', () => {
    const { rows, counts, safeIds } = buildReconciliationPreview([
      { id: 't1', moneda: 'VES', estado: 'activo', categoria: 'Transferencia entre carteras', concepto: 'Traspaso a USDT ($)', referencia: 'Efectivo Bs', observaciones: 'Traspaso interno entre carteras (Efectivo Bs → USDT)' },
      { id: 't2', moneda: 'USDT', estado: 'activo', categoria: 'Transferencia entre carteras', concepto: 'Traspaso recibido desde Efectivo Bs (Bs.)', referencia: 'USDT', observaciones: 'Traspaso interno entre carteras (Efectivo Bs → USDT)' },
      { id: 't3', moneda: 'USD', estado: 'activo', categoria: 'Transferencia entre carteras', concepto: 'Traspaso a Efectivo Bs (Bs.)', referencia: 'Efectivo $', observaciones: 'Traspaso interno entre carteras (Efectivo $ → Efectivo Bs)' },
    ], accounts)
    expect(rows.map(row => [row.propuesta.status, row.propuesta.cuentaCustodiaId, row.propuesta.canonicalName])).toEqual([
      ['propuesta', 'cajabs', 'Efectivo VES'],
      ['propuesta', 'usdt', 'USDT'],
      ['propuesta', 'cash', 'Efectivo USD'],
    ])
    expect(counts.propuesta).toBe(3)
    expect(safeIds).toEqual(['t1', 't2', 't3'])
  })

  it('excluye las Ventas POS del sistema no listo: se proponen para anulación, no para asignación', () => {
    const { rows, safeIds, counts } = buildReconciliationPreview([
      { id: 'p1', moneda: 'VES', estado: 'activo', categoria: 'Ventas', concepto: 'Ventas POS en Pago Móvil - 2026-08-29', referencia: 'Pago Móvil · POS-2026-08-29' },
      { id: 'p2', moneda: 'USD', estado: 'activo', categoria: 'Ventas', concepto: 'Ventas POS (Mostrador / Despachos) - 2026-08-29', referencia: 'Efectivo $ · POS-2026-08-29' },
      { id: 'p3', moneda: 'USD', estado: 'anulado', categoria: 'Ventas', concepto: 'Ventas POS (Mostrador / Despachos) - 2026-08-29' },
    ], accounts)
    expect(rows.map(row => row.propuesta.status)).toEqual(['excluir', 'excluir', 'omitido'])
    expect(rows[0].propuesta.reason).toMatch(/anulación/)
    expect(safeIds).toEqual([])
    expect(counts.excluir).toBe(2)
  })

  it('reconoce la caja VES como canónica Efectivo VES', () => {
    expect(resolveCanonicalAccount({ nombre: 'Caja Efectivo Bs', moneda: 'VES', tipo: 'efectivo_ves' })).toMatchObject({ name: 'Efectivo VES', status: 'confirmada' })
  })
})
