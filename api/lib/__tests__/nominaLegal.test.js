import { describe, expect, it } from 'vitest'
import {
  aplicarReglaLegal, normalizarReglaLegal, reglaEstaAprobada, seleccionarReglasVigentes,
} from '../nominaLegal.js'

const aprobada = {
  codigo: 'FAOV', activo: true, aprobado_por: 'u1', aprobado_en: '2026-01-01T00:00:00Z',
  fuente: 'fuente validada', version: '2026.1', fecha_desde: '2026-01-01',
  tipo: 'porcentaje', valor: 3,
}

describe('motor legal parametrizable', () => {
  it('no permite una regla sin fuente/version o porcentaje fuera de rango', () => {
    expect(() => normalizarReglaLegal({
      codigo: 'IVSS', nombre: 'IVSS', tipo: 'porcentaje', unidad: 'porcentaje', valor: 101,
      fechaDesde: '2026-01-01',
    })).toThrow(/porcentaje|fuente|version/i)
  })

  it('solo selecciona reglas aprobadas y vigentes', () => {
    expect(seleccionarReglasVigentes([aprobada, { ...aprobada, codigo: 'FUTURA', fecha_desde: '2027-01-01' }], '2026-08-08'))
      .toHaveLength(1)
  })

  it('aplica porcentaje sobre base VES y redondea', () => {
    expect(reglaEstaAprobada(aprobada)).toBe(true)
    expect(aplicarReglaLegal(1000, aprobada)).toBe(30)
  })

  it('bloquea reglas no aprobadas y fórmulas sin evaluador', () => {
    expect(() => aplicarReglaLegal(1000, { ...aprobada, activo: false }))
      .toThrow(/no está aprobada/i)
    expect(() => aplicarReglaLegal(1000, { ...aprobada, tipo: 'formula', formula_key: 'legal_x' }))
      .toThrow(/evaluador/i)
  })
})
