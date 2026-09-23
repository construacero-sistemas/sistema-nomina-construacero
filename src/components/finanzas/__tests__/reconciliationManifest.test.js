import { describe, expect, it } from 'vitest'
import { buildReconciliationManifest, manifestToCsv } from '../reconciliationManifest.js'

describe('manifiesto de conciliación', () => {
  it('conserva snapshot, propuestas, bloqueos y autoría separada', () => {
    const manifest = buildReconciliationManifest({
      versionLibro: '136',
      totalServidor: 2,
      rows: [
        { id: 'm1', fecha: '2026-09-21', creado_en: '2026-09-21T10:00:00Z', tipo: 'egreso', categoria: 'Personal', concepto: 'Pago; "Juan"', monto: 100, moneda: 'VES', cuenta_origen: 'Cuenta Venezuela', tasa_registrada_en: '2026-09-21T10:00:01Z', propuesta: { status: 'propuesta', safeToApply: true, confidence: 'alta', cuentaCustodiaId: 'bvn', cuentaNombre: 'Cuenta Venezuela', canonicalName: 'Banco de Venezuela', reason: 'Coincidencia exacta' } },
        { id: 'm2', fecha: '2026-09-21', tipo: 'egreso', categoria: 'Personal', concepto: 'USDT', monto: 5, moneda: 'USDT', propuesta: { status: 'bloqueado', safeToApply: false, reason: 'Mapeo pendiente' } },
      ],
    }, '2026-09-22T12:00:00.000Z')
    expect(manifest).toMatchObject({ formato: 'manifiesto-conciliacion-v1', snapshot_version: '136', total_servidor: 2, total_filas: 2 })
    expect(manifest.ids_seguros).toEqual(['m1'])
    expect(manifest.ids_bloqueados).toEqual(['m2'])
    expect(manifest.filas[0]).toMatchObject({ cuenta_canonica_propuesta: 'Banco de Venezuela', seguro_para_aplicar: 'si', creado_por: '', tasa_sellada: 'si', nota_sustitucion: '' })
    expect(manifest.filas[0].nota_autoria).toMatch(/conciliado_por/)
    expect(manifest.filas[1].tasa_sellada).toBe('no')
    expect(manifest.filas[1].nota_sustitucion).toMatch(/sustituci/)
  })

  it('escapa separadores y comillas sin crear filas adicionales', () => {
    const csv = manifestToCsv({ filas: [{ snapshot_version: '1', total_servidor: 1, movimiento_id: 'm1', concepto: 'Pago; "Juan"' }] })
    expect(csv).toContain('"Pago; ""Juan"""')
    expect(csv.split('\n')).toHaveLength(2)
  })
})
