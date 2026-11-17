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
