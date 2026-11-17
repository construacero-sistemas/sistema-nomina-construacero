// src/hooks/idempotencia.js
// Clave de idempotencia de una acción del marcaje. Se genera al hacer clic (no
// dentro de la mutación) para que un reintento repita la MISMA petición y el
// servidor la reconozca como ya aplicada (M-3 de PLAN_MARCAJE_BOTONES_UX).
export function makeIdempotencyKey(tipo, empleadoId) {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${tipo}-${empleadoId}-${random}`
}
