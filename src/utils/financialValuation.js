// El importe nativo no necesita conversión. Una tasa positiva heredada no
// acredita su procedencia: sólo usar snapshots registrados por la base.
function recordedRate(row) {
  return typeof row.tasa_registrada_en === 'string' && Number.isFinite(Date.parse(row.tasa_registrada_en))
}
function amount(value) {
  return value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null
}
export function historicalVes(row) {
  if (row.moneda === 'VES') return amount(row.monto)
  if (!recordedRate(row)) return null
  const native = amount(row.monto), rate = Number(row.tasa_ves)
  if (native == null || !Number.isFinite(rate) || rate <= 0) return null
  return amount(row.monto_ves) ?? native * rate
}
export function historicalUsd(row) {
  if (row.moneda === 'USD') return amount(row.monto)
  if (!recordedRate(row)) return null
  const ves = historicalVes(row), rate = Number(row.tasa_usd_ves)
  return ves != null && Number.isFinite(rate) && rate > 0 ? ves / rate : null
}
