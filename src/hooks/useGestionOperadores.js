// src/hooks/useGestionOperadores.js
// Acceso del frontend al panel de gestión de usuarios (solo jefe/admin).
// Todas las lecturas y mutaciones pasan por authFetch (refresco automático de
// sesión); el servidor es la autoridad y devuelve 403 a cualquier otro rol.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authFetch } from '../../compat/services/authFetch.js'

const BASE_KEY = ['gestion-operadores']

async function apiGet(path) {
  const response = await authFetch(path)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Error ${response.status}`)
  return payload
}

async function apiPost(path, body) {
  const response = await authFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Error ${response.status}`)
  return payload
}

/** Lista completa de usuarios operativos (activos + inactivos). */
export function useOperadores({ enabled = true } = {}) {
  return useQuery({
    queryKey: BASE_KEY,
    queryFn: () => apiGet('/api/gestion/operadores'),
    enabled,
    staleTime: 15_000,
    retry: 1,
  })
}

function useInvalidarLista() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: BASE_KEY })
}

/** Crear usuario operativo (jefe / finanzas / nomina / administracion) con PIN de 6. */
export function useCrearOperador() {
  const invalidate = useInvalidarLista()
  return useMutation({
    mutationFn: campos => apiPost('/api/gestion/operadores/crear', campos),
    onSuccess: invalidate,
  })
}

/** Activar/desactivar un usuario. */
export function useCambiarEstadoOperador() {
  const invalidate = useInvalidarLista()
  return useMutation({
    mutationFn: ({ id, activo }) => apiPost('/api/gestion/operadores/estado', { id, activo }),
    onSuccess: invalidate,
  })
}

/** Restablecer el PIN de un usuario activo. */
export function useCambiarPinOperador() {
  const invalidate = useInvalidarLista()
  return useMutation({
    mutationFn: ({ id, pin }) => apiPost('/api/gestion/operadores/pin', { id, pin }),
    onSuccess: invalidate,
  })
}

/** Cambiar el rol de un usuario activo. */
export function useCambiarRolOperador() {
  const invalidate = useInvalidarLista()
  return useMutation({
    mutationFn: ({ id, rol }) => apiPost('/api/gestion/operadores/rol', { id, rol }),
    onSuccess: invalidate,
  })
}

/** Cambiar el nombre de un usuario (activo o inactivo: libera nombres del histórico). */
export function useCambiarNombreOperador() {
  const invalidate = useInvalidarLista()
  return useMutation({
    mutationFn: ({ id, nombre }) => apiPost('/api/gestion/operadores/nombre', { id, nombre }),
    onSuccess: invalidate,
  })
}
