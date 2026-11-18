// Mutaciones del flujo de marcaje real.
import { useMutation } from '@tanstack/react-query'
import { useAccountQueryClient as useQueryClient } from '../../compat/lib/accountQueries.js'
import { showToast } from '../../compat/components/ui/toastBus.js'
import { apiPost, KEY_ASISTENCIA, KEY_MARCAJE } from './nominaApi.js'
import { makeIdempotencyKey } from './idempotencia.js'

// La clave llega desde el clic (M-3): si se reintenta tras un corte de red, el
// servidor recibe la misma y responde idempotente. Solo se genera aquí si falta.

export function useMarcarEntrada() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, nota, idempotencyKey }) => apiPost('/api/nomina/marcaje/entrada', {
      empleadoId, nota, idempotencyKey: idempotencyKey || makeIdempotencyKey('entrada', empleadoId),
    }),
    onSuccess: () => {
      showToast.success('Entrada marcada')
      qc.invalidateQueries({ queryKey: KEY_MARCAJE })
      qc.invalidateQueries({ queryKey: KEY_ASISTENCIA })
    },
    onError: error => showToast.error(error.message || 'Error al marcar entrada'),
  })
}

export function useMarcarSalida() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, nota, idempotencyKey }) => apiPost('/api/nomina/marcaje/salida', {
      empleadoId, nota, idempotencyKey: idempotencyKey || makeIdempotencyKey('salida', empleadoId),
    }),
    onSuccess: () => {
      showToast.success('Salida marcada')
      qc.invalidateQueries({ queryKey: KEY_MARCAJE })
      qc.invalidateQueries({ queryKey: KEY_ASISTENCIA })
    },
    onError: error => showToast.error(error.message || 'Error al marcar salida'),
  })
}

export function useCorregirMarcaje() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: campos => apiPost('/api/nomina/marcaje/corregir', campos),
    onSuccess: () => {
      showToast.success('Marcaje corregido y registrado en auditoría')
      qc.invalidateQueries({ queryKey: KEY_MARCAJE })
      qc.invalidateQueries({ queryKey: KEY_ASISTENCIA })
    },
    onError: error => showToast.error(error.message || 'No se pudo corregir el marcaje'),
  })
}

export function useAnularEntradaComoAusencia() {
  const qc = useQueryClient()
  return useMutation({
    // El servidor decide si la entrada queda como ausencia o se elimina (día libre o
    // feriado no laborable) y rechaza con 409 si no coincide con `resultadoEsperado`.
    mutationFn: ({ registroId, motivo, resultadoEsperado = 'ausencia' }) => apiPost('/api/nomina/marcaje/anular-entrada-ausencia', { registroId, motivo, resultadoEsperado }),
    onSuccess: data => {
      showToast.success(data?.resultado === 'sin-registro'
        ? 'Entrada anulada: el día quedó sin registro (auditado)'
        : 'Entrada anulada y ausencia registrada en auditoría')
      qc.invalidateQueries({ queryKey: KEY_MARCAJE })
      qc.invalidateQueries({ queryKey: KEY_ASISTENCIA })
    },
    onError: error => showToast.error(error.message || 'No se pudo anular la entrada'),
  })
}
