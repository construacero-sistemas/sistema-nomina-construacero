// server/lib/nominaSemana.js
// Semana de nómina y modo de creación de períodos (migración 264). Única fuente
// de los valores por defecto, la lectura desde `configuracion_negocio` y la
// validación. La interfaz importa este mismo archivo para calcular igual las fechas.
//
//   nomina_periodo_modo    'automatico' (por defecto) | 'manual'
//   nomina_semana_inicio   día en que arranca la semana: 0 = domingo … 6 = sábado.
//                          Por defecto 4 = jueves (semana jueves → miércoles, como
//                          la planilla de la contadora).

export const MODOS_PERIODO = Object.freeze(['automatico', 'manual'])

export const SEMANA_DEFAULT = Object.freeze({ modo: 'automatico', inicio: 4 })

export const COLUMNAS_SEMANA = Object.freeze(['nomina_periodo_modo', 'nomina_semana_inicio'])

export const DIAS_SEMANA = Object.freeze(['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'])

function inicioValido(valor) {
  const n = Number(valor)
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : null
}

/** Lee el modo y el día de inicio desde la fila de configuración (con respaldo a los predeterminados). */
export function semanaDeConfig(config = {}) {
  const modo = MODOS_PERIODO.includes(config?.nomina_periodo_modo) ? config.nomina_periodo_modo : SEMANA_DEFAULT.modo
  const inicio = inicioValido(config?.nomina_semana_inicio) ?? SEMANA_DEFAULT.inicio
  return { modo, inicio }
}

/** Valida lo que llega a POST /api/config. Devuelve `{ fields }` o `{ error }`. */
export function validarSemana(body = {}) {
  const fields = {}
  if (body.nomina_periodo_modo !== undefined) {
    if (!MODOS_PERIODO.includes(body.nomina_periodo_modo)) return { error: 'nomina_periodo_modo inválido (automatico o manual)' }
    fields.nomina_periodo_modo = body.nomina_periodo_modo
  }
  if (body.nomina_semana_inicio !== undefined) {
    const inicio = inicioValido(body.nomina_semana_inicio)
    if (inicio == null) return { error: 'nomina_semana_inicio inválido (0 = domingo … 6 = sábado)' }
    fields.nomina_semana_inicio = inicio
  }
  return { fields }
}

function aFecha(iso) {
  return new Date(`${iso}T12:00:00Z`)
}

function aIso(fecha) {
  return fecha.toISOString().slice(0, 10)
}

/** Semana de 7 días que contiene `fechaIso` y arranca en el día `inicio`. */
export function rangoSemana(fechaIso, inicio = SEMANA_DEFAULT.inicio) {
  const fecha = aFecha(fechaIso)
  const retroceso = (fecha.getUTCDay() - inicio + 7) % 7
  const desde = new Date(fecha)
  desde.setUTCDate(fecha.getUTCDate() - retroceso)
  const hasta = new Date(desde)
  hasta.setUTCDate(desde.getUTCDate() + 6)
  return { desde: aIso(desde), hasta: aIso(hasta) }
}

/** Corre un rango semanal `semanas` semanas (negativo = hacia atrás). */
export function moverSemana({ desde }, semanas, inicio = SEMANA_DEFAULT.inicio) {
  const fecha = aFecha(desde)
  fecha.setUTCDate(fecha.getUTCDate() + semanas * 7)
  return rangoSemana(aIso(fecha), inicio)
}

/** «Semana 05 nov – 11 nov 2026». */
export function nombreSemana(desde, hasta) {
  const fmt = iso => aFecha(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', timeZone: 'UTC' })
  return `Semana ${fmt(desde)} – ${fmt(hasta)} ${hasta.slice(0, 4)}`
}
