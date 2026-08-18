import { describe, expect, it } from 'vitest'
import { compararLineas, puedeActivarNominaV2 } from '../nominaReconciliacion.js'

const base = { empleado_id: 'e1', total_bruto_usd: 100, total_neto_usd: 90 }

describe('reconciliación y rollout', () => {
  it('detecta diferencia monetaria y empleados faltantes', () => {
    expect(compararLineas([base], [{ ...base, total_neto_usd: 89 }])).toHaveLength(1)
    expect(compararLineas([base], [])).toEqual([{ empleadoId: 'e1', tipo: 'faltante_nuevo' }])
  })

  it('solo permite activar con backup, aprobación y cero diferencias', () => {
    expect(puedeActivarNominaV2({ backupVerificado: true, diferencias: [], aprobacionContable: true })).toBe(true)
    expect(puedeActivarNominaV2({ backupVerificado: false, diferencias: [], aprobacionContable: true })).toBe(false)
  })
})
