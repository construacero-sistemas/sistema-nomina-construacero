// server/lib/nominaPuestos.js
// Puestos de trabajo personalizados de la cuenta (migración 265,
// `configuracion_negocio.nomina_puestos`). Los usa la ficha del empleado como
// botones de «Cargo u ocupación». Misma regla en el Worker y en la pantalla.

export const COLUMNA_PUESTOS = 'nomina_puestos'
export const MAX_PUESTOS = 50
export const MAX_LARGO_PUESTO = 60

const clave = texto => String(texto).toLocaleLowerCase('es')

/** «  pintor   de estructuras » → «Pintor de estructuras». */
export function normalizarPuesto(texto) {
  const limpio = String(texto ?? '').trim().replace(/\s+/g, ' ')
  return limpio ? limpio.charAt(0).toLocaleUpperCase('es') + limpio.slice(1) : ''
}

/** Une listas de puestos sin repetir (sin distinguir mayúsculas), en orden. */
export function unirPuestos(...listas) {
  const vistos = new Set()
  const resultado = []
  for (const puesto of listas.flat()) {
    const nombre = normalizarPuesto(puesto)
    if (!nombre || vistos.has(clave(nombre))) continue
    vistos.add(clave(nombre))
    resultado.push(nombre)
  }
  return resultado
}

/**
 * Valida `nomina_puestos` del cuerpo de PATCH /api/config.
 * @returns {{ fields: object, error?: string }}
 */
export function validarPuestos(body = {}) {
  if (!Object.prototype.hasOwnProperty.call(body, COLUMNA_PUESTOS)) return { fields: {} }
  const lista = body[COLUMNA_PUESTOS]
  if (!Array.isArray(lista)) return { fields: {}, error: 'nomina_puestos debe ser una lista' }
  if (lista.some(p => typeof p !== 'string')) return { fields: {}, error: 'Cada puesto debe ser un texto' }
  if (lista.some(p => normalizarPuesto(p).length > MAX_LARGO_PUESTO)) {
    return { fields: {}, error: `Cada puesto admite hasta ${MAX_LARGO_PUESTO} caracteres` }
  }
  const puestos = unirPuestos(lista)
  if (puestos.length > MAX_PUESTOS) return { fields: {}, error: `Máximo ${MAX_PUESTOS} puestos personalizados` }
  return { fields: { [COLUMNA_PUESTOS]: puestos } }
}
