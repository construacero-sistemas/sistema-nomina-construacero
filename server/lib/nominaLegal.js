const TIPOS = new Set(['porcentaje', 'monto_fijo', 'formula'])
const UNIDADES = new Set(['porcentaje', 'VES', 'USD', 'factor', 'formula'])

export function normalizarReglaLegal(input = {}) {
  const codigo = String(input.codigo || '').trim().toUpperCase()
  const nombre = String(input.nombre || '').trim()
  const tipo = String(input.tipo || '')
  const unidad = String(input.unidad || '')
  const version = String(input.version || '').trim()
  const fuente = String(input.fuente || '').trim()
  if (!/^[A-Z0-9_]{2,60}$/.test(codigo)) throw new RangeError('codigo legal inválido')
  if (!nombre || nombre.length > 160 || !TIPOS.has(tipo) || !UNIDADES.has(unidad)) throw new RangeError('tipo/unidad legal inválidos')
  if (!version || !fuente) throw new RangeError('version y fuente son obligatorias')
  if (tipo === 'porcentaje' && !(Number(input.valor) >= 0 && Number(input.valor) <= 100)) {
    throw new RangeError('porcentaje legal fuera de rango')
  }
  if (tipo === 'monto_fijo' && !Number.isFinite(Number(input.valor))) {
    throw new RangeError('monto legal inválido')
  }
  if (tipo === 'formula' && !String(input.formulaKey || input.formula_key || '').trim()) {
    throw new RangeError('formulaKey obligatoria')
  }
  const fechaDesde = input.fechaDesde || input.fecha_desde
  const fechaHasta = input.fechaHasta || input.fecha_hasta || null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaDesde) || (fechaHasta && !/^\d{4}-\d{2}-\d{2}$/.test(fechaHasta)) ||
      (fechaHasta && fechaHasta < fechaDesde)) {
    throw new RangeError('vigencia legal inválida')
  }
  return {
    codigo, nombre, tipo, valor: input.valor === undefined ? null : Number(input.valor), unidad,
    formula_key: input.formulaKey || input.formula_key || null,
    base_key: input.baseKey || input.base_key || null,
    fecha_desde: fechaDesde,
    fecha_hasta: fechaHasta,
    version, fuente, activo: false,
  }
}

export function reglaEstaAprobada(regla) {
  return !!(regla?.activo && regla?.aprobado_por && regla?.aprobado_en && regla?.fuente && regla?.version)
}

export function seleccionarReglasVigentes(reglas, fecha) {
  return reglas.filter(r => reglaEstaAprobada(r) && r.fecha_desde <= fecha &&
    (!r.fecha_hasta || r.fecha_hasta >= fecha))
}

export function aplicarReglaLegal(baseVES, regla) {
  if (!reglaEstaAprobada(regla)) throw new RangeError(`Regla ${regla?.codigo || ''} no está aprobada`)
  const base = Number(baseVES)
  if (!Number.isFinite(base) || base < 0) throw new RangeError('Base legal VES inválida')
  if (regla.tipo === 'porcentaje') return round(base * Number(regla.valor) / 100)
  if (regla.tipo === 'monto_fijo') return round(Number(regla.valor))
  throw new RangeError(`La fórmula ${regla.formula_key} requiere un evaluador aprobado`)
}

function round(value) { return Math.round(Number(value) * 10000) / 10000 }
