// src/hooks/useHistorialCierres.js
// Cierres mensuales ya confirmados (con su detalle por cuenta), del más reciente al más antiguo.
import { useCallback } from 'react'
import { useAccountQuery as useQuery } from '../../compat/lib/accountQueries.js'
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
    enabled: tieneCapacidad(perfil, 'gestionarUsuarios'), staleTime: 0, retry: false,
  })
}

// Todos los movimientos de un mes cerrado (soporte del cierre); se pide solo al descargar el detalle.
export async function cargarMovimientosCierre(mes) {
  const response = await authFetch(`/api/finanzas/periodos-mensuales/movimientos?${new URLSearchParams({ mes })}`)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Error ${response.status}`)
  return payload.movimientos || []
}
