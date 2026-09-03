// src/components/finanzas/formatos.js
// Formateadores compartidos del módulo de finanzas (número, USD, fecha corta).

export function formatNumber(value) {
  return Number(value || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatUsd(value) {
  return `$${formatNumber(value)}`
}

export function fechaCorta(f) {
  if (!f) return '—'
  const d = new Date(`${f}T12:00:00`)
  return Number.isNaN(d.getTime()) ? String(f) : d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
