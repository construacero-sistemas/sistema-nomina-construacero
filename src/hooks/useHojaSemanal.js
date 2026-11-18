// src/hooks/useHojaSemanal.js
// «Hoja semanal» del período (docs/PLAN_HOJA_SEMANAL.md). La clave cuelga de
// KEY_LINEAS: cualquier ajuste o recálculo que invalide los recibos la refresca sola.
import { useCallback } from 'react'
import { useAccountQuery as useQuery } from '../../compat/lib/accountQueries.js'
import useAuthStore from '../../compat/store/useAuthStore.js'
import { tieneCapacidad } from '../config/accesoModulos.js'
import { apiGet, KEY_LINEAS } from './nominaApi.js'

export default function useHojaSemanal(periodoId) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return useQuery({
    queryKey: [...KEY_LINEAS, 'hoja', periodoId],
    queryFn: () => apiGet(`/api/nomina/periodos/hoja?periodoId=${periodoId}`),
    enabled: Boolean(perfil && periodoId && tieneCapacidad(perfil, 'verNomina')),
    staleTime: 1000 * 30,
  })
}
