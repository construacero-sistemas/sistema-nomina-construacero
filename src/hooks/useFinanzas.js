// src/hooks/useFinanzas.js
// Acceso del frontend al libro financiero; todas las lecturas son acotadas.
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import useAuthStore from '../../compat/store/useAuthStore.js'
import { apiUrl, getAuthHeaders } from '../../compat/services/apiBase.js'
import { showToast } from '../../compat/components/ui/toastBus.js'

const BASE_KEY = ['finanzas']
const ADMIN_ROLE = 'administracion'

function puedeFinanzas(perfil) {
  return perfil?.rol === ADMIN_ROLE
}

async function apiGet(path) {
  const headers = await getAuthHeaders()
  const response = await fetch(apiUrl(path), { headers })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Error ${response.status}`)
  return payload
}

async function apiPost(path, body) {
  const headers = await getAuthHeaders()
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Error ${response.status}`)
  return payload
}

function idempotencyKey(prefix) {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`
}

export function usePuedeFinanzas() {
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  return puedeFinanzas(perfil)
}

export function useFinanzasCategorias() {
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  return useQuery({
    queryKey: [...BASE_KEY, 'categorias'],
    queryFn: () => apiGet('/api/finanzas/categorias'),
    enabled: puedeFinanzas(perfil),
    staleTime: 1000 * 60 * 10,
  })
}

export function useFinanzasMovimientos({ desde, hasta, tipo = '', categoria = '', moneda = '', mostrarAnulados = false } = {}) {
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  const params = new URLSearchParams({ desde, hasta, limit: '50', offset: '0' })
  if (tipo) params.set('tipo', tipo)
  if (categoria) params.set('categoria', categoria)
  if (moneda) params.set('moneda', moneda)
  if (mostrarAnulados) params.set('mostrarAnulados', 'true')
  return useQuery({
    queryKey: [...BASE_KEY, 'movimientos', desde, hasta, tipo, categoria, moneda, mostrarAnulados],
    queryFn: () => apiGet(`/api/finanzas/movimientos?${params}`),
    enabled: puedeFinanzas(perfil) && Boolean(desde && hasta && desde <= hasta),
    staleTime: 1000 * 15,
  })
}

export function useFinanzasResumen({ desde, hasta, tipo = '', categoria = '', moneda = '' } = {}) {
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  const params = new URLSearchParams({ desde, hasta })
  if (tipo) params.set('tipo', tipo)
  if (categoria) params.set('categoria', categoria)
  if (moneda) params.set('moneda', moneda)
  return useQuery({
    queryKey: [...BASE_KEY, 'resumen', desde, hasta, tipo, categoria, moneda],
    queryFn: () => apiGet(`/api/finanzas/reportes/resumen?${params}`),
    enabled: puedeFinanzas(perfil) && Boolean(desde && hasta && desde <= hasta),
    staleTime: 1000 * 30,
  })
}

export function useCrearMovimiento() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fields => apiPost('/api/finanzas/movimientos/crear', {
      ...fields,
      idempotencyKey: fields.idempotencyKey || idempotencyKey('movimiento'),
    }),
    onSuccess: () => {
      showToast.success('Movimiento registrado')
      client.invalidateQueries({ queryKey: BASE_KEY })
    },
    onError: error => showToast.error(error.message || 'No se pudo registrar el movimiento'),
  })
}

export function useAnularMovimiento() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, motivo }) => apiPost('/api/finanzas/movimientos/anular', {
      id,
      motivo,
      idempotencyKey: idempotencyKey('anulacion'),
    }),
    onSuccess: () => {
      showToast.success('Movimiento anulado')
      client.invalidateQueries({ queryKey: BASE_KEY })
    },
    onError: error => showToast.error(error.message || 'No se pudo anular el movimiento'),
  })
}

export function useCrearCategoria() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fields => apiPost('/api/finanzas/categorias/crear', fields),
    onSuccess: () => {
      showToast.success('Categoría creada')
      client.invalidateQueries({ queryKey: [...BASE_KEY, 'categorias'] })
    },
    onError: error => showToast.error(error.message || 'No se pudo crear la categoría'),
  })
}
