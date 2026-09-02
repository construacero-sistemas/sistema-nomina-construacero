// server/lib/carterasHelper.js
// Utilidad para clasificar movimientos financieros en Carteras y Subcuentas Reales de Construacero
// Modelo de Custodia Financiera: Caja Física vs. Cuentas Bancarias

/**
 * Determina la subcuenta y cartera exacta de un movimiento financiero.
 * @param {object} mov - Objeto de movimiento de finanzas
 * @returns {{ carteraId: 'USD'|'VES', subcuentaId: string, subcuentaNombre: string }}
 */
export function clasificarMovimientoEnCartera(mov = {}) {
  const moneda = String(mov.moneda || 'USD').toUpperCase()
  const metodo = String(mov.metodo_pago || '').toLowerCase()
  const ref = String(mov.referencia || '').toLowerCase()
  const concepto = String(mov.concepto || '').toLowerCase()

  // 0) Si el movimiento trae método de pago guardado explícitamente (migración 226),
  //    se usa ese dato en lugar de inferirlo por texto. Es la fuente de verdad.
  if (mov.metodo_pago) {
    if (/efectivo\s*bs|efectivo en bolívares/.test(metodo)) {
      return { carteraId: 'VES', subcuentaId: 'Efectivo Bs', subcuentaNombre: 'Efectivo en Bolívares (Bs)' }
    }
    if (moneda === 'VES') {
      return { carteraId: 'VES', subcuentaId: 'Banco en Bolívares', subcuentaNombre: 'Banco en Bolívares (Bs)' }
    }
    if (moneda === 'USDT' || /usdt|binance/.test(metodo)) {
      return { carteraId: 'USD', subcuentaId: 'USDT', subcuentaNombre: 'USDT (Binance / Cripto)' }
    }
    if (/zelle/.test(metodo)) {
      return { carteraId: 'USD', subcuentaId: 'Zelle', subcuentaNombre: 'Zelle (USD)' }
    }
    if (/efectivo|dólar|dolar|^\$/.test(metodo)) {
      return { carteraId: 'USD', subcuentaId: 'Efectivo $', subcuentaNombre: 'Efectivo en Dólares ($)' }
    }
  }

  // 1. CARTERA EN BOLÍVARES (VES)
  if (moneda === 'VES') {
    // Si la referencia o concepto es específicamente efectivo físico
    if (ref.includes('efectivo') || (!ref && concepto.includes('efectivo bs'))) {
      return { carteraId: 'VES', subcuentaId: 'Efectivo Bs', subcuentaNombre: 'Efectivo en Bolívares (Bs)' }
    }

    // Todos los canales bancarios (Punto de Venta, Pago Móvil, Transferencias, Banco) consolidan en Banco en Bolívares
    return { carteraId: 'VES', subcuentaId: 'Banco en Bolívares', subcuentaNombre: 'Banco en Bolívares (Bs)' }
  }

  // 2. CARTERA EN DÓLARES (USD / USDT / EUR)
  if (moneda === 'USDT' || ref.includes('usdt')) {
    return { carteraId: 'USD', subcuentaId: 'USDT', subcuentaNombre: 'USDT (Binance / Cripto)' }
  }
  if (ref.includes('zelle')) {
    return { carteraId: 'USD', subcuentaId: 'Zelle', subcuentaNombre: 'Zelle (USD)' }
  }
  if (ref.includes('efectivo') || ref.includes('dolar') || ref.includes('dólar') || ref.includes('$')) {
    return { carteraId: 'USD', subcuentaId: 'Efectivo $', subcuentaNombre: 'Efectivo en Dólares ($)' }
  }

  // Fallbacks secundarios
  if (!concepto.includes('traspaso') && !concepto.includes('transferencia entre')) {
    if (concepto.includes('usdt')) {
      return { carteraId: 'USD', subcuentaId: 'USDT', subcuentaNombre: 'USDT (Binance / Cripto)' }
    }
    if (concepto.includes('zelle')) {
      return { carteraId: 'USD', subcuentaId: 'Zelle', subcuentaNombre: 'Zelle (USD)' }
    }
  }

  return { carteraId: 'USD', subcuentaId: 'Efectivo $', subcuentaNombre: 'Efectivo en Dólares ($)' }
}

/**
 * Calcula los saldos consolidados por Cartera y por Cuentas Reales de Custodia.
 * @param {Array} movimientos - Lista de movimientos
 * @param {number} tasaBcv - Tasa oficial de cambio actual
 */
export function calcularSaldosCarteras(movimientos = [], tasaBcv = 1) {
  const tasa = Number(tasaBcv) > 0 ? Number(tasaBcv) : 1

  const carterasMap = {
    USD: {
      id: 'USD',
      nombre: 'Cartera en Dólares',
      simbolo: '$',
      totalUsd: 0,
      totalEquivVes: 0,
      ingresosUsd: 0,
      egresosUsd: 0,
      subcuentas: {
        'Efectivo $': { id: 'Efectivo $', nombre: 'Efectivo en Dólares ($)', saldo: 0, ingresos: 0, egresos: 0, moneda: 'USD' },
        Zelle:        { id: 'Zelle',       nombre: 'Zelle (USD)',             saldo: 0, ingresos: 0, egresos: 0, moneda: 'USD' },
        USDT:         { id: 'USDT',        nombre: 'USDT (Binance / Cripto)',  saldo: 0, ingresos: 0, egresos: 0, moneda: 'USDT' },
      },
    },
    VES: {
      id: 'VES',
      nombre: 'Cartera en Bolívares',
      simbolo: 'Bs.',
      totalVes: 0,
      totalEquivUsd: 0,
      ingresosVes: 0,
      egresosVes: 0,
      subcuentas: {
        'Efectivo Bs':          { id: 'Efectivo Bs',          nombre: 'Efectivo en Bolívares (Bs)',  saldo: 0, ingresos: 0, egresos: 0, moneda: 'VES' },
        'Banco en Bolívares':   { id: 'Banco en Bolívares',   nombre: 'Banco en Bolívares (Bs)',     saldo: 0, ingresos: 0, egresos: 0, moneda: 'VES' },
      },
    },
  }

  for (const mov of movimientos) {
    if (mov.estado === 'anulado') continue

    const { carteraId, subcuentaId } = clasificarMovimientoEnCartera(mov)
    const monto = Number(mov.monto) || 0
    const montoVes = mov.moneda === 'VES'
      ? (Number(mov.monto_ves) || monto)
      : (Number(mov.monto_ves) || (monto * (Number(mov.tasa_ves) || tasa)))
    const montoUsd = mov.moneda === 'VES' ? (montoVes / tasa) : monto
    const esIngreso = mov.tipo === 'ingreso'

    const cartera = carterasMap[carteraId]
    if (!cartera) continue

    const sub = cartera.subcuentas[subcuentaId] || (cartera.subcuentas[subcuentaId] = {
      id: subcuentaId,
      nombre: subcuentaId,
      saldo: 0,
      ingresos: 0,
      egresos: 0,
      moneda: cartera.monedaBase,
    })

    if (carteraId === 'USD') {
      if (esIngreso) {
        cartera.ingresosUsd += montoUsd
        sub.ingresos += monto
        sub.saldo += monto
      } else {
        cartera.egresosUsd += montoUsd
        sub.egresos += monto
        sub.saldo -= monto
      }
    } else {
      // Cartera VES
      if (esIngreso) {
        cartera.ingresosVes += montoVes
        sub.ingresos += montoVes
        sub.saldo += montoVes
      } else {
        cartera.egresosVes += montoVes
        sub.egresos += montoVes
        sub.saldo -= montoVes
      }
    }
  }

  // Totales netos y equivalencias
  carterasMap.USD.totalUsd = Number((carterasMap.USD.ingresosUsd - carterasMap.USD.egresosUsd).toFixed(2))
  carterasMap.USD.totalEquivVes = Number((carterasMap.USD.totalUsd * tasa).toFixed(2))

  carterasMap.VES.totalVes = Number((carterasMap.VES.ingresosVes - carterasMap.VES.egresosVes).toFixed(2))
  carterasMap.VES.totalEquivUsd = Number((carterasMap.VES.totalVes / tasa).toFixed(2))

  // Redondear saldos de subcuentas
  for (const sub of Object.values(carterasMap.USD.subcuentas)) {
    sub.saldo = Number(sub.saldo.toFixed(2))
    sub.ingresos = Number(sub.ingresos.toFixed(2))
    sub.egresos = Number(sub.egresos.toFixed(2))
  }
  for (const sub of Object.values(carterasMap.VES.subcuentas)) {
    sub.saldo = Number(sub.saldo.toFixed(2))
    sub.ingresos = Number(sub.ingresos.toFixed(2))
    sub.egresos = Number(sub.egresos.toFixed(2))
  }

  return {
    usd: carterasMap.USD,
    ves: carterasMap.VES,
    patrimonioTotalUsd: Number((carterasMap.USD.totalUsd + carterasMap.VES.totalEquivUsd).toFixed(2)),
  }
}

/**
 * Asigna un movimiento a UNA cuenta de custodia concreta usando la cuenta
 * explícita (cuenta_origen / cuentaOrigen) como fuente de verdad.
 *
 * Regla de negocio:
 *  - Si el movimiento trae `cuenta_origen` (el usuario eligió una cuenta), se
 *    busca por coincidencia EXACTA de id o nombre (ignora subcuentaId compartida)
 *    y se asigna a esa única cuenta. Evita el doble conteo (ej. BNC y Mercantil
 *    comparten subcuentaId 'Banco en Bolívares').
 *  - Si NO trae cuenta explícita, se deja sin asignar (vive solo en la subcuenta
 *    lógica). El dinero nunca se pierde porque la subcuenta sí lo contabiliza.
 *
 * @param {object} mov - Objeto de movimiento
 * @param {Array<object>} cuentas - Cuentas de custodia registradas
 * @returns {object|null} La cuenta asignada, o null si queda sin cuenta explícita.
 */
export function asignarMovimientoACuenta(mov = {}, cuentas = []) {
  if (!Array.isArray(cuentas) || cuentas.length === 0) return null

  const cuentaOrigen = String(mov.cuenta_origen || mov.cuentaOrigen || '').trim()
  if (!cuentaOrigen) return null

  const norm = String(cuentaOrigen).toLowerCase()
  const match = cuentas.find(c => {
    const id = String(c.id || '').toLowerCase()
    const nombre = String(c.nombre || '').toLowerCase()
    const banco = String(c.banco || '').toLowerCase()
    return id === norm || nombre === norm || banco === norm ||
      (c.nombre || '').toLowerCase().includes(norm) ||
      (c.banco || '').toLowerCase().includes(norm)
  })

  return match || null
}

/**
 * Cuenta cuántos movimientos del período quedan SIN cuenta de custodia explícita.
 * Sirve como indicador auditable de "por clasificar".
 * @param {Array<object>} movimientos - Lista de movimientos
 * @param {Array<object>} cuentas - Cuentas de custodia registradas
 * @returns {{ total: number, sinCuenta: number }}
 */
export function contarMovimientosSinCuenta(movimientos = [], cuentas = []) {
  let sinCuenta = 0
  const total = Array.isArray(movimientos) ? movimientos.filter(m => m.estado !== 'anulado').length : 0
  for (const mov of movimientos || []) {
    if (mov.estado === 'anulado') continue
    if (!asignarMovimientoACuenta(mov, cuentas)) sinCuenta += 1
  }
  return { total, sinCuenta }
}
