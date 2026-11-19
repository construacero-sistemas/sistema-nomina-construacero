// Reglas de la ley editables (migración 263): valores por defecto, lectura y validación.
import { describe, it, expect } from 'vitest'
import { REGLAS_LEY_DEFAULT, reglasLeyDeConfig, validarReglasLey } from '../nominaReglasLey.js'
import { calcularDescansoRemunerado } from '../nominaDescanso.js'
import { calcularLineaNomina } from '../nominaUtils.js'

describe('reglasLeyDeConfig', () => {
  it('sin configuración usa la ley vigente (LOTTT 2012)', () => {
    expect(reglasLeyDeConfig(undefined)).toEqual({
      divisorMensual: 30, diasLaborablesDefault: [1, 2, 3, 4, 5], descansoRemunerado: true, faltasPierdeDescanso: 0,
    })
    expect(REGLAS_LEY_DEFAULT.divisorMensual).toBe(30)
  })

  it('toma los valores guardados por la empresa', () => {
    const r = reglasLeyDeConfig({
      nomina_divisor_mensual: 31, nomina_dias_laborables_default: [1, 2, 3, 4, 5, 6],
      nomina_descanso_remunerado: false, nomina_faltas_pierde_descanso: 0,
    })
    expect(r).toEqual({ divisorMensual: 31, diasLaborablesDefault: [1, 2, 3, 4, 5, 6], descansoRemunerado: false, faltasPierdeDescanso: 0 })
  })

  it('un valor guardado inválido vuelve al de la ley en vez de romper el cálculo', () => {
    const r = reglasLeyDeConfig({ nomina_divisor_mensual: 0, nomina_dias_laborables_default: [0, 7], nomina_faltas_pierde_descanso: 9 })
    expect(r.divisorMensual).toBe(30)
    expect(r.diasLaborablesDefault).toEqual([1, 2, 3, 4, 5])
    expect(r.faltasPierdeDescanso).toBe(0)
  })
})

describe('validarReglasLey', () => {
  it('acepta valores en rango y ordena los días', () => {
    const { fields, error } = validarReglasLey({
      nomina_divisor_mensual: 30, nomina_dias_laborables_default: [5, 1, 3], nomina_descanso_remunerado: true, nomina_faltas_pierde_descanso: 3,
    })
    expect(error).toBeNull()
    expect(fields.nomina_dias_laborables_default).toEqual([1, 3, 5])
  })

  it.each([
    [{ nomina_divisor_mensual: 0 }, /divisor/i],
    [{ nomina_divisor_mensual: 30.5 }, /divisor/i],
    [{ nomina_dias_laborables_default: [] }, /días laborables/i],
    [{ nomina_dias_laborables_default: [0, 1] }, /días laborables/i],
    [{ nomina_descanso_remunerado: 'si' }, /descanso/i],
    [{ nomina_faltas_pierde_descanso: 8 }, /faltas/i],
  ])('rechaza %j', (body, mensaje) => {
    expect(validarReglasLey(body).error).toMatch(mensaje)
  })

  it('no toca lo que no viene en el cuerpo', () => {
    expect(validarReglasLey({ nomina_factor_hora_extra: 2.5 })).toEqual({ fields: {}, error: null })
  })
})

describe('reglas aplicadas al cálculo', () => {
  const habiles = ['2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16']
  const dia = (fecha, extra = {}) => ({ fecha, horas_normales: 8, horas_extra: 0, es_ausencia: false, hora_entrada: '08:00', hora_salida: '17:00', ...extra })
  const ctx = { desde: '2026-09-10', hasta: '2026-09-16', diasLaborables: [1, 2, 3, 4, 5], feriados: [], hoy: '2026-11-17' }
  const dosFaltas = [dia(habiles[0]), dia(habiles[1]), dia(habiles[2])]

  it('faltasPierde = 0: el descanso nunca se pierde', () => {
    expect(calcularDescansoRemunerado({ ...ctx, asistencias: dosFaltas, faltasPierde: 0 }).diasDescanso).toBe(2)
  })

  it('faltasPierde = 3: con dos faltas todavía se paga', () => {
    expect(calcularDescansoRemunerado({ ...ctx, asistencias: dosFaltas, faltasPierde: 3 }).diasDescanso).toBe(2)
    expect(calcularDescansoRemunerado({ ...ctx, asistencias: dosFaltas, faltasPierde: 2 }).diasDescanso).toBe(0)
  })

  it('descanso apagado: se vuelve a pagar solo lo trabajado', () => {
    const r = calcularLineaNomina(habiles.map(f => dia(f)), { salario_dia_usd: 10, horas_jornada: 8 }, {}, 0, 0, 0, { ...ctx, descansoRemunerado: false })
    expect(r.dias_descanso).toBe(0)
    expect(r.monto_normal_usd).toBe(50)
  })

  it('factor 2,5 de hora extra y factor 1 en sábado (regla de la empresa)', () => {
    // 240 al mes → 8 por día → 1 por hora; sábado trabajado = descanso + 1 día más.
    const sabado = dia('2026-09-12', { es_sabado: true })
    const semana = habiles.map(f => dia(f, f === '2026-09-10' ? { horas_extra: 4 } : {}))
    const r = calcularLineaNomina(
      [...semana, sabado],
      { salario_dia_usd: 8, horas_jornada: 8 },
      { nomina_factor_hora_extra: 2.5, nomina_factor_sabado: 1 }, 0, 0, 0, ctx,
    )
    expect(r.dias_descanso).toBe(2)
    expect(r.monto_normal_usd).toBe(64)   // (6 trabajados + 2 descanso) × 8
    expect(r.monto_sabado_usd).toBe(0)    // factor 1: sin recargo, el día ya va en el normal
    expect(r.monto_extra_usd).toBe(10)    // 4 h × 1 × 2,5
  })
})
