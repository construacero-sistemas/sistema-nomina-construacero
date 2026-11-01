// src/services/pdf/cierreNombre.js
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

// «2026-10-01» → «Octubre 2026»
export function nombreMesCierre(mes) {
  const [anio, numero] = String(mes || '').split('-')
  return MESES[Number(numero) - 1] ? `${MESES[Number(numero) - 1]} ${anio}` : String(mes || '—')
}
