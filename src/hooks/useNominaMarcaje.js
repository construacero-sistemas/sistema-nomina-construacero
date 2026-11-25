// Mutaciones del flujo de marcaje real.
// Los errores NO se anuncian aquí con un toast: el panel de marcaje los muestra en
// línea junto a la lista (con «Reintentar» cuando aplica) y los modales en su propio
// cuerpo. Un toast además duplicaba el mensaje (M-9 de PLAN_MARCAJE_BOTONES_UX).
import { useMutation } from '@tanstack/react-query'
import { useAccountQueryClient as useQueryClient } from '../../compat/lib/accountQueries.js'
import { showToast } from '../../compat/components/ui/toastBus.js'
import { formatHora12 } from '../utils/timeUtils'
import { apiPost, KEY_ASISTENCIA, KEY_MARCAJE, KEY_PERIODOS } from './nominaApi.js'
import { makeIdempotencyKey } from './idempotencia.js'
import { aplicarMarcajeEnCache } from './marcajeCache.js'

// La clave llega desde el clic (M-3): si se reintenta tras un corte de red, el
// servidor recibe la misma y responde idempotente. Solo se genera aquí si falta.

function refrescar(qc) {
  qc.invalidateQueries({ queryKey: KEY_MARCAJE })
  qc.invalidateQueries({ queryKey: KEY_ASISTENCIA })
  qc.invalidateQueries({ queryKey: KEY_PERIODOS })
  qc.invalidateQueries({ queryKey: ['nomina', 'hoja'] })
}

// «Entrada de Omar Patti · 07:58 AM» (M-12): dice a quién y a qué hora.
function mensaje(accion, nombre, hora) {
  return [accion + (nombre ? ` de ${nombre}` : ''), hora ? formatHora12(hora) : null].filter(Boolean).join(' · ')
}

export function useMarcarEntrada() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, nota, idempotencyKey, reemplazarAusencia }) => apiPost('/api/nomina/marcaje/entrada', {
      empleadoId, nota, idempotencyKey: idempotencyKey || makeIdempotencyKey('entrada', empleadoId),
      ...(reemplazarAusencia ? { reemplazarAusencia: true } : {}),
    }),
    onSuccess: (data, variables) => {
      showToast.success(mensaje('Entrada', variables?.nombre, data?.registro?.hora_entrada))
      if (data?.registro) aplicarMarcajeEnCache(qc, { registro: data.registro, empleadoId: variables.empleadoId })
      refrescar(qc)
    },
  })
}

export function useMarcarSalida() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, nota, idempotencyKey }) => apiPost('/api/nomina/marcaje/salida', {
      empleadoId, nota, idempotencyKey: idempotencyKey || makeIdempotencyKey('salida', empleadoId),
    }),
    onSuccess: (data, variables) => {
      showToast.success(mensaje('Salida', variables?.nombre, data?.registro?.hora_salida))
      if (data?.registro) aplicarMarcajeEnCache(qc, { registro: data.registro, empleadoId: variables.empleadoId })
      refrescar(qc)
    },
  })
}

// Ausencia del día con su reversa. Solo escribe sobre días laborables del empleado
// y nunca borra horas reales del reloj (eso vive en «Corregir marcaje»).
export function useMarcarAusencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, quitar = false, justificada = false }) => apiPost('/api/nomina/marcaje/ausencia', quitar
      ? { empleadoId, quitar }
      : { empleadoId, quitar, justificada: justificada === true }),
    onSuccess: (data, variables) => {
      showToast.success(variables?.quitar
        ? 'Ausencia deshecha'
        : variables?.justificada ? 'Falta justificada registrada: el día se paga' : 'Falta sin justificativo registrada: se descuenta ese día')
      if (variables?.quitar) aplicarMarcajeEnCache(qc, { quitarEmpleadoId: variables.empleadoId })
      else if (data?.registro) aplicarMarcajeEnCache(qc, { registro: data.registro, empleadoId: variables.empleadoId })
      refrescar(qc)
    },
  })
}

export function useCorregirMarcaje() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: campos => apiPost('/api/nomina/marcaje/corregir', campos),
    onSuccess: () => {
      showToast.success('Marcaje corregido y registrado en auditoría')
      refrescar(qc)
    },
  })
}

export function useAnularEntradaComoAusencia() {
  const qc = useQueryClient()
  return useMutation({
    // El servidor decide si la entrada queda como ausencia o se elimina (día libre o
    // feriado no laborable) y rechaza con 409 si no coincide con `resultadoEsperado`.
    mutationFn: ({ registroId, motivo, resultadoEsperado = 'ausencia', justificada = false }) => apiPost('/api/nomina/marcaje/anular-entrada-ausencia', { registroId, motivo, resultadoEsperado, justificada: justificada === true }),
    onSuccess: (data, variables) => {
      showToast.success(data?.resultado === 'sin-registro'
        ? 'Entrada anulada: el día quedó sin registro (auditado)'
        : 'Entrada anulada y ausencia registrada en auditoría')
      if (data?.resultado === 'sin-registro') aplicarMarcajeEnCache(qc, { quitarRegistroId: variables.registroId })
      else if (data?.registro) aplicarMarcajeEnCache(qc, { registro: data.registro })
      refrescar(qc)
    },
  })
}

// M-6: deshacer con un toque la entrada o salida recién marcada desde este equipo.
export function useDeshacerMarcaje() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ registroId, tipo, idempotencyKey }) => apiPost('/api/nomina/marcaje/deshacer', { registroId, tipo, idempotencyKey }),
    onSuccess: (data, variables) => {
      showToast.success(variables.tipo === 'entrada' ? 'Entrada deshecha' : 'Salida deshecha: la jornada sigue abierta')
      if (variables.tipo === 'entrada') aplicarMarcajeEnCache(qc, { quitarRegistroId: variables.registroId })
      else if (data?.registro) aplicarMarcajeEnCache(qc, { registro: data.registro })
      refrescar(qc)
    },
  })
}

export function useRegistrarHorasExtra() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, fecha, horasExtra, nota, confirmarDiaTrabajado }) => apiPost('/api/nomina/marcaje/horas-extra', {
      empleadoId,
      ...(fecha ? { fecha } : {}),
      horasExtra,
      ...(nota !== undefined ? { nota } : {}),
      ...(confirmarDiaTrabajado ? { confirmarDiaTrabajado: true } : {}),
    }),
    onSuccess: (data, variables) => {
      const h = Number(variables?.horasExtra) || 0
      showToast.success(h > 0
        ? `Horas extras registradas (+${h} h)${variables?.nombre ? ` · ${variables.nombre}` : ''}`
        : `Horas extras retiradas${variables?.nombre ? ` · ${variables.nombre}` : ''}`)
      if (data?.registro) aplicarMarcajeEnCache(qc, { registro: data.registro, empleadoId: variables.empleadoId })
      else aplicarMarcajeEnCache(qc, { quitarEmpleadoId: variables.empleadoId })
      refrescar(qc)
    },
  })
}

export function useMarcarDiaTrabajado() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, fecha, quitar = false, horasExtra = 0, nota }) => apiPost('/api/nomina/marcaje/dia-trabajado', {
      empleadoId,
      ...(fecha ? { fecha } : {}),
      quitar,
      ...(horasExtra ? { horasExtra } : {}),
      ...(nota !== undefined ? { nota } : {}),
    }),
    onSuccess: (data, variables) => {
      showToast.success(variables?.quitar
        ? `Día de descanso restaurado${variables?.nombre ? ` · ${variables.nombre}` : ''}`
        : `Día marcado como trabajado${variables?.nombre ? ` · ${variables.nombre}` : ''}`)
      if (variables?.quitar) aplicarMarcajeEnCache(qc, { quitarEmpleadoId: variables.empleadoId })
      else if (data?.registro) aplicarMarcajeEnCache(qc, { registro: data.registro, empleadoId: variables.empleadoId })
      refrescar(qc)
    },
  })
}
