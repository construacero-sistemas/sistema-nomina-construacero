// compat/components/ui/selectMatching.js
// Funciones puras de búsqueda difusa para CustomSelect (extraídas para reuso/testing).

/** Normaliza texto: quita acentos y pasa a minúsculas */
export function normalizar(str) {
  if (!str) return ''
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Quita todo lo que no sea número o letra (útil para cédulas) */
export function purificar(str) {
  if (!str) return ''
  return str.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

/**
 * Búsqueda inteligente: soporta acentos, inicio de palabra, y typos básicos.
 * @returns {number} puntaje 0-4 (0 = no coincide)
 */
export function matchScore(texto, query) {
  const t = normalizar(texto)
  const q = normalizar(query)
  const qPure = purificar(query)
  const tPure = purificar(texto)

  // 1. Coincidencia exacta o inicio de cédula purificada (Ej: query "123" match "V12.3...")
  if (qPure.length >= 3 && tPure.includes(qPure)) return 4

  // 2. Coincidencia exacta al inicio → máxima prioridad
  if (t.startsWith(q)) return 3

  // 3. Coincidencia al inicio de alguna palabra
  if (t.split(/\s+/).some(w => w.startsWith(q))) return 2

  // 4. Contiene la query
  if (t.includes(q)) return 1

  // 5. Coincidencia por iniciales (ej: "dc" → "Distrito Capital")
  if (q.length >= 2) {
    const iniciales = t.split(/\s+/).map(w => w[0]).join('')
    if (iniciales.includes(q)) return 1
  }
  return 0
}
