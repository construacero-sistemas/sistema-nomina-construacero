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

  // La conversión SIEMPRE usa la tasa elegida en el sistema (tasaActiva: BCV,
  // USDT, Euro o Manual — llega como tasaBcv/tasaUsdt). La tasa guardada en el
  // movimiento es solo respaldo si el sistema no tiene tasa activa.
  const tasaSistema = Number(tasaBcv) >= 2 ? Number(tasaBcv) : 0

  if (moneda === 'VES') {
    const tasa = tasaSistema
      || Number(item?.tasa_usd_ves > 0 ? item.tasa_usd_ves : (item?.tasa_ves > 1 ? item.tasa_ves : 0))
    // Sin tasa real (>= 2 Bs/$) no se puede calcular el contravalor: mostrar '—'
    // en vez de un USD falso (monto/tasa con tasa 1 o 0 daba el monto "en USD").
    if (!(tasa >= 2)) {
      return { label: 'Equivalente USD', shortLabel: 'USD', valor: '—', subtexto: null, montoNum: 0, esUsd: true }
    }
    const equivUsd = monto / tasa
    return {
      label: 'Equivalente USD',
      shortLabel: 'USD',
      valor: `${equivUsd.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`,
      subtexto: `a ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs/$`,
      montoNum: equivUsd,
      esUsd: true,
    }
  }

  if (moneda === 'USDT') {
    const tasa = tasaSistema
      || (Number(tasaUsdt) > 1 ? Number(tasaUsdt) : 0)
      || Number(item?.tasa_ves > 1 ? item.tasa_ves : (item?.tasa_usd_ves > 1 ? item.tasa_usd_ves : 0))
    if (!(tasa >= 2)) {
      return { label: 'Equivalente VES', shortLabel: 'VES', valor: '—', subtexto: null, montoNum: 0, esUsd: false }
    }
    const equivVes = monto * tasa
    return {
      label: 'Equivalente VES',
      shortLabel: 'VES',
      valor: `${equivVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} VES`,
      subtexto: `a ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs/USDT`,
      montoNum: equivVes,
      esUsd: false,
    }
  }

  const tasa = tasaSistema
    || Number(item?.tasa_ves > 1 ? item.tasa_ves : (item?.tasa_usd_ves > 1 ? item.tasa_usd_ves : 0))
  if (!(tasa >= 2)) {
    return { label: 'Equivalente VES', shortLabel: 'VES', valor: '—', subtexto: null, montoNum: 0, esUsd: false }
  }
  const equivVes = monto * tasa
  return {
    label: 'Equivalente VES',
    shortLabel: 'VES',
    valor: `${equivVes.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} VES`,
    subtexto: `a ${tasa.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs/$`,
    montoNum: equivVes,
    esUsd: false,
  }
}
