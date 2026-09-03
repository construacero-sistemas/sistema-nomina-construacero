// src/components/finanzas/cuentasCompatibles.js
// Identificación de cuentas de custodia compatibles según el método de pago seleccionado

export function getCuentasCompatibles(metodo, cuentas) {
  if (!Array.isArray(cuentas) || cuentas.length === 0) return []
  const activas = cuentas.filter(c => c.activo !== false)

  if (metodo === 'USDT') {
    return activas.filter(c => c.tipo === 'cripto_usdt' || c.moneda === 'USDT' || c.subcuentaId === 'USDT')
  }
  if (metodo === 'Zelle') {
    return activas.filter(c => c.tipo === 'zelle' || c.subcuentaId === 'Zelle')
  }
  if (metodo === 'Efectivo $') {
    return activas.filter(c => c.tipo === 'efectivo_usd' || c.subcuentaId === 'Efectivo $')
  }
  if (metodo === 'Efectivo Bs') {
    return activas.filter(c => c.tipo === 'efectivo_ves' || c.subcuentaId === 'Efectivo Bs')
  }
  if (['Banco en Bolívares', 'Transferencia', 'Pago Móvil', 'Punto de Venta'].includes(metodo)) {
    return activas.filter(c => c.subcuentaId === 'Banco en Bolívares' || c.tipo === 'banco_ves' || (c.moneda === 'VES' && c.tipo !== 'efectivo_ves'))
  }
  return []
}
