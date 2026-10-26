// server/lib/nominaDescuentos.js
// Regla vigente: todo descuento de nómina se registra por trabajador con motivo
// obligatorio (Anticipo, Préstamo, Falta, Multa u Otro) y monto positivo, y el
// conjunto nunca puede dejar el neto del recibo en negativo. La validación vive
// aquí como última barrera del servidor: la interfaz ayuda, pero no decide.

export const MOTIVOS_DESCUENTO = ['anticipo', 'prestamo', 'falta', 'multa', 'otro']
export const MAX_DESCUENTOS = 20

const ETIQUETAS_MOTIVO = {
  anticipo: 'Anticipo',
  prestamo: 'Préstamo',
  falta: 'Falta',
  multa: 'Multa',
  otro: 'Otro',
}

export function etiquetaMotivoDescuento(motivo) {
  return ETIQUETAS_MOTIVO[motivo] || 'Otro'
}

/** Normaliza y valida la lista completa de descuentos de un recibo. */
export function validarDescuentosNomina(descuentos) {
  if (!Array.isArray(descuentos)) {
    return { ok: false, error: 'Los descuentos deben ser una lista; cada uno exige motivo y monto' }
  }
  if (descuentos.length > MAX_DESCUENTOS) {
    return { ok: false, error: `Un recibo no puede tener más de ${MAX_DESCUENTOS} descuentos` }
  }
  const normalizados = []
  for (const item of descuentos) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: 'Cada descuento requiere motivo y monto' }
    }
    const motivo = typeof item.motivo === 'string' ? item.motivo.trim().toLowerCase() : ''
    if (!MOTIVOS_DESCUENTO.includes(motivo)) {
      return { ok: false, error: 'Todo descuento requiere un motivo: Anticipo, Préstamo, Falta, Multa u Otro' }
    }
    const crudo = item.monto
    const esTipoNumerico = typeof crudo === 'number' || (typeof crudo === 'string' && crudo.trim() !== '')
    const monto = esTipoNumerico ? Number(crudo) : NaN
    if (!Number.isFinite(monto) || monto <= 0) {
      return { ok: false, error: 'El monto de cada descuento debe ser mayor que 0' }
    }
    const detalle = typeof item.detalle === 'string' ? item.detalle.trim() : ''
    if (detalle.length > 180) {
      return { ok: false, error: 'El detalle del descuento es demasiado largo (máximo 180 caracteres)' }
    }
    normalizados.push({ motivo, detalle: detalle || null, monto: Math.round(monto * 10000) / 10000 })
  }
  return { ok: true, descuentos: normalizados }
}

export function totalDescuentosNomina(descuentos) {
  return Math.round(descuentos.reduce((suma, d) => suma + d.monto, 0) * 10000) / 10000
}

// Resumen legible que viaja en nomina_lineas.nota_deducciones para los reportes
// que ya leen ese campo. El recibo detallado usa la tabla nomina_descuentos.
export function componerNotaDescuentos(descuentos) {
  const partes = descuentos.map(d => (d.detalle
    ? `${etiquetaMotivoDescuento(d.motivo)} — ${d.detalle}`
    : etiquetaMotivoDescuento(d.motivo)))
  return partes.join(' · ').slice(0, 500) || null
}
