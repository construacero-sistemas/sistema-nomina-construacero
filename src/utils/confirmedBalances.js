// Presentación del saldo confirmado. El historial y sus filtros no participan.
const numeric = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value))
const isValued = account => account.valoracionCompleta === true && numeric(account.valorUsd)
export function summarizeConfirmedBalances(snapshot, referenceRate = 0) {
  if (!snapshot || snapshot.conciliacionPendiente !== false || !Array.isArray(snapshot.cuentas)) return null
  const accounts = snapshot.cuentas
  // Un campo ausente no es un saldo cero, tampoco en la tarjeta consolidada.
  if (!accounts.every(c => c && numeric(c.saldoNativo))) return null
  const dollar = accounts.filter(c => ['USD', 'USDT'].includes(c.moneda))
  const bolivar = accounts.filter(c => c.moneda === 'VES')
  const valued = accounts.every(isValued)
  const totalUsd = dollar.every(isValued) ? dollar.reduce((s, c) => s + Number(c.valorUsd), 0) : null
  const totalVes = bolivar.reduce((s, c) => s + Number(c.saldoNativo), 0)
  const rate = numeric(referenceRate) && Number(referenceRate) > 0 ? Number(referenceRate) : null
  return {
    corte: snapshot.corte,
    versionLibro: snapshot.versionLibro,
    usd: { totalUsd, totalEquivVes: totalUsd !== null && rate !== null ? totalUsd * rate : null },
    ves: { totalVes, totalEquivUsd: rate !== null ? totalVes / rate : null },
    patrimonioTotalUsd: valued ? accounts.reduce((s, c) => s + Number(c.valorUsd), 0) : null,
    valoracionCompleta: valued,
    valoracionBase: 'Tasas guardadas en el libro',
  }
}
