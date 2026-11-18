// src/hooks/useConfigNegocio.js
// Configuración del negocio para header del PDF y ajustes globales
// — select explícito SIN gate_password_hash
// — gate se valida server-side vía RPCs SECURITY DEFINER
//
// NOTA: este hook NO abre canal realtime propio. Antes creaba un canal
// postgres_changes con nombre aleatorio POR INSTANCIA (y se monta en cada
// fila de producto vía useTasaCambio) → cientos de canales simultáneos y
// errores "ChannelRateLimitReached" en Supabase. Los cambios de config ya
// llegan por dos vías compartidas: el broadcast de useActualizarConfig
// (broadcastEntidad('config')) y el postgres_changes centralizado de
// useRealtimeSync sobre configuracion_negocio.
import { useMutation } from '@tanstack/react-query'
import { useAccountQuery as useQuery, useAccountQueryClient as useQueryClient } from '../lib/accountQueries.js'
import { apiUrl, getAuthHeaders } from '../services/apiBase'
import { broadcastEntidad } from '../services/supabase/realtimeBus'

const KEY = ['config_negocio']

export function useConfigNegocio() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/config'), { headers })
      if (!res.ok) {
        throw new Error('Error al obtener la configuración')
      }
      const data = await res.json()
      return data ?? {}
    },
    retry: 0, // evitar una segunda lectura de configuración por fallo transitorio
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000, // config rarely changes, keep in cache 30 min
  })
}

// ─── Guardar configuración (vía Worker backend — bypass RLS) ─────────────────
export function useActualizarConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (campos) => {
      const headers = await getAuthHeaders()
      const res = await fetch(apiUrl('/api/config'), {
        method: 'POST',
        headers,
        body: JSON.stringify(campos),
      })
      if (!res.ok) {
        const text = await res.text()
        let data = {}
        try { data = JSON.parse(text) } catch { data = {} }
        throw new Error(data.error || text || `Error ${res.status}`)
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: KEY }); broadcastEntidad('config') },
  })
}
