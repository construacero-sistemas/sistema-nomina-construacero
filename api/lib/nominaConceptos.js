const TIPOS = new Set(['ingreso', 'deduccion', 'aporte_patronal', 'retencion'])
const MONEDAS = new Set(['VES', 'USD', 'EUR', 'USDT'])

export function normalizarConcepto(input = {}) {
  const codigo = String(input.codigo || '').trim().toUpperCase()
  const nombre = String(input.nombre || '').trim()
  const tipo = String(input.tipo || '')
  const moneda = String(input.monedaDefault || input.moneda_default || 'VES').toUpperCase()
  if (!/^[A-Z0-9_]{2,40}$/.test(codigo)) throw new RangeError('codigo de concepto inválido')
  if (!nombre || nombre.length > 160) throw new RangeError('nombre de concepto obligatorio o demasiado largo')
  if (!TIPOS.has(tipo)) throw new RangeError('tipo de concepto inválido')
  if (!MONEDAS.has(moneda)) throw new RangeError('moneda de concepto inválida')
  return {
    codigo, nombre, tipo, moneda_default: moneda,
    imponible: !!input.imponible,
    obligatorio: !!input.obligatorio,
    formula_key: input.formulaKey || input.formula_key || null,
    fecha_desde: input.fechaDesde || input.fecha_desde,
    fecha_hasta: input.fechaHasta || input.fecha_hasta || null,
    activo: input.activo !== false,
  }
}

export function conciliarConceptos(conceptos = []) {
  const totalIngresos = conceptos
    .filter(c => c.tipo === 'ingreso')
    .reduce((sum, c) => sum + Number(c.monto || 0), 0)
  const totalDeducciones = conceptos
    .filter(c => c.tipo === 'deduccion' || c.tipo === 'retencion')
    .reduce((sum, c) => sum + Number(c.monto || 0), 0)
  const totalPatronal = conceptos
    .filter(c => c.tipo === 'aporte_patronal')
    .reduce((sum, c) => sum + Number(c.monto || 0), 0)
  return {
    totalIngresos: round(totalIngresos),
    totalDeducciones: round(totalDeducciones),
    totalPatronal: round(totalPatronal),
    neto: round(totalIngresos - totalDeducciones),
  }
}

export function assertConceptosReconciliados(conceptos, expected) {
  const actual = conciliarConceptos(conceptos)
  const epsilon = 0.0001
  if (Math.abs(actual.neto - Number(expected.neto || 0)) > epsilon) {
    throw new RangeError('Los conceptos no concilian con el neto de la línea')
  }
  return actual
}

function round(value) { return Math.round(Number(value) * 10000) / 10000 }
