// Mutaciones del flujo de marcaje real.
import { useMutation } from '@tanstack/react-query'
import { useAccountQueryClient as useQueryClient } from '../../compat/lib/accountQueries.js'
import { showToast } from '../../compat/components/ui/toastBus.js'
import { apiPost, KEY_ASISTENCIA, KEY_MARCAJE } from './nominaApi.js'

function makeIdempotencyKey(tipo, empleadoId) {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${tipo}-${empleadoId}-${random}`
}

export function useMarcarEntrada() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ empleadoId, nota }) => apiPost('/api/nomina/marcaje/entrada', {
      empleadoId, nota, idempotencyKey: makeIdempotencyKey('entrada', empleadoId),
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
    mutationFn: ({ empleadoId, nota }) => apiPost('/api/nomina/marcaje/salida', {
      empleadoId, nota, idempotencyKey: makeIdempotencyKey('salida', empleadoId),
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
    mutationFn: ({ registroId, motivo }) => apiPost('/api/nomina/marcaje/anular-entrada-ausencia', { registroId, motivo }),
    onSuccess: () => {
      showToast.success('Entrada anulada y ausencia registrada en auditoría')
      qc.invalidateQueries({ queryKey: KEY_MARCAJE })
      qc.invalidateQueries({ queryKey: KEY_ASISTENCIA })
    },
    onError: error => showToast.error(error.message || 'No se pudo anular la entrada'),
  })
}
