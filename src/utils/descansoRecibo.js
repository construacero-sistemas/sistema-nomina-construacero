// src/utils/descansoRecibo.js
// Desglose del monto de días de un recibo (LOTTT art. 119). El servidor guarda en
// `monto_normal_usd` el salario diario × (días trabajados + días de descanso
// pagados) y en `dias_descanso` cuántos son de descanso. Esta función separa las
// dos partes para mostrarlas en el recibo, la planilla y los PDF.

const r2 = n => Math.round(Number(n) * 100) / 100

export function desgloseDescanso(linea) {
  const montoNormal = Number(linea?.monto_normal_usd || 0)
  const diasDescanso = Math.max(0, Number(linea?.dias_descanso || 0))
  const salarioDia = Math.max(0, Number(linea?.salario_dia_usd_snap || 0))
  const montoDescanso = Math.min(montoNormal, r2(diasDescanso * salarioDia))
  return {
    diasDescanso,
    montoDescanso,
    montoTrabajado: r2(montoNormal - montoDescanso),
  }
}

/**
 * Reparto de la semana de un recibo en sueldo semanal y bono semanal (regla del
 * usuario, 19/11/2026: el bono sale de la semana y no se suma). Solo para recibos
 * calculados con la migración 268, que guardan ambos montos. «resto» es lo que
 * paga el monto normal fuera de la semana (días de descanso o feriado trabajados).
 * Devuelve null si el recibo no tiene el reparto o no cuadra con su monto normal:
 * entonces se muestran los conceptos de siempre.
 */
export function desgloseSemana(linea) {
  if (linea?.bono_semanal_usd == null || linea?.sueldo_semanal_usd == null) return null
  const bono = r2(Number(linea.bono_semanal_usd) || 0)
  const sueldo = r2(Number(linea.sueldo_semanal_usd) || 0)
  const resto = r2(Number(linea.monto_normal_usd || 0) - sueldo - bono)
  if (resto < -0.01) return null
  return { sueldo, bono, resto: Math.max(0, resto) }
}
