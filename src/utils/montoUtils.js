// src/utils/montoUtils.js
// Normalización y saneamiento de inputs monetarios / decimales.
// Resuelve la incompatibilidad de teclados iOS/Android con separadores decimales (punto y coma).

/**
 * Normaliza la entrada de montos monetarios o decimales.
 * - Transforma ',' en '.' (vital para teclados iOS/Android en español donde la tecla decimal es una coma).
 * - Transforma '.' o ',' inicial en '0.' para agilizar la escritura de centavos (.5 -> 0.5).
 * - Admite pegado inteligente de montos con formato de miles y decimales (ej: "1.250,50" o "1,250.50").
 * - Limpia símbolos de moneda comunes al pegar ($, Bs., Bs, USD, USDT).
 * - Rechaza caracteres no numéricos o múltiples separadores decimales.
 *
 * @param {string|number} raw - Entrada cruda del evento onChange o valor a sanitizar.
 * @returns {string|null} - Cadena válida normalizada o null si el valor contiene caracteres inválidos.
 */
export function normalizarMontoInput(raw) {
  if (raw === null || raw === undefined) return ''
  let val = String(raw).trim()

  if (val === '') return ''

  // Limpiar posibles símbolos de moneda al pegar: $, Bs., Bs, USD, USDT
  if (/^[$ \sBsUSDT.,\d]+$/i.test(val)) {
    val = val.replace(/[$ \s]|Bs\.?|USDT?/gi, '').trim()
  }

  // Soporte para pegar montos con separadores de miles y decimales:
  // Ej: "1.234,56" o "1,234.56"
  if (/^\d{1,3}([,.]\d{3})+([,.]\d+)?$/.test(val)) {
    const lastComma = val.lastIndexOf(',')
    const lastDot = val.lastIndexOf('.')
    if (lastComma > lastDot) {
      // Formato es-VE / europeo: miles con punto, decimal con coma
      val = val.replace(/\./g, '').replace(',', '.')
    } else {
      // Formato us / anglosajón: miles con coma, decimal con punto
      val = val.replace(/,/g, '')
    }
  } else {
    // Reemplazo directo de coma por punto
    val = val.replace(',', '.')
  }

  // Si el usuario teclea '.' o ',' al inicio en campo vacío -> "0."
  if (val === '.') return '0.'

  // Permitir solo dígitos con como máximo un punto decimal
  if (/^\d*\.?\d*$/.test(val)) {
    return val
  }

  return null
}
