import { historicalUsd, historicalVes } from '../../utils/financialValuation.js'
export { normalizarMontoInput } from '../../utils/montoUtils.js'

export function formatNumber(value) {
  return Number(value || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function formatUsd(value) { return `$${formatNumber(value)}` }
export function fechaCorta(f) {
  if (!f) return '\u2014'
  const d = new Date(`${f}T12:00:00`)
  return Number.isNaN(d.getTime()) ? String(f) : d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
// History uses saved valuation. A reference rate never rewrites a past entry.
export function calcularEquivalente(item = {}) {
  const esUsd = item.moneda !== 'USD'
  const amount = esUsd ? historicalUsd(item) : historicalVes(item)
  const shortLabel = esUsd ? 'USD' : 'VES'
  return { label: `Equivalente ${shortLabel}`, shortLabel, esUsd, montoNum: amount,
    valor: amount == null ? 'Sin tasa confirmada' : `${formatNumber(amount)} ${shortLabel}`,
    subtexto: amount == null ? null : 'Valoraci\u00f3n con tasas guardadas',
  }
}
