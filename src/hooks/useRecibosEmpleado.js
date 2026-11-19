// src/hooks/useRecibosEmpleado.js
// Mejora del 19/11/2026: recibos de un trabajador (más recientes primero), 10 por
// página. Solo se consulta al abrir la ventana: nada de cargas en segundo plano.
import { useCallback } from 'react'
import { useAccountQuery as useQuery } from '../../compat/lib/accountQueries.js'
import useAuthStore from '../../compat/store/useAuthStore.js'
import { tieneCapacidad } from '../config/accesoModulos.js'
import { apiGet, KEY_LINEAS } from './nominaApi.js'

export default function useRecibosEmpleado(empleadoId, pagina = 1) {
  const perfil = useAuthStore(useCallback(s => s.perfil, []))
  return useQuery({
    queryKey: [...KEY_LINEAS, 'empleado', empleadoId, pagina],
    queryFn: () => apiGet(`/api/nomina/empleados/recibos?empleadoId=${empleadoId}&pagina=${pagina}`),
    enabled: Boolean(perfil && empleadoId && tieneCapacidad(perfil, 'verNomina')),
    staleTime: 1000 * 60,
  })
}
