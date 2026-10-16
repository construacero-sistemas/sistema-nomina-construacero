export const normalizeText = value => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLocaleLowerCase('es')
  .replace(/\s+/g, ' ')

export const normalizeAmount = value => Math.round(Number(value) * 1_000_000)

export function clasificarCoincidenciasMovimiento(candidate, rows = []) {
  const ref = normalizeText(candidate.referencia)
  if (!ref) return { exact: null, similar: [] }

  const concept = normalizeText(candidate.concepto)
  const amount = normalizeAmount(candidate.monto)
  const sameRef = rows.filter(row => normalizeText(row.referencia) === ref)
  const exact = sameRef.find(row => normalizeAmount(row.monto) === amount) || null
  if (exact) return { exact, similar: [] }

  return { exact: null, similar: sameRef.filter(row => normalizeText(row.concepto) === concept) }
}

export function motivoCoincidenciaValido(value) {
  const reason = String(value ?? '').trim()
  return reason.length >= 8 && reason.length <= 300
}
