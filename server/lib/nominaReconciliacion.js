const CAMPOS_MONETARIOS = [
  'total_bruto_usd', 'total_neto_usd', 'monto_normal_usd',
  'monto_extra_usd', 'monto_sabado_usd', 'monto_feriado_usd',
]

export function compararLineas(actuales = [], nuevas = [], epsilon = 0.0001) {
  const anterior = new Map(actuales.map(l => [l.empleado_id, l]))
  const diferencias = []
  for (const nueva of nuevas) {
    const vieja = anterior.get(nueva.empleado_id)
    if (!vieja) {
      diferencias.push({ empleadoId: nueva.empleado_id, tipo: 'faltante_anterior' })
      continue
    }
    for (const campo of CAMPOS_MONETARIOS) {
      const a = Number(vieja[campo] || 0)
      const b = Number(nueva[campo] || 0)
      if (Math.abs(a - b) > epsilon) diferencias.push({
        empleadoId: nueva.empleado_id, campo, anterior: a, nuevo: b,
      })
    }
  }
  for (const vieja of actuales) {
    if (!nuevas.some(n => n.empleado_id === vieja.empleado_id)) {
      diferencias.push({ empleadoId: vieja.empleado_id, tipo: 'faltante_nuevo' })
    }
  }
  return diferencias
}

export function puedeActivarNominaV2({ backupVerificado, diferencias, aprobacionContable }) {
  return !!backupVerificado && !!aprobacionContable && diferencias.length === 0
}
