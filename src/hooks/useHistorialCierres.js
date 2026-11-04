// src/hooks/useHistorialCierres.js
// Cierres mensuales ya confirmados (con su detalle por cuenta), del más reciente al más antiguo.
import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAccountQuery as useQuery, useAccountQueryClient as useQueryClient } from '../../compat/lib/accountQueries.js'
import { showToast } from '../../compat/components/ui/toastBus.js'
import useAuthStore from '../../compat/store/useAuthStore.js'
import { authFetch } from '../../compat/services/authFetch.js'
import { tieneCapacidad } from '../config/accesoModulos.js'

export function useHistorialCierres(meses = 12) {
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  return useQuery({
    queryKey: ['finanzas', 'historial-cierres', meses],
    queryFn: async ({ signal }) => {
      const response = await authFetch(`/api/finanzas/periodos-mensuales/historial?${new URLSearchParams({ meses })}`, { signal })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `Error ${response.status}`)
      return payload.cierres || []
    },
    // Cada consulta suma el libro de cada mes: 5 min de caché; cerrar o reabrir un mes la invalida.
    enabled: tieneCapacidad(perfil, 'gestionarUsuarios'), staleTime: 5 * 60 * 1000, retry: false,
  })
}

// Todos los movimientos de un mes cerrado (soporte del cierre); se pide solo al descargar el detalle.
export async function cargarMovimientosCierre(mes) {
  const response = await authFetch(`/api/finanzas/periodos-mensuales/movimientos?${new URLSearchParams({ mes })}`)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Error ${response.status}`)
  return payload.movimientos || []
}

// Un cierre concreto (YYYY-MM-01) del historial; lo usa el asistente para ofrecer el PDF al terminar.
export async function cargarCierre(mes) {
  const response = await authFetch(`/api/finanzas/periodos-mensuales/historial?${new URLSearchParams({ meses: 3 })}`)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Error ${response.status}`)
  const cierre = (payload.cierres || []).find(item => item.mes === mes)
  if (!cierre) throw new Error('El cierre todavía no aparece en el historial. Descárgalo desde "Historial de cierres".')
  return cierre
}

// Reabre el último mes cerrado (cierre hecho por error). Exige motivo; solo jefe.
export function useReabrirCierre() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ mesInicio, motivo }) => {
      const response = await authFetch('/api/finanzas/periodos-mensuales/reabrir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mesInicio, motivo }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || `Error ${response.status}`)
      return payload
    },
    onSuccess: async () => {
      showToast.success('Mes reabierto: ya puedes corregirlo y volver a cerrarlo')
      await client.invalidateQueries({ queryKey: ['finanzas'] })
    },
    onError: error => showToast.error(error.message || 'No se pudo reabrir el mes'),
  })
}
