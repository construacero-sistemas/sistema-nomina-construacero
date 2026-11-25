// server/lib/__tests__/asistenciaExcepciones.test.js
import { describe, it, expect } from 'vitest'
import {
  ATAJOS_HORAS_EXTRA,
  construirRegistroExcepcion,
  esDiaPresentePresunto,
  horarioEfectivoDelDia,
  normalizarHorasExtra,
  sumarHorasHHMM,
} from '../asistenciaExcepciones.js'

describe('asistenciaExcepciones', () => {
  it('normalizarHorasExtra acepta 0, atajos desde 0.5h y decimales con coma; rechaza inválidos', () => {
    expect(ATAJOS_HORAS_EXTRA).toEqual([0.5, 1, 1.5, 2, 3, 4])
    expect(normalizarHorasExtra(0)).toBe(0)
    expect(normalizarHorasExtra('0')).toBe(0)
    expect(normalizarHorasExtra(0.5)).toBe(0.5)
    expect(normalizarHorasExtra('1,75')).toBe(1.75)
    expect(normalizarHorasExtra('16')).toBe(16)
    expect(normalizarHorasExtra(0.25)).toBeNull()
    expect(normalizarHorasExtra(-1)).toBeNull()
    expect(normalizarHorasExtra(16.5)).toBeNull()
    expect(normalizarHorasExtra('')).toBeNull()
    expect(normalizarHorasExtra(null)).toBeNull()
  })

  it('sumarHorasHHMM suma medias horas y cruza medianoche', () => {
    expect(sumarHorasHHMM('17:00', 0.5)).toBe('17:30')
    expect(sumarHorasHHMM('17:00', 2)).toBe('19:00')
    expect(sumarHorasHHMM('23:00', 2.5)).toBe('01:30')
  })

  it('horarioEfectivoDelDia respeta horario por día → ficha → 08:00–17:00', () => {
    const empleado = {
      hora_inicio: '07:30:00',
      hora_fin: '16:30:00',
      horas_jornada: 8,
      horarios_por_dia: {
        5: { hora_inicio: '07:00', hora_fin: '14:00', horas_jornada: 6 },
      },
    }
    // Viernes 2026-11-20 usa el horario del día 5
    expect(horarioEfectivoDelDia(empleado, '2026-11-20')).toEqual({
      horaInicio: '07:00',
      horaFin: '14:00',
      horasJornada: 6,
      horasDescanso: 1,
    })
    // Jueves 2026-11-19 usa el horario de la ficha
    expect(horarioEfectivoDelDia(empleado, '2026-11-19')).toEqual({
      horaInicio: '07:30',
      horaFin: '16:30',
      horasJornada: 8,
      horasDescanso: 1,
    })
    // Empleado sin ficha usa 08:00–17:00
    expect(horarioEfectivoDelDia({}, '2026-11-19')).toEqual({
      horaInicio: '08:00',
      horaFin: '17:00',
      horasJornada: 8,
      horasDescanso: 1,
    })
  })

  it('construirRegistroExcepcion calcula salida y totales con horas extras', () => {
    const horario = { horaInicio: '08:00', horaFin: '17:00', horasJornada: 8, horasDescanso: 1 }
    const row = construirRegistroExcepcion({ fecha: '2026-11-19', horario, horasExtra: 1.5, esFeriado: false })
    expect(row).toMatchObject({
      hora_entrada: '08:00',
      hora_salida: '18:30',
      horas_normales: 8,
      horas_extra: 1.5,
      horas_trabajadas: 9.5,
      horas_descanso: 1,
      es_ausencia: false,
      estado_marcaje: 'manual',
    })
  })

  it('esDiaPresentePresunto solo cuenta días hábiles desde fecha_ingreso sin registro', () => {
    const emp = { dias_laborables: [1, 2, 3, 4, 5], fecha_ingreso: '2026-11-18' }
    expect(esDiaPresentePresunto({ empleado: emp, fecha: '2026-11-17' })).toBe(false) // antes ingreso
    expect(esDiaPresentePresunto({ empleado: emp, fecha: '2026-11-19' })).toBe(true) // jueves hábil
    expect(esDiaPresentePresunto({ empleado: emp, fecha: '2026-11-21' })).toBe(false) // sábado libre
    expect(esDiaPresentePresunto({ empleado: emp, fecha: '2026-11-19', feriado: { laborable: false } })).toBe(false)
    expect(esDiaPresentePresunto({ empleado: emp, fecha: '2026-11-19', feriado: { laborable: true } })).toBe(true)
    expect(esDiaPresentePresunto({ empleado: emp, fecha: '2026-11-19', registro: { id: '1' } })).toBe(false)
  })
})
