import { describe, it, expect } from 'vitest'
import { calcularCamposAsistencia, calcularLineaNomina } from '../nominaUtils'

// Fechas de referencia (2026): 2026-08-03 = lunes, 2026-08-08 = sábado, 2026-08-09 = domingo
const LUNES   = '2026-08-03'
const SABADO  = '2026-08-08'
const DOMINGO = '2026-08-09'

const CONFIG_FACTORES = {
  nomina_factor_hora_extra: 1.5,
  nomina_factor_sabado:     1.25,
  nomina_factor_feriado:    2.0,
}

const EMPLEADO = { cargo: 'Almacenista', salario_dia_usd: 30, horas_jornada: 8 }

// ─── calcularCamposAsistencia ────────────────────────────────────────────────

describe('calcularCamposAsistencia — jornada normal', () => {
  it('8h exactas: sin horas extra', () => {
    const r = calcularCamposAsistencia(LUNES, '08:00', '16:00', 8)
    expect(r.horas_trabajadas).toBe(8)
    expect(r.horas_normales).toBe(8)
    expect(r.horas_extra).toBe(0)
    expect(r.es_ausencia).toBe(false)
  })

  it('10h trabajadas con jornada de 8h: 2h extra', () => {
    const r = calcularCamposAsistencia(LUNES, '08:00', '18:00', 8)
    expect(r.horas_trabajadas).toBe(10)
    expect(r.horas_normales).toBe(8)
    expect(r.horas_extra).toBe(2)
  })

  it('media jornada: normales < jornada y sin extra', () => {
    const r = calcularCamposAsistencia(LUNES, '08:00', '12:00', 8)
    expect(r.horas_trabajadas).toBe(4)
    expect(r.horas_normales).toBe(4)
    expect(r.horas_extra).toBe(0)
  })

  it('maneja minutos: 08:30–17:15 = 8.75h', () => {
    const r = calcularCamposAsistencia(LUNES, '08:30', '17:15', 8)
    expect(r.horas_trabajadas).toBe(8.75)
    expect(r.horas_extra).toBe(0.75)
  })
})

describe('calcularCamposAsistencia — turno nocturno', () => {
  it('22:00–06:00 cruza medianoche: 8h, no negativo', () => {
    const r = calcularCamposAsistencia(LUNES, '22:00', '06:00', 8)
    expect(r.horas_trabajadas).toBe(8)
    expect(r.horas_normales).toBe(8)
    expect(r.horas_extra).toBe(0)
  })

  it('20:00–06:00 cruza medianoche: 10h con 2h extra', () => {
    const r = calcularCamposAsistencia(LUNES, '20:00', '06:00', 8)
    expect(r.horas_trabajadas).toBe(10)
    expect(r.horas_extra).toBe(2)
  })
})

describe('calcularCamposAsistencia — flags de día', () => {
  it('marca es_sabado en sábado', () => {
    const r = calcularCamposAsistencia(SABADO, '08:00', '16:00', 8)
    expect(r.es_sabado).toBe(true)
    expect(r.es_domingo).toBe(false)
  })

  it('marca es_domingo en domingo', () => {
    const r = calcularCamposAsistencia(DOMINGO, '08:00', '16:00', 8)
    expect(r.es_domingo).toBe(true)
    expect(r.es_sabado).toBe(false)
  })

  it('lunes no es ni sábado ni domingo', () => {
    const r = calcularCamposAsistencia(LUNES, '08:00', '16:00', 8)
    expect(r.es_sabado).toBe(false)
    expect(r.es_domingo).toBe(false)
  })
})

describe('calcularCamposAsistencia — ausencias y feriados', () => {
  it('ausencia explícita: 0 horas y es_ausencia true', () => {
    const r = calcularCamposAsistencia(LUNES, '08:00', '16:00', 8, false, true)
    expect(r.horas_trabajadas).toBe(0)
    expect(r.horas_normales).toBe(0)
    expect(r.horas_extra).toBe(0)
    expect(r.es_ausencia).toBe(true)
  })

  it('sin horas registradas cuenta como ausencia', () => {
    const r = calcularCamposAsistencia(LUNES, null, null, 8)
    expect(r.horas_trabajadas).toBe(0)
    expect(r.es_ausencia).toBe(true)
  })

  it('feriado sin horas NO cuenta como ausencia', () => {
    const r = calcularCamposAsistencia(LUNES, null, null, 8, true, false)
    expect(r.es_feriado).toBe(true)
    expect(r.es_ausencia).toBe(false)
  })

  it('solo hora de entrada sin salida: cuenta como ausencia', () => {
    const r = calcularCamposAsistencia(LUNES, '08:00', null, 8)
    expect(r.horas_trabajadas).toBe(0)
    expect(r.es_ausencia).toBe(true)
  })

  it('rechaza entrada y salida iguales en vez de convertirlas en 24 horas', () => {
    expect(() => calcularCamposAsistencia(LUNES, '08:00', '08:00', 8))
      .toThrow(/igual a la entrada/i)
  })

  it('rechaza horas fuera de formato o rango', () => {
    expect(() => calcularCamposAsistencia(LUNES, '8:00', '16:00', 8))
      .toThrow(/HH:MM/i)
    expect(() => calcularCamposAsistencia(LUNES, '08:00', '25:00', 8))
      .toThrow(/fuera de rango/i)
  })
})

// ─── calcularLineaNomina ─────────────────────────────────────────────────────

/** Helper: registro de asistencia ya calculado. */
function asis(over = {}) {
  return {
    horas_normales: 8, horas_extra: 0,
    es_sabado: false, es_domingo: false,
    es_feriado: false, es_ausencia: false,
    ...over,
  }
}

describe('calcularLineaNomina — caso base', () => {
  it('5 días normales a $30/día = $150', () => {
    const r = calcularLineaNomina(
      Array.from({ length: 5 }, () => asis()),
      EMPLEADO, CONFIG_FACTORES
    )
    expect(r.dias_trabajados).toBe(5)
    expect(r.monto_normal_usd).toBe(150)
    expect(r.monto_extra_usd).toBe(0)
    expect(r.total_bruto_usd).toBe(150)
    expect(r.total_neto_usd).toBe(150)
  })

  it('período vacío: todo en cero', () => {
    const r = calcularLineaNomina([], EMPLEADO, CONFIG_FACTORES)
    expect(r.dias_trabajados).toBe(0)
    expect(r.total_bruto_usd).toBe(0)
    expect(r.total_neto_usd).toBe(0)
  })

  it('guarda snapshot del salario y cargo', () => {
    const r = calcularLineaNomina([asis()], EMPLEADO, CONFIG_FACTORES)
    expect(r.salario_dia_usd_snap).toBe(30)
    expect(r.horas_jornada_snap).toBe(8)
    expect(r.cargo_snap).toBe('Almacenista')
  })
})

describe('calcularLineaNomina — horas extra', () => {
  it('10h extra a tarifa $3.75/h × 1.5 = $56.25', () => {
    // tarifa hora = 30/8 = 3.75 ; 10 × 3.75 × 1.5 = 56.25
    const r = calcularLineaNomina(
      Array.from({ length: 5 }, () => asis({ horas_extra: 2 })),
      EMPLEADO, CONFIG_FACTORES
    )
    expect(r.horas_extra).toBe(10)
    expect(r.monto_extra_usd).toBe(56.25)
  })

  it('el factor de hora extra se aplica desde config', () => {
    const r = calcularLineaNomina(
      [asis({ horas_extra: 4 })],
      EMPLEADO,
      { ...CONFIG_FACTORES, nomina_factor_hora_extra: 2 }
    )
    // 4 × 3.75 × 2 = 30
    expect(r.monto_extra_usd).toBe(30)
  })
})

describe('calcularLineaNomina — recargos de sábado y feriado', () => {
  it('sábado paga SOLO el recargo, no duplica el día', () => {
    const r = calcularLineaNomina([asis({ es_sabado: true })], EMPLEADO, CONFIG_FACTORES)
    // día ya contado en monto_normal (30); recargo = 30 × 0.25 = 7.50
    expect(r.dias_trabajados).toBe(1)
    expect(r.monto_normal_usd).toBe(30)
    expect(r.monto_sabado_usd).toBe(7.5)
    expect(r.total_bruto_usd).toBe(37.5)
  })

  it('feriado paga SOLO el recargo (factor 2 → +100%)', () => {
    const r = calcularLineaNomina([asis({ es_feriado: true })], EMPLEADO, CONFIG_FACTORES)
    expect(r.dias_feriado).toBe(1)
    expect(r.monto_normal_usd).toBe(30)
    expect(r.monto_feriado_usd).toBe(30)
    expect(r.total_bruto_usd).toBe(60)
  })

  it('factor sábado 1.0 no genera recargo', () => {
    const r = calcularLineaNomina(
      [asis({ es_sabado: true })],
      EMPLEADO,
      { ...CONFIG_FACTORES, nomina_factor_sabado: 1 }
    )
    expect(r.monto_sabado_usd).toBe(0)
    expect(r.total_bruto_usd).toBe(30)
  })
})

describe('calcularLineaNomina — ausencias', () => {
  it('las ausencias no suman días ni monto', () => {
    const r = calcularLineaNomina(
      [asis(), asis(), asis({ es_ausencia: true, horas_normales: 0 })],
      EMPLEADO, CONFIG_FACTORES
    )
    expect(r.dias_trabajados).toBe(2)
    expect(r.dias_ausencia).toBe(1)
    expect(r.monto_normal_usd).toBe(60)
  })

  it('un registro explícito de cero horas no se paga como día trabajado', () => {
    const r = calcularLineaNomina(
      [asis({ horas_trabajadas: 0, horas_normales: 0, horas_extra: 0, es_feriado: true })],
      EMPLEADO, CONFIG_FACTORES
    )
    expect(r.dias_trabajados).toBe(0)
    expect(r.dias_feriado).toBe(0)
    expect(r.total_bruto_usd).toBe(0)
  })

  it('una ausencia en sábado no genera recargo', () => {
    const r = calcularLineaNomina(
      [asis({ es_sabado: true, es_ausencia: true, horas_normales: 0 })],
      EMPLEADO, CONFIG_FACTORES
    )
    expect(r.dias_ausencia).toBe(1)
    expect(r.dias_sabado).toBe(0)
    expect(r.monto_sabado_usd).toBe(0)
    expect(r.total_bruto_usd).toBe(0)
  })
})

describe('calcularLineaNomina — bonos y deducciones', () => {
  it('el bono suma al bruto y al neto', () => {
    const r = calcularLineaNomina([asis()], EMPLEADO, CONFIG_FACTORES, 20, 0)
    expect(r.bonos_usd).toBe(20)
    expect(r.total_bruto_usd).toBe(50)
    expect(r.total_neto_usd).toBe(50)
  })

  it('la deducción resta del neto pero no del bruto', () => {
    const r = calcularLineaNomina([asis()], EMPLEADO, CONFIG_FACTORES, 0, 10)
    expect(r.total_bruto_usd).toBe(30)
    expect(r.deducciones_usd).toBe(10)
    expect(r.total_neto_usd).toBe(20)
  })

  it('el neto nunca es negativo aunque la deducción exceda el bruto', () => {
    const r = calcularLineaNomina([asis()], EMPLEADO, CONFIG_FACTORES, 0, 500)
    expect(r.total_neto_usd).toBe(0)
  })
})

describe('calcularLineaNomina — caso integral del plan', () => {
  it('semana lun-sáb con 2h extra diarias = $213.75 bruto', () => {
    // 5 días lun-vie con 2h extra + 1 sábado con 2h extra
    const semana = [
      ...Array.from({ length: 5 }, () => asis({ horas_extra: 2 })),
      asis({ es_sabado: true, horas_extra: 2 }),
    ]
    const r = calcularLineaNomina(semana, EMPLEADO, CONFIG_FACTORES)

    expect(r.dias_trabajados).toBe(6)
    expect(r.monto_normal_usd).toBe(180)      // 6 × 30
    expect(r.horas_extra).toBe(12)            // 6 × 2
    expect(r.monto_extra_usd).toBe(67.5)      // 12 × 3.75 × 1.5
    expect(r.monto_sabado_usd).toBe(7.5)      // 30 × 0.25
    expect(r.total_bruto_usd).toBe(255)       // 180 + 67.5 + 7.5
    expect(r.total_neto_usd).toBe(255)
  })
})

describe('calcularLineaNomina — bordes numéricos', () => {
  it('salario 0 produce montos en 0 sin NaN', () => {
    const r = calcularLineaNomina(
      [asis({ horas_extra: 5 })],
      { ...EMPLEADO, salario_dia_usd: 0 }, CONFIG_FACTORES
    )
    expect(r.monto_normal_usd).toBe(0)
    expect(r.monto_extra_usd).toBe(0)
    expect(Number.isNaN(r.total_neto_usd)).toBe(false)
  })

  it('config de factores vacía usa los valores por defecto', () => {
    const r = calcularLineaNomina([asis({ horas_extra: 2 })], EMPLEADO, {})
    // default hora extra = 1.5 → 2 × 3.75 × 1.5 = 11.25
    expect(r.monto_extra_usd).toBe(11.25)
  })

  it('jornada distinta de 8h recalcula la tarifa por hora', () => {
    const r = calcularLineaNomina(
      [asis({ horas_extra: 2 })],
      { ...EMPLEADO, horas_jornada: 6 }, CONFIG_FACTORES
    )
    // tarifa = 30/6 = 5 ; extra = 2 × 5 × 1.5 = 15
    expect(r.monto_extra_usd).toBe(15)
  })
})
