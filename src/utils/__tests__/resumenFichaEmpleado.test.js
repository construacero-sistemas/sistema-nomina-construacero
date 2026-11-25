import { describe, expect, it } from 'vitest'
import { avanceSemanaPorEmpleado, resumenSalario } from '../resumenFichaEmpleado.js'

describe('resumenSalario (tarjeta del empleado)', () => {
  it('280 al mes: semana 65,33 = sueldo 30,33 + bono 35, como la hoja semanal', () => {
    const r = resumenSalario({ salarioDia: 9.3333 })
    expect(r.mensual).toBe(280)
    expect(r.semana).toBe(65.33)
    expect(r.sueldoSemanal).toBe(30.33)
    expect(r.bonoSemanal).toBe(35)
    expect(r.horaExtra).toBeNull() // sin configuración no se inventa la hora extra
  })

  it('la hora extra usa el monto fijo de Configuración si existe', () => {
    const r = resumenSalario({ salarioDia: 8, configNomina: { nomina_monto_hora_extra_usd: 2.5, nomina_factor_hora_extra: 1.5 } })
    expect(r.horaExtra).toEqual({ monto: 2.5, fijo: true })
  })

  it('sin monto fijo, la hora extra es tarifa por hora × factor', () => {
    const r = resumenSalario({ salarioDia: 8, horasJornada: 8, configNomina: { nomina_monto_hora_extra_usd: null, nomina_factor_hora_extra: 2 } })
    expect(r.horaExtra).toEqual({ monto: 2, fijo: false, factor: 2 })
  })

  it('un sueldo muy bajo deja todo en bono (misma regla que la hoja)', () => {
    const r = resumenSalario({ salarioDia: 3 })
    expect(r.semana).toBe(21)
    expect(r.sueldoSemanal).toBe(0)
    expect(r.bonoSemanal).toBe(21)
  })
})

describe('avanceSemanaPorEmpleado', () => {
  it('cuenta días trabajados (incluida la jornada abierta) y faltas; ignora filas vacías', () => {
    const mapa = avanceSemanaPorEmpleado([
      { empleado_id: 'a', fecha: '2026-11-12', hora_entrada: '08:00', hora_salida: '17:00', horas_normales: 8 },
      { empleado_id: 'a', fecha: '2026-11-13', hora_entrada: '08:00', estado_marcaje: 'entrada' },
      { empleado_id: 'a', fecha: '2026-11-14', es_ausencia: true },
      { empleado_id: 'b', fecha: '2026-11-12' },
    ])
    expect(mapa.get('a')).toEqual({ trabajados: 2, descansoTrabajados: 0, faltas: 1 })
    expect(mapa.get('b')).toEqual({ trabajados: 0, descansoTrabajados: 0, faltas: 0 })
  })

  it('el sábado y el domingo trabajados cuentan aparte, como descanso trabajado (no «6 de 5 días»)', () => {
    const lunAVie = new Map([['a', [1, 2, 3, 4, 5]], ['s', [1, 2, 3, 4, 5, 6]]])
    const semana = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']
      .map(fecha => ({ empleado_id: 'a', fecha, hora_entrada: '08:00', hora_salida: '17:00', horas_normales: 8 }))
    const mapa = avanceSemanaPorEmpleado([
      ...semana,
      { empleado_id: 'a', fecha: '2026-11-21', es_sabado: true, hora_entrada: '08:00', hora_salida: '12:00', horas_normales: 4 },
      { empleado_id: 'a', fecha: '2026-11-22', es_domingo: true, hora_entrada: '08:00', estado_marcaje: 'entrada' },
      // Quien tiene el sábado en su semana: es un día laborable más.
      { empleado_id: 's', fecha: '2026-11-21', es_sabado: true, hora_entrada: '08:00', hora_salida: '12:00', horas_normales: 4 },
    ], lunAVie)
    expect(mapa.get('a')).toEqual({ trabajados: 5, descansoTrabajados: 2, faltas: 0 })
    expect(mapa.get('s')).toEqual({ trabajados: 1, descansoTrabajados: 0, faltas: 0 })
  })

  it('en modo por exclusión presume presentes toda la semana respetando fecha_ingreso, feriados y faltas', () => {
    const empleados = [
      { empleado_id: 'e1', dias_laborables: [1, 2, 3, 4, 5] },
      { empleado_id: 'e2', dias_laborables: [1, 2, 3, 4, 5], fecha_ingreso: '2026-11-23' },
    ]
    const mapa = avanceSemanaPorEmpleado([
      { empleado_id: 'e1', fecha: '2026-11-20', es_ausencia: true, ausencia_justificada: false },
      { empleado_id: 'e1', fecha: '2026-11-22', es_domingo: true, hora_entrada: '08:00', hora_salida: '12:00' },
    ], {
      empleados,
      desde: '2026-11-19', // jue 19 → mié 25 nov
      hasta: '2026-11-25',
      feriados: [{ fecha: '2026-11-19', laborable: false }],
    })
    // e1: jue 19 (feriado no lab.), vie 20 (falta), sáb 21 libre, dom 22 trabajado (descanso), lun 23..mié 25 presentes = 3 trab, 1 desc, 1 falta
    expect(mapa.get('e1')).toEqual({ trabajados: 3, descansoTrabajados: 1, faltas: 1 })
    // e2: ingresó lun 23 -> cuenta lun 23, mar 24 y mié 25 como presentes
    expect(mapa.get('e2')).toEqual({ trabajados: 3, descansoTrabajados: 0, faltas: 0 })
  })
})
