// Descanso semanal y feriados remunerados (LOTTT art. 119).
// Semana de referencia de la planilla de la empresa: jueves 10 → miércoles 16 de
// septiembre de 2026 (sábado 12 y domingo 13 son descanso).
import { describe, it, expect } from 'vitest'
import { calcularDescansoRemunerado } from '../nominaDescanso.js'
import { calcularLineaNomina } from '../nominaUtils.js'

const DESDE = '2026-09-10'
const HASTA = '2026-09-16'
const HABILES = ['2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16']
const LUN_VIE = [1, 2, 3, 4, 5]
const HOY = '2026-11-17'

const dia = (fecha, extra = {}) => ({
  fecha, horas_normales: 8, horas_extra: 0, horas_trabajadas: 8,
  es_sabado: false, es_domingo: false, es_feriado: false, es_ausencia: false,
  hora_entrada: '08:00', hora_salida: '17:00', ...extra,
})
const contexto = (extra = {}) => ({ desde: DESDE, hasta: HASTA, diasLaborables: LUN_VIE, feriados: [], hoy: HOY, ...extra })
// Frailin: 280 al mes → 280 / 30 = 9,3333 por día (LOTTT art. 113).
const FRAILIN = { salario_dia_usd: 280 / 30, horas_jornada: 8 }

describe('calcularDescansoRemunerado', () => {
  it('semana completa: paga sábado y domingo', () => {
    const r = calcularDescansoRemunerado({ ...contexto(), asistencias: HABILES.map(f => dia(f)) })
    expect(r.diasDescanso).toBe(2)
    expect(r.fechasDescanso).toEqual(['2026-09-12', '2026-09-13'])
  })

  it('faltar UN día no quita el descanso', () => {
    const r = calcularDescansoRemunerado({ ...contexto(), asistencias: HABILES.slice(1).map(f => dia(f)) })
    expect(r.diasDescanso).toBe(2)
    expect(r.diasDescansoPerdidos).toBe(0)
  })

  it('faltar DOS días hábiles hace perder el descanso de esa semana', () => {
    const asistencias = [dia(HABILES[0]), dia(HABILES[1], { es_ausencia: true, hora_entrada: null, horas_normales: 0 }), dia(HABILES[3]), dia(HABILES[4])]
    const r = calcularDescansoRemunerado({ ...contexto(), asistencias })
    expect(r.diasDescanso).toBe(0)
    expect(r.diasDescansoPerdidos).toBe(2)
    expect(r.semanasConPerdida).toBe(1)
  })

  it('un feriado no laborable entre semana también se paga y no cuenta como falta', () => {
    const feriados = [{ fecha: '2026-09-15', laborable: false }]
    const asistencias = HABILES.filter(f => f !== '2026-09-15').map(f => dia(f))
    const r = calcularDescansoRemunerado({ ...contexto({ feriados }), asistencias })
    expect(r.diasDescanso).toBe(3)
  })

  it('un feriado marcado como laborable es un día hábil normal', () => {
    const feriados = [{ fecha: '2026-09-15', laborable: true }]
    const r = calcularDescansoRemunerado({ ...contexto({ feriados }), asistencias: HABILES.map(f => dia(f)) })
    expect(r.diasDescanso).toBe(2)
  })

  it('los días hábiles futuros no son falta (período calculado a mitad de semana)', () => {
    const r = calcularDescansoRemunerado({ ...contexto({ hoy: '2026-09-11' }), asistencias: [dia(HABILES[0]), dia(HABILES[1])] })
    expect(r.diasDescanso).toBe(2)
  })

  it('antes de la fecha de ingreso no hay descanso ni faltas', () => {
    const r = calcularDescansoRemunerado({ ...contexto({ fechaIngreso: '2026-09-14' }), asistencias: HABILES.slice(2).map(f => dia(f)) })
    expect(r.diasDescanso).toBe(0)
    expect(r.diasDescansoPerdidos).toBe(0)
  })

  it('quien trabaja de lunes a sábado solo descansa el domingo', () => {
    const r = calcularDescansoRemunerado({ ...contexto({ diasLaborables: [1, 2, 3, 4, 5, 6] }), asistencias: [...HABILES, '2026-09-12'].map(f => dia(f)) })
    expect(r.diasDescanso).toBe(1)
    expect(r.fechasDescanso).toEqual(['2026-09-13'])
  })

  it('período quincenal: cada bloque de 7 días se evalúa por separado', () => {
    // 10 → 23 de septiembre: dos semanas; en la segunda falta dos días.
    const primera = HABILES.map(f => dia(f))
    const segunda = ['2026-09-17', '2026-09-18', '2026-09-21'].map(f => dia(f))
    const r = calcularDescansoRemunerado({ ...contexto({ hasta: '2026-09-23' }), asistencias: [...primera, ...segunda] })
    expect(r.diasDescanso).toBe(2)
    expect(r.diasDescansoPerdidos).toBe(2)
  })
})

describe('calcularLineaNomina con descanso (art. 119)', () => {
  it('Frailin, semana completa: 7 días × 9,33 = 65,33', () => {
    const r = calcularLineaNomina(HABILES.map(f => dia(f)), FRAILIN, {}, 0, 0, 0, contexto())
    expect(r.dias_trabajados).toBe(5)
    expect(r.dias_descanso).toBe(2)
    expect(r.monto_normal_usd).toBeCloseTo(65.3333, 3)
    expect(r.total_neto_usd).toBeCloseTo(65.3333, 3)
  })

  it('falta un día: pierde solo ese día (6 × 9,33 = 56)', () => {
    const r = calcularLineaNomina(HABILES.slice(1).map(f => dia(f)), FRAILIN, {}, 0, 0, 0, contexto())
    expect(r.dias_descanso).toBe(2)
    expect(r.monto_normal_usd).toBeCloseTo(56, 3)
  })

  it('sábado trabajado: el descanso se paga y el trabajo se paga aparte con el monto fijo', () => {
    const sabado = dia('2026-09-12', { es_sabado: true })
    const r = calcularLineaNomina([...HABILES.map(f => dia(f)), sabado], FRAILIN, { nomina_monto_sabado_usd: 10 }, 0, 0, 0, contexto())
    expect(r.dias_descanso).toBe(2)
    expect(r.monto_normal_usd).toBeCloseTo(65.3333, 3)
    expect(r.monto_sabado_usd).toBe(10)
    expect(r.total_bruto_usd).toBeCloseTo(75.3333, 3)
  })

  it('un domingo registrado sin trabajo no se paga dos veces', () => {
    const domingoSinTrabajo = dia('2026-09-13', { es_domingo: true, es_feriado: true, hora_entrada: null, hora_salida: null, horas_normales: 0, horas_trabajadas: 0 })
    const r = calcularLineaNomina([...HABILES.map(f => dia(f)), domingoSinTrabajo], FRAILIN, {}, 0, 0, 0, contexto())
    expect(r.dias_trabajados).toBe(5)
    expect(r.dias_feriado).toBe(0)
    expect(r.monto_normal_usd).toBeCloseTo(65.3333, 3)
  })

  it('sin contexto se conserva el cálculo anterior (sin descanso)', () => {
    const r = calcularLineaNomina(HABILES.map(f => dia(f)), FRAILIN, {}, 0, 0, 0)
    expect(r.dias_descanso).toBe(0)
    expect(r.monto_normal_usd).toBeCloseTo(46.6667, 3)
  })
})
