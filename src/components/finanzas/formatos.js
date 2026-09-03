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

export function calcularEquivalente(item, tasaBcv = 0, tasaUsdt = 0) {
  const moneda = (item?.moneda || 'USD').toUpperCase()
  const monto = Number(item?.monto || 0)

  if (moneda === 'VES') {
    const tasa = Number(item?.tasa_usd_ves > 0 ? item.tasa_usd_ves : (item?.tasa_ves > 1 ? item.tasa_ves : tasaBcv)) || 1
    const equivUsd = tasa > 0 ? monto / tasa : 0
    return {
      label: 'Equivalente USD',
      shortLabel: 'USD',
      valor: `${equivUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`,
      subtexto: tasa > 1 ? `a ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs/$` : null,
      montoNum: equivUsd,
      esUsd: true,
    }
  }

  if (moneda === 'USDT') {
    const tasa = Number(item?.tasa_ves > 1 ? item.tasa_ves : (item?.tasa_usd_ves > 1 ? item.tasa_usd_ves : (tasaUsdt > 1 ? tasaUsdt : tasaBcv))) || 1
    const equivVes = Number(item?.monto_ves > 0 ? item.monto_ves : (monto * tasa))
    return {
      label: 'Equivalente VES',
      shortLabel: 'VES',
      valor: `${equivVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} VES`,
      subtexto: tasa > 1 ? `a ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs/USDT` : null,
      montoNum: equivVes,
      esUsd: false,
    }
  }

  const tasa = Number(item?.tasa_ves > 1 ? item.tasa_ves : (item?.tasa_usd_ves > 1 ? item.tasa_usd_ves : tasaBcv)) || 1
  const equivVes = Number(item?.monto_ves > 0 ? item.monto_ves : (monto * tasa))
  return {
    label: 'Equivalente VES',
    shortLabel: 'VES',
    valor: `${equivVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} VES`,
    subtexto: tasa > 1 ? `a ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs/$` : null,
    montoNum: equivVes,
    esUsd: false,
  }
}
