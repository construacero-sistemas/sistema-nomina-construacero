// src/components/finanzas/cuentasCompatibles.js
// Identificación inteligente y estricta de cuentas de custodia registradas según el método de pago

export function getCuentasCompatibles(metodo, cuentas) {
  if (!Array.isArray(cuentas) || cuentas.length === 0) return []
  const activas = cuentas.filter(c => c.activo !== false)

  // Criptos / Binance (USDT)
  const esCripto = (c) => {
    const t = String(c.tipo || '').toLowerCase()
    const m = String(c.moneda || '').toUpperCase()
    const b = String(c.banco || '').toLowerCase()
    const n = String(c.nombre || '').toLowerCase()
    const s = String(c.subcuentaId || c.subcuenta_id || '').toLowerCase()
    return t === 'cripto_usdt' || m === 'USDT' || s === 'usdt' || b.includes('binance') || n.includes('binance') || b.includes('usdt') || n.includes('usdt')
  }

  // Dólares digitales / Zelle (NUNCA cuentas cripto)
  const esZelle = (c) => {
    if (esCripto(c)) return false
    const t = String(c.tipo || '').toLowerCase()
    const m = String(c.moneda || '').toUpperCase()
    const b = String(c.banco || '').toLowerCase()
    const n = String(c.nombre || '').toLowerCase()
    const s = String(c.subcuentaId || c.subcuenta_id || '').toLowerCase()
    return t === 'zelle' || s === 'zelle' || b.includes('zelle') || n.includes('zelle') || (m === 'USD' && t !== 'efectivo_usd' && !s.includes('efectivo'))
  }

  // Caja Efectivo Dólares
  const esEfectivoUsd = (c) => {
    const t = String(c.tipo || '').toLowerCase()
    const s = String(c.subcuentaId || c.subcuenta_id || '').toLowerCase()
    return t === 'efectivo_usd' || s === 'efectivo $' || (c.codigo === 'caja-efectivo-usd')
  }

  // Caja Efectivo Bolívares
  const esEfectivoVes = (c) => {
    const t = String(c.tipo || '').toLowerCase()
    const s = String(c.subcuentaId || c.subcuenta_id || '').toLowerCase()
    return t === 'efectivo_ves' || s === 'efectivo bs' || (c.codigo === 'caja-efectivo-bs')
  }

  // Cuentas Bancarias registradas en Bolívares (Transferencia, Pago Móvil, Punto de Venta)
  const esBancoVes = (c) => {
    if (esEfectivoVes(c)) return false
    const t = String(c.tipo || '').toLowerCase()
    const m = String(c.moneda || '').toUpperCase()
    const s = String(c.subcuentaId || c.subcuenta_id || '').toLowerCase()
    return t === 'banco_ves' || s === 'banco en bolívares' || (m === 'VES' && t !== 'efectivo_ves')
  }

  if (metodo === 'USDT') {
    return activas.filter(esCripto)
  }
  if (metodo === 'Zelle') {
    return activas.filter(esZelle)
  }
  if (metodo === 'Efectivo $') {
    return activas.filter(esEfectivoUsd)
  }
  if (metodo === 'Efectivo Bs') {
    return activas.filter(esEfectivoVes)
  }
  if (['Banco en Bolívares', 'Transferencia', 'Pago Móvil', 'Punto de Venta'].includes(metodo)) {
    return activas.filter(esBancoVes)
  }
  return []
}
