// src/components/nomina/descuentosUtils.js
// Regla vigente: todo descuento de nómina se registra por trabajador con motivo
// obligatorio (Anticipo, Préstamo, Falta, Multa u Otro) y monto positivo, y el
// conjunto nunca deja el neto del recibo en negativo. El servidor vuelve a
// validar todo; aquí solo se prepara un formulario claro y se evita guardar
// basura.
import {
  MAX_DESCUENTOS,
  MOTIVOS_DESCUENTO as MOTIVOS_SERVIDOR,
  etiquetaMotivoDescuento,
} from '../../../server/lib/nominaDescuentos.js'
// La lista de motivos es única: vive en el servidor (que valida) y aquí solo se
// convierte en opciones con etiqueta para el selector.
export const MOTIVOS_DESCUENTO = MOTIVOS_SERVIDOR.map(value => ({ value, label: etiquetaMotivoDescuento(value) }))

export { MAX_DESCUENTOS }

const MOTIVOS_VALIDOS = new Set(MOTIVOS_DESCUENTO.map(m => m.value))
let contadorClaves = 0
const nuevaClave = () => `desc-${++contadorClaves}`

export function crearFilaDescuento(campos = {}) {
  return { clave: nuevaClave(), motivo: '', detalle: '', monto: '', ...campos }
}

// Un recibo histórico sin desglose conserva su deducción global como una fila
// «Otro» con el resumen que ya existía, para no perderla al volver a guardar.
export function descuentosIniciales(linea) {
  if (Array.isArray(linea?.descuentos) && linea.descuentos.length) {
    return linea.descuentos.map(d => crearFilaDescuento({
      motivo: MOTIVOS_VALIDOS.has(d.motivo) ? d.motivo : 'otro',
      detalle: d.detalle || '',
      monto: d.monto_usd != null ? String(d.monto_usd) : '',
    }))
  }
  const legacy = Number(linea?.deducciones_usd || 0)
  if (legacy > 0) {
    return [crearFilaDescuento({ motivo: 'otro', detalle: linea?.nota_deducciones || '', monto: String(legacy) })]
  }
  return []
}

export function montoFilaDescuento(fila) {
  const monto = Number(String(fila.monto).replace(',', '.'))
  return Number.isFinite(monto) ? monto : NaN
}

/** Valida la lista del formulario; `bruto` habilita la regla de neto no negativo. */
export function validarDescuentosForm(filas, bruto) {
  const errores = {}
  let total = 0
  for (const fila of filas) {
    const problemas = []
    if (!MOTIVOS_VALIDOS.has(fila.motivo)) problemas.push('Elige el motivo del descuento')
    const monto = montoFilaDescuento(fila)
    if (!Number.isFinite(monto) || monto <= 0) problemas.push('El monto debe ser mayor que 0')
    else total += monto
    if (fila.detalle.length > 180) problemas.push('El detalle no puede pasar de 180 caracteres')
    if (problemas.length) errores[fila.clave] = problemas.join(' · ')
  }
  total = Math.round(total * 10000) / 10000
  let errorGlobal = ''
  if (filas.length > MAX_DESCUENTOS) errorGlobal = `Un recibo no puede tener más de ${MAX_DESCUENTOS} descuentos`
  else if (!errorGlobal && Object.keys(errores).length === 0 && Number.isFinite(bruto) && total > bruto + 0.0001) {
    errorGlobal = `Los descuentos suman $${total.toFixed(2)} y superan el total bruto ($${Number(bruto).toFixed(2)}); el neto no puede quedar en negativo`
  }
  return { ok: Object.keys(errores).length === 0 && !errorGlobal, errores, errorGlobal, total }
}

/** Payload limpio para el servidor: [{ motivo, detalle, monto }]. */
export function normalizarDescuentosForm(filas) {
  return filas.map(fila => ({
    motivo: fila.motivo,
    detalle: fila.detalle.trim() || undefined,
    monto: montoFilaDescuento(fila),
  }))
}
