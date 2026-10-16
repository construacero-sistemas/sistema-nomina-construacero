const toMicros = value => Math.round(Number(value || 0) * 1_000_000)

export function calcularSaldoCartera(rows = []) {
  const micros = rows
    .filter(row => row.estado === 'activo')
    .reduce((sum, row) => sum + (row.tipo === 'ingreso' ? toMicros(row.monto) : -toMicros(row.monto)), 0)
  return micros / 1_000_000
}

// Devuelve null si alcanza; si no, { disponible, faltante }.
export function evaluarSaldoEgreso(saldo, monto) {
  const faltante = toMicros(monto) - toMicros(saldo)
  if (faltante <= 0) return null
  return { disponible: Number(saldo), faltante: faltante / 1_000_000 }
}

export function mensajeSaldoInsuficiente({ disponible, faltante }, moneda) {
  const fmt = n => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `Saldo insuficiente en la cartera: disponible ${fmt(disponible)} ${moneda}, faltan ${fmt(faltante)} ${moneda}.`
}

export function parseInsufficientFundsDetail(detail) {
  try {
    const body = typeof detail === 'string' ? JSON.parse(detail) : detail
    if (!JSON.stringify(body).includes('FINANCIAL_INSUFFICIENT_FUNDS') && body?.code !== 'PT402') return null
    const hint = typeof body.hint === 'string' ? JSON.parse(body.hint) : body.hint
    const info = hint?.detalle || hint
    const disponible = Number(info?.disponible)
    const faltante = Number(info?.faltante)
    return Number.isFinite(disponible) && Number.isFinite(faltante)
      ? { disponible, faltante, moneda: info.moneda || null }
      : { disponible: null, faltante: null, moneda: null }
  } catch {
    return null
  }
}
