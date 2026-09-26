// src/utils/__tests__/diasLaborables.test.js
// Espejo del resolutor del servidor: la ficha muestra la semana vigente y no pisa
// un horario programado a futuro (F-9), y el payload de guardado lleva solo los días
// marcados con sus horas (contrato de `POST /nomina/calendario/horarios/empleado`).
import { describe, expect, it } from 'vitest'
import {
  DIAS_LABORABLES_DEFAULT,
  NOMBRE_DIA,
  diaSemanaDeFecha,
  diasActivosSemana,
  diasLaborablesDeConfig,
  diasLaborablesTexto,
  semanaEditable,
  trabajaEnFecha,
} from '../diasLaborables.js'

function fila(dia, patch = {}) {
  return {
    empleado_id: 'emp-1', dia_semana: dia, semana_ciclo: null, fecha_hasta: null,
    fecha_desde: '2000-01-01', hora_inicio: '08:00:00', hora_fin: '16:00:00',
    horas_jornada: 7.5, trabaja: true, ...patch,
  }
}

describe('días laborables en el front', () => {
  it('sin dato propio asume el horario histórico y el domingo nunca trabaja', () => {
    expect(diasLaborablesDeConfig({})).toEqual([...DIAS_LABORABLES_DEFAULT])
    expect(diasLaborablesDeConfig({ dias_laborables: [1, 3] })).toEqual([1, 3])
    expect(diaSemanaDeFecha('2026-08-09')).toBe(0)
    expect(trabajaEnFecha([1, 2, 3, 4, 5], '2026-08-09')).toBe(false)
    expect(trabajaEnFecha([6], '2026-08-08')).toBe(true)
    expect(NOMBRE_DIA[6]).toBe('Sábado')
  })

  it('resume la semana en palabras, incluida la vacía', () => {
    expect(diasLaborablesTexto([1, 2, 3, 4, 5, 6])).toBe('Lun a Sáb')
    expect(diasLaborablesTexto([1, 2, 3, 4, 5])).toBe('Lun a Vie')
    expect(diasLaborablesTexto([1, 4])).toBe('Lun · Jue')
    expect(diasLaborablesTexto([])).toBe('Ningún día')
  })

  it('la semana editable sale de los horarios permanentes de la persona', () => {
    const semana = semanaEditable([fila(1), fila(6, { hora_fin: '12:00:00', horas_jornada: 4 })], { fecha: '2026-08-03' })

    expect(semana.hayHorario).toBe(true)
    expect(semana.dias.map(dia => dia.activo)).toEqual([true, false, false, false, false, true])
    expect(semana.dias[5]).toMatchObject({ horaFin: '12:00', horasJornada: 4 })
    // Sin filas propias se parte del horario de la ficha con todos los días marcados.
    expect(semanaEditable([], { horaInicio: '07:00', horasJornada: 6 }).dias[0]).toMatchObject({ activo: true, horaInicio: '07:00', horasJornada: 6 })
  })

  it('ignora un horario que todavía no rige y los rotativos', () => {
    const semana = semanaEditable([
      fila(2),
      fila(5, { fecha_desde: '2026-09-01' }),
      fila(3, { semana_ciclo: 2 }),
      fila(4, { fecha_hasta: '2026-08-31' }),
      fila(6, { trabaja: false }),
    ], { fecha: '2026-08-03' })

    expect(semana.dias.map(dia => dia.activo)).toEqual([false, true, false, false, false, false])
    // Al 1 de septiembre ese horario ya rige: aplicarlo no lo borra.
    const futuro = semanaEditable([fila(2), fila(5, { fecha_desde: '2026-09-01' })], { fecha: '2026-09-10' })
    expect(futuro.dias.map(dia => dia.activo)).toEqual([false, true, false, false, true, false])
  })

  it('el payload de guardado lleva solo los días marcados, con horas normalizadas', () => {
    const semana = semanaEditable([fila(1), fila(2, { hora_inicio: '08:30:00', hora_fin: '17:00:00', horas_jornada: 8.5 })], { fecha: '2026-08-03' })
    expect(diasActivosSemana(semana.dias)).toEqual([
      { diaSemana: 1, horaInicio: '08:00', horaFin: '16:00', horasJornada: 7.5 },
      { diaSemana: 2, horaInicio: '08:30', horaFin: '17:00', horasJornada: 8.5 },
    ])
    expect(diasActivosSemana([])).toEqual([])
  })
})
