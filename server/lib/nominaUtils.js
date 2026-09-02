// api/lib/nominaUtils.js
// Motor de cálculo de nómina: campos de asistencia + línea de liquidación.
// Se usa desde api/handlers/nomina.js para calcular antes de insertar.

/**
 * Calcula los campos derivados de un registro de asistencia.
 * @param {string} fecha - YYYY-MM-DD
 * @param {string|null} horaEntrada - HH:MM
 * @param {string|null} horaSalida  - HH:MM
 * @param {number} horasJornada     - horas normales del día (ej. 8)
 * @param {boolean} esFeriado
 * @param {boolean} esAusencia      - forzado desde UI (sin horas)
 */
export function calcularCamposAsistencia(fecha, horaEntrada, horaSalida, horasJornada, esFeriado = false, esAusencia = false) {
  const dow = new Date(`${fecha}T12:00:00`).getDay() // 0=dom,6=sab
  const esSabado  = dow === 6
  const esDomingo = dow === 0
  const esFeriadoEfectivo = Boolean(esFeriado || esDomingo)

  // Sin horas o marcada como ausencia → 0 horas
  if (esAusencia || !horaEntrada || !horaSalida) {
    return {
      horas_trabajadas: 0,
      horas_normales:   0,
      horas_extra:      0,
      es_sabado:        esSabado,
      es_domingo:       esDomingo,
      es_feriado:       esFeriadoEfectivo,
      es_ausencia:      !esFeriadoEfectivo, // feriado/domingo sin asistencia ≠ ausencia
    }
  }

  // Convertir HH:MM a minutos. La validación vive en el dominio para que
  // ningún handler pueda insertar NaN o aceptar horas fuera de rango.
  const toMin = (t) => {
    if (typeof t !== 'string') {
      throw new RangeError('Hora inválida: use HH:MM')
    }
    const clean = t.trim().slice(0, 5)
    if (!/^\d{2}:\d{2}$/.test(clean)) {
      throw new RangeError('Hora inválida: use HH:MM')
    }
    const [h, m] = clean.split(':').map(Number)
    if (h > 23 || m > 59) throw new RangeError('Hora inválida: fuera de rango')
    return h * 60 + m
  }

  const entMin = toMin(horaEntrada)
  let salMin   = toMin(horaSalida)

  if (salMin === entMin) throw new RangeError('La salida no puede ser igual a la entrada')

  // Si salida < entrada asumir que pasó medianoche (guardia nocturna)
  if (salMin < entMin) salMin += 24 * 60

  const horasTrabajadas = Math.max(0, (salMin - entMin) / 60)
  const jornadaNumero   = Number(horasJornada)
  const jornada         = Number.isFinite(jornadaNumero) ? Math.max(0.01, jornadaNumero) : 8
  const horasNormales   = Math.min(horasTrabajadas, jornada)
  const horasExtra      = Math.max(0, horasTrabajadas - jornada)

  return {
    horas_trabajadas: round4(horasTrabajadas),
    horas_normales:   round4(horasNormales),
    horas_extra:      round4(horasExtra),
    es_sabado:        esSabado,
    es_domingo:       esDomingo,
    es_feriado:       esFeriadoEfectivo,
    es_ausencia:      false,
  }
}

/**
 * Calcula la línea de nómina de un empleado para un período.
 * @param {Array}  asistencias    - registros de registro_asistencia del período
 * @param {object} configEmpleado - fila de nomina_config_empleado
 * @param {object} configNomina   - factores de configuracion_negocio
 * @param {number} bonosUsd       - ajuste manual (puede venir de DB)
 * @param {number} deduccionesUsd - ajuste manual
 */
export function calcularLineaNomina(asistencias, configEmpleado, configNomina, bonosUsd = 0, deduccionesUsd = 0) {
  const salarioNumero = Number(configEmpleado.salario_dia_usd)
  const jornadaNumero = Number(configEmpleado.horas_jornada)
  const salarioDia    = Number.isFinite(salarioNumero) ? Math.max(0, salarioNumero) : 0
  const horasJornada  = Number.isFinite(jornadaNumero) ? Math.max(0.01, jornadaNumero) : 8
  const tarifaHora    = salarioDia / horasJornada

  const factorExtraNumero   = Number(configNomina.nomina_factor_hora_extra)
  const factorSabadoNumero  = Number(configNomina.nomina_factor_sabado)
  const factorFeriadoNumero = Number(configNomina.nomina_factor_feriado)
  const factorExtra   = Number.isFinite(factorExtraNumero) ? Math.max(1, factorExtraNumero) : 1.5
  const factorSabado  = Number.isFinite(factorSabadoNumero) ? Math.max(1, factorSabadoNumero) : 1.25
  const factorFeriado = Number.isFinite(factorFeriadoNumero) ? Math.max(1, factorFeriadoNumero) : 2.0

  // Montos fijos USD (migración 225). Si el monto existe (> 0) manda sobre el
  // factor; si falta, se conserva el cálculo histórico para no pagar 0.
  const montoExtraFijoNumero   = Number(configNomina.nomina_monto_hora_extra_usd)
  const montoSabadoFijoNumero  = Number(configNomina.nomina_monto_sabado_usd)
  const montoFeriadoFijoNumero = Number(configNomina.nomina_monto_feriado_usd)
  const usaExtraFija   = Number.isFinite(montoExtraFijoNumero) && montoExtraFijoNumero > 0
  const usaSabadoFijo  = Number.isFinite(montoSabadoFijoNumero) && montoSabadoFijoNumero > 0
  const modoFeriado    = configNomina.nomina_feriado_modo === 'monto_fijo' ? 'monto_fijo' : 'factor'
  const usaFeriadoFijo = modoFeriado === 'monto_fijo' && Number.isFinite(montoFeriadoFijoNumero) && montoFeriadoFijoNumero > 0

  let diasTrabajados = 0
  let horasNormales  = 0
  let horasExtra     = 0
  let diasSabado     = 0
  let diasSabadoSinFeriado = 0
  let diasFeriado    = 0
  let diasAusencia   = 0

  for (const a of asistencias) {
    const tieneHorasExplicitas = a.horas_trabajadas !== undefined && a.horas_trabajadas !== null
    const horasTrabajadas = tieneHorasExplicitas
      ? Number(a.horas_trabajadas)
      : Number(a.horas_normales || 0) + Number(a.horas_extra || 0)

    if (a.es_ausencia || (tieneHorasExplicitas && (!Number.isFinite(horasTrabajadas) || horasTrabajadas <= 0))) {
      diasAusencia += 1
      continue
    }
    if (a.es_feriado) {
      diasFeriado += 1
      diasTrabajados += 1
    } else {
      diasTrabajados += 1
    }
    if (a.es_sabado) {
      diasSabado += 1
      // Un sábado que también es feriado lo maneja el modo de feriado; evita
      // pagar monto fijo de sábado y recargo de feriado sobre el mismo día.
      if (!a.es_feriado) diasSabadoSinFeriado += 1
    }

    horasNormales += Number(a.horas_normales || 0)
    horasExtra    += Number(a.horas_extra    || 0)
  }

  // Montos. Con monto fijo por hora extra: cada hora extra paga la cifra fija.
  const montoExtra = usaExtraFija
    ? round4(horasExtra * montoExtraFijoNumero)
    : round4(horasExtra * tarifaHora * factorExtra)
  // Sábado fijo: el monto SUSTITUYE el pago del día, así que esos días salen
  // del pago normal. Sin monto fijo: el día suma normal y solo se paga el recargo.
  // Feriado en modo monto fijo sigue la misma convención que el sábado fijo.
  const diasNormales = diasTrabajados
    - (usaSabadoFijo ? diasSabadoSinFeriado : 0)
    - (usaFeriadoFijo ? diasFeriado : 0)
  const montoNormal  = round4(Math.max(0, diasNormales) * salarioDia)
  const montoSabado  = usaSabadoFijo
    ? round4(diasSabadoSinFeriado * montoSabadoFijoNumero)
    : round4(diasSabado  * salarioDia * (factorSabado  - 1))
  const montoFeriado = usaFeriadoFijo
    ? round4(diasFeriado * montoFeriadoFijoNumero)
    : round4(diasFeriado * salarioDia * (factorFeriado - 1))

  const bonos = Number(bonosUsd)
  const deducciones = Number(deduccionesUsd)
  const bonosSeguros = Number.isFinite(bonos) ? Math.max(0, bonos) : 0
  const deduccionesSeguras = Number.isFinite(deducciones) ? Math.max(0, deducciones) : 0
  const totalBruto = round4(montoNormal + montoExtra + montoSabado + montoFeriado + bonosSeguros)
  const totalNeto  = round4(Math.max(0, totalBruto - deduccionesSeguras))

  return {
    cargo_snap:           configEmpleado.cargo || null,
    salario_dia_usd_snap: salarioDia,
    horas_jornada_snap:   horasJornada,
    dias_trabajados:      round1(diasTrabajados),
    horas_normales:       round2(horasNormales),
    horas_extra:          round2(horasExtra),
    dias_sabado:          diasSabado,
    dias_feriado:         diasFeriado,
    dias_ausencia:        diasAusencia,
    monto_normal_usd:     montoNormal,
    monto_extra_usd:      montoExtra,
    monto_sabado_usd:     montoSabado,
    monto_feriado_usd:    montoFeriado,
    bonos_usd:            round4(bonosSeguros),
    deducciones_usd:      round4(deduccionesSeguras),
    total_bruto_usd:      totalBruto,
    total_neto_usd:       totalNeto,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function round4(n) { return Math.round(Number(n) * 10000) / 10000 }
function round2(n) { return Math.round(Number(n) * 100)   / 100   }
function round1(n) { return Math.round(Number(n) * 10)    / 10    }
