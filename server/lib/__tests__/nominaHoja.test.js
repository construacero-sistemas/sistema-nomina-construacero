// Hoja semanal (docs/PLAN_HOJA_SEMANAL.md). Los recibos se generan con el MOTOR REAL
// (calcularLineaNomina) y la hoja solo los reparte en las columnas de la planilla.
// Guardarraíl: en cada fila, sueldo semanal + bono + extras + valor descanso + otros
// pagos = total a cobrar del recibo; los totales suman TODAS las filas.
import { describe, expect, it } from 'vitest'
import { calcularLineaNomina } from '../nominaUtils.js'
import { BONO_SEMANAL_USD, armarHojaSemanal, esDescansoTrabajado, repartoSemana, semanasDelPeriodo } from '../nominaHoja.js'

// Semana jueves 05/11 → miércoles 11/11/2026. Sábado 07 y domingo 08 son descanso.
const DESDE = '2026-11-05'
const HASTA = '2026-11-11'
const LAB = [1, 2, 3, 4, 5]
const DIAS = ['2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11']
// Regla del dueño: hora extra $2,50 fija; sábado/domingo/feriado = un día adicional.
const CONFIG = {
  nomina_monto_hora_extra_usd: 2.5, nomina_factor_hora_extra: 2.5,
  nomina_factor_sabado: 1, nomina_factor_feriado: 1, nomina_feriado_modo: 'factor',
}

function dia(fecha, { extra = 0, ausencia = false, feriado = false } = {}) {
  const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay()
  return {
    fecha, es_ausencia: ausencia, es_feriado: feriado, es_sabado: dow === 6, es_domingo: dow === 0,
    hora_entrada: ausencia ? null : '08:00:00', hora_salida: ausencia ? null : '17:00:00',
    horas_normales: ausencia ? 0 : 8, horas_extra: extra, horas_trabajadas: ausencia ? 0 : 8 + extra,
    estado_marcaje: ausencia ? 'manual' : 'completo',
  }
}

function recibo({ id, nombre, mensual, asistencias, bonos = 0, deducciones = 0, feriados = [] }) {
  const linea = calcularLineaNomina(asistencias, { salario_dia_usd: mensual / 30, horas_jornada: 8 }, CONFIG, bonos, deducciones, 0, {
    desde: DESDE, hasta: HASTA, diasLaborables: LAB, feriados, hoy: HASTA, fechaIngreso: null, descansoRemunerado: true, faltasPierde: 2,
  })
  return { linea: { ...linea, id: `l-${id}`, empleado_id: id, empleado: { nombre } }, asistencias: asistencias.map(a => ({ ...a, empleado_id: id })) }
}

function hoja(casos, opciones = {}) {
  return armarHojaSemanal({
    lineas: casos.map(c => c.linea),
    asistencias: casos.flatMap(c => c.asistencias),
    diasPorEmpleado: new Map(casos.map(c => [c.linea.empleado_id, LAB])),
    divisor: 30,
    ...opciones,
  })
}

const cuadra = fila => expect(
  fila.sueldoSemanal + fila.bonoSemanal + fila.totalExtras + fila.valorDescansoTrabajado + fila.otrosPagos,
).toBeCloseTo(fila.totalACobrar, 2)

describe('armarHojaSemanal', () => {
  it('Fralin (280): 5 días, 3 h extra y el sábado trabajado, repartido como la planilla', () => {
    const fralin = recibo({ id: 'e-1', nombre: 'Fralin Lozano', mensual: 280, asistencias: [
      ...DIAS.map((f, i) => dia(f, { extra: i === 0 ? 3 : 0 })), dia('2026-11-07'),
    ] })
    const [fila] = hoja([fralin]).filas
    expect(fila).toMatchObject({ nombre: 'Fralin Lozano', diasTrabajados: 5, diasDescansoTrabajados: 1, horasExtra: 3 })
    expect(fila.sueldoMensual).toBeCloseTo(280, 2)
    expect(fila.semana).toBeCloseTo(65.33, 2) // 280 ÷ 30 × 7
    expect(fila.bonoSemanal).toBe(BONO_SEMANAL_USD)
    expect(fila.sueldoSemanal).toBeCloseTo(30.33, 2)
    expect(fila.totalExtras).toBeCloseTo(7.5, 2) // 3 h × $2,50
    // Un día adicional (9,333…). Absorbe el centavo de redondear la semana para que la
    // fila cuadre exacta con el recibo: 65,33 + 7,50 + 9,34 = 82,17.
    expect(fila.valorDescansoTrabajado).toBe(9.34)
    expect(fila.totalACobrar).toBeCloseTo(82.17, 2)
    cuadra(fila)
  })

  it('desglosa la semana en días trabajados y días de descanso ($240, 5 días: $40 + $16)', () => {
    const caso = recibo({ id: 'e-9', nombre: 'David Garcia', mensual: 240, asistencias: DIAS.map(f => dia(f)) })
    const [fila] = hoja([caso]).filas
    expect(fila.diasTrabajados).toBe(5)
    expect(fila.valorDiasTrabajados).toBeCloseTo(40, 2)
    expect(fila.diasDescansoPagados).toBe(2)
    expect(fila.valorDescansoPagado).toBeCloseTo(16, 2)
    expect(fila.valorDiasTrabajados + fila.valorDescansoPagado).toBeCloseTo(fila.semana, 2)
    cuadra(fila)
  })

  it('el desglose suma exacto la semana aunque el sueldo diario tenga decimales ($160)', () => {
    const caso = recibo({ id: 'e-10', nombre: 'Wuendy Lozano', mensual: 160, asistencias: DIAS.map(f => dia(f)) })
    const [fila] = hoja([caso]).filas
    expect(Math.round((fila.valorDiasTrabajados + fila.valorDescansoPagado) * 100)).toBe(Math.round(fila.semana * 100))
  })

  it('una falta baja el sueldo semanal y el bono sigue en $35', () => {
    const caso = recibo({ id: 'e-2', nombre: 'Juan Orozco', mensual: 240, asistencias: [
      ...DIAS.slice(0, 4).map(f => dia(f)), dia(DIAS[4], { ausencia: true }),
    ] })
    const [fila] = hoja([caso]).filas
    expect(fila.diasTrabajados).toBe(4)
    expect(fila.semana).toBeCloseTo(48, 2) // (4 + 2 descansos) × 8
    expect(fila.bonoSemanal).toBe(35) // siempre $35
    expect(fila.sueldoSemanal).toBeCloseTo(13, 2) // 48 − 35
    cuadra(fila)
  })

  it('si la semana no llega a $35, el bono es la semana y el sueldo queda en 0 (Alejandra, 1 día)', () => {
    const caso = recibo({ id: 'e-6', nombre: 'Alejandra Hidalgo', mensual: 280, asistencias: [dia(DIAS[0])] })
    const [fila] = hoja([caso]).filas
    expect(fila.semana).toBeGreaterThan(0)
    expect(fila.semana).toBeLessThanOrEqual(30.33)
    expect(fila.bonoSemanal).toBeCloseTo(fila.semana, 2)
    expect(fila.sueldoSemanal).toBe(0)
    cuadra(fila)
  })

  it('el feriado y el domingo trabajados cuentan como descanso trabajado', () => {
    const caso = recibo({ id: 'e-3', nombre: 'Omar Freddy Patti', mensual: 340, feriados: [{ fecha: '2026-11-10', laborable: false }], asistencias: [
      ...DIAS.map(f => dia(f, { feriado: f === '2026-11-10' })), dia('2026-11-08'),
    ] })
    const [fila] = hoja([caso]).filas
    expect(fila.diasDescansoTrabajados).toBe(2)
    expect(fila.diasTrabajados).toBe(4)
    cuadra(fila)
  })

  it('otros pagos y descuentos manuales del recibo van en sus columnas', () => {
    const caso = recibo({ id: 'e-4', nombre: 'Lerwis Pinto', mensual: 240, bonos: 5, deducciones: 30, asistencias: DIAS.map(f => dia(f, { extra: f === DIAS[0] ? 1 : 0 })) })
    const [fila] = hoja([caso]).filas
    expect(fila.otrosPagos).toBe(5)
    expect(fila.descuentos).toBe(30)
    expect(fila.neto).toBeCloseTo(fila.totalACobrar - 30, 2)
    cuadra(fila)
  })

  it('si la semana completa no supera el bono (sueldo muy bajo), todo es bono', () => {
    const caso = recibo({ id: 'e-5', nombre: 'Nuevo', mensual: 100, asistencias: [dia(DIAS[0]), ...DIAS.slice(1).map(f => dia(f, { ausencia: true }))] })
    const [fila] = hoja([caso]).filas
    expect(fila.bonoSemanal).toBeCloseTo(fila.semana, 2)
    expect(fila.sueldoSemanal).toBe(0)
    cuadra(fila)
  })

  it('los totales suman TODAS las filas (la planilla dejaba fuera la última)', () => {
    const casos = [
      recibo({ id: 'e-1', nombre: 'Ana', mensual: 280, asistencias: DIAS.map(f => dia(f)) }),
      recibo({ id: 'e-2', nombre: 'Beto', mensual: 240, asistencias: DIAS.map(f => dia(f)) }),
      recibo({ id: 'e-3', nombre: 'Julián Guaina', mensual: 280, asistencias: DIAS.map(f => dia(f)) }),
    ]
    const { filas, totales } = hoja(casos)
    for (const campo of ['sueldoSemanal', 'bonoSemanal', 'totalExtras', 'valorDescansoTrabajado', 'otrosPagos', 'totalACobrar', 'descuentos', 'neto']) {
      expect(totales[campo]).toBeCloseTo(filas.reduce((s, f) => s + f[campo], 0), 2)
    }
    expect(totales.empleados).toBe(3)
  })

  it('ordena por nombre y respeta un bono distinto si se configura', () => {
    const casos = [
      recibo({ id: 'e-2', nombre: 'Zoila', mensual: 240, asistencias: DIAS.map(f => dia(f)) }),
      recibo({ id: 'e-1', nombre: 'Álvaro', mensual: 240, asistencias: DIAS.map(f => dia(f)) }),
    ]
    const { filas } = hoja(casos, { bonoSemanal: 20 })
    expect(filas.map(f => f.nombre)).toEqual(['Álvaro', 'Zoila'])
    expect(filas[0].bonoSemanal).toBe(20)
    filas.forEach(cuadra)
  })
})

describe('esDescansoTrabajado', () => {
  it('solo cuenta días trabajados que son domingo, feriado o fuera de la semana laboral', () => {
    expect(esDescansoTrabajado(dia('2026-11-07'), LAB)).toBe(true) // sábado
    expect(esDescansoTrabajado(dia('2026-11-08'), LAB)).toBe(true) // domingo
    expect(esDescansoTrabajado(dia('2026-11-06'), LAB)).toBe(false) // viernes
    expect(esDescansoTrabajado(dia('2026-11-07'), [1, 2, 3, 4, 5, 6])).toBe(false) // sábado laborable
    expect(esDescansoTrabajado(dia('2026-11-07', { ausencia: true }), LAB)).toBe(false)
    expect(esDescansoTrabajado({ ...dia('2026-11-07'), hora_salida: null, estado_marcaje: 'entrada', horas_normales: 0, horas_trabajadas: 0 }, LAB)).toBe(false)
  })
})

// Regla del usuario (19/11/2026): bono editable, guardado en cada recibo y por semana.
describe('bono semanal guardado y por semana', () => {
  it('semanasDelPeriodo: 7 días = 1, quincena = 2 (o 3 si pasa de 14 días), mínimo 1', () => {
    expect(semanasDelPeriodo('2026-11-05', '2026-11-11')).toBe(1)
    expect(semanasDelPeriodo('2026-11-01', '2026-11-14')).toBe(2)
    expect(semanasDelPeriodo('2026-11-01', '2026-11-15')).toBe(3)
    expect(semanasDelPeriodo('2026-11-05', '2026-11-05')).toBe(1)
    expect(semanasDelPeriodo('x', 'y')).toBe(1)
  })

  it('repartoSemana: una quincena completa lleva dos bonos y el sueldo es lo que queda', () => {
    const linea = { salario_dia_usd_snap: 8, dias_trabajados: 10, dias_descanso: 4 }
    expect(repartoSemana({ linea, bonoSemanal: 35, semanas: 2 })).toMatchObject({ semana: 112, bono: 70, sueldo: 42 })
  })

  it('el bono nunca supera la semana y no se suma (descanso trabajado fuera de la semana)', () => {
    const linea = { salario_dia_usd_snap: 8, dias_trabajados: 3, dias_descanso: 0 }
    expect(repartoSemana({ linea, diasDescansoTrabajados: 1, bonoSemanal: 35 })).toMatchObject({ semana: 16, bono: 16, sueldo: 0 })
  })

  it('la hoja usa el bono guardado en el recibo aunque el bono vigente haya cambiado', () => {
    const caso = recibo({ id: 'e-9', nombre: 'Guardado', mensual: 240, asistencias: DIAS.map(f => dia(f)) })
    caso.linea.bono_semanal_usd = 35
    const [fila] = hoja([caso], { bonoSemanal: 50 }).filas
    expect(fila.bonoSemanal).toBe(35)
    expect(fila.sueldoSemanal).toBeCloseTo(21, 2)
    cuadra(fila)
  })

  it('un recibo sin bono guardado usa el vigente por las semanas del período', () => {
    const caso = recibo({ id: 'e-10', nombre: 'Sin guardar', mensual: 600, asistencias: DIAS.map(f => dia(f)) })
    const [fila] = hoja([caso], { bonoSemanal: 40, semanas: 2 }).filas
    expect(fila.semana).toBeCloseTo(140, 2) // 7 × 20
    expect(fila.bonoSemanal).toBe(80)
    expect(fila.sueldoSemanal).toBeCloseTo(60, 2)
  })
})
