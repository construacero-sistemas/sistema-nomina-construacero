// server/lib/nominaReglasLey.js
// Reglas de la ley laboral que la empresa puede editar en Configuración (por si
// cambia la ley). Única fuente de sus valores por defecto, de su lectura desde
// `configuracion_negocio` (migración 263) y de su validación. La interfaz importa
// este mismo archivo para no duplicar los rangos.
//
// Predeterminados = LOTTT vigente (Gaceta 6.076, 2012):
//   divisorMensual        30            art. 113 (salario diario = mensual ÷ 30)
//   diasLaborablesDefault lunes–viernes art. 173 (5 días, 2 de descanso)
//   descansoRemunerado    sí            art. 119 (descanso y feriados se pagan)
//   faltasPierdeDescanso  2             art. 119 (faltar UN día no quita el descanso; 0 = nunca)

export const REGLAS_LEY_DEFAULT = Object.freeze({
  divisorMensual: 30,
  diasLaborablesDefault: Object.freeze([1, 2, 3, 4, 5]),
  descansoRemunerado: true,
  faltasPierdeDescanso: 2,
})

export const LIMITES_REGLAS_LEY = Object.freeze({
  divisorMensual: Object.freeze({ min: 1, max: 31 }),
  faltasPierdeDescanso: Object.freeze({ min: 0, max: 7 }),
  // 1 = lunes … 6 = sábado. El domingo nunca es laborable (art. 184: es feriado).
  diaLaborable: Object.freeze({ min: 1, max: 6 }),
})

/** Columnas de `configuracion_negocio` que guardan estas reglas. */
export const COLUMNAS_REGLAS_LEY = Object.freeze([
  'nomina_divisor_mensual',
  'nomina_dias_laborables_default',
  'nomina_descanso_remunerado',
  'nomina_faltas_pierde_descanso',
])

function diasValidos(dias) {
  if (!Array.isArray(dias)) return null
  const lista = [...new Set(dias.map(Number))]
  if (!lista.length || lista.length > 6) return null
  const { min, max } = LIMITES_REGLAS_LEY.diaLaborable
  if (!lista.every(dia => Number.isInteger(dia) && dia >= min && dia <= max)) return null
  return lista.sort((a, b) => a - b)
}

function enteroEnRango(valor, { min, max }) {
  const n = Number(valor)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

/** Reglas efectivas a partir de una fila de configuración (cualquier campo ausente o inválido → ley vigente). */
export function reglasLeyDeConfig(config = {}) {
  const cfg = config || {}
  return {
    divisorMensual: enteroEnRango(cfg.nomina_divisor_mensual, LIMITES_REGLAS_LEY.divisorMensual) ?? REGLAS_LEY_DEFAULT.divisorMensual,
    diasLaborablesDefault: diasValidos(cfg.nomina_dias_laborables_default) ?? [...REGLAS_LEY_DEFAULT.diasLaborablesDefault],
    descansoRemunerado: typeof cfg.nomina_descanso_remunerado === 'boolean' ? cfg.nomina_descanso_remunerado : REGLAS_LEY_DEFAULT.descansoRemunerado,
    faltasPierdeDescanso: enteroEnRango(cfg.nomina_faltas_pierde_descanso, LIMITES_REGLAS_LEY.faltasPierdeDescanso) ?? REGLAS_LEY_DEFAULT.faltasPierdeDescanso,
  }
}

/**
 * Valida los campos de reglas presentes en `body` (los ausentes no se tocan).
 * @returns {{ fields: object, error: string|null }}
 */
export function validarReglasLey(body = {}) {
  const fields = {}
  if (body.nomina_divisor_mensual !== undefined) {
    const valor = enteroEnRango(body.nomina_divisor_mensual, LIMITES_REGLAS_LEY.divisorMensual)
    if (valor === null) return { fields: {}, error: 'El divisor del sueldo mensual debe ser un número entero entre 1 y 31' }
    fields.nomina_divisor_mensual = valor
  }
  if (body.nomina_dias_laborables_default !== undefined) {
    const dias = diasValidos(body.nomina_dias_laborables_default)
    if (!dias) return { fields: {}, error: 'Los días laborables deben ser entre 1 y 6 días de lunes a sábado' }
    fields.nomina_dias_laborables_default = dias
  }
  if (body.nomina_descanso_remunerado !== undefined) {
    if (typeof body.nomina_descanso_remunerado !== 'boolean') return { fields: {}, error: 'El descanso pagado debe ser sí o no' }
    fields.nomina_descanso_remunerado = body.nomina_descanso_remunerado
  }
  if (body.nomina_faltas_pierde_descanso !== undefined) {
    const valor = enteroEnRango(body.nomina_faltas_pierde_descanso, LIMITES_REGLAS_LEY.faltasPierdeDescanso)
    if (valor === null) return { fields: {}, error: 'Las faltas para perder el descanso deben ser un número entero entre 0 y 7' }
    fields.nomina_faltas_pierde_descanso = valor
  }
  return { fields, error: null }
}
