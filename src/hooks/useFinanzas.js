// src/hooks/useFinanzas.js
// Acceso del frontend al libro financiero; todas las lecturas son acotadas.
import { useCallback } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import useAuthStore from '../../compat/store/useAuthStore.js'
import { authFetch } from '../../compat/services/authFetch.js'
import { showToast } from '../../compat/components/ui/toastBus.js'

const BASE_KEY = ['finanzas']
const ADMIN_ROLE = 'administracion'

function puedeFinanzas(perfil) {
  return perfil?.rol === ADMIN_ROLE
}

// authFetch refresca la sesión y reintenta automáticamente en 401.
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
  const pageSize = 50
  const buildUrl = offset => {
    const params = new URLSearchParams({ desde, hasta, limit: String(pageSize), offset: String(offset) })
    if (tipo) params.set('tipo', tipo)
    if (categoria) params.set('categoria', categoria)
    if (moneda) params.set('moneda', moneda)
    if (mostrarAnulados) params.set('mostrarAnulados', 'true')
    return `/api/finanzas/movimientos?${params}`
  }
  return useInfiniteQuery({
    queryKey: [...BASE_KEY, 'movimientos', desde, hasta, tipo, categoria, moneda, mostrarAnulados],
    queryFn: ({ pageParam = 0 }) => apiGet(buildUrl(pageParam)),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const recibidos = lastPage?.paginacion?.recibidos ?? 0
      return recibidos === pageSize ? allPages.length * pageSize : undefined
    },
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

export function useRevertirAnulacion() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id }) => apiPost('/api/finanzas/movimientos/revertir-anulacion', { id }),
    onSuccess: () => {
      showToast.success('Movimiento restaurado')
      client.invalidateQueries({ queryKey: BASE_KEY })
    },
    onError: error => showToast.error(error.message || 'No se pudo revertir la anulación'),
  })
}

export function useEliminarCategoria() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id }) => apiPost('/api/finanzas/categorias/eliminar', { id }),
    onSuccess: () => {
      showToast.success('Categoría eliminada')
      client.invalidateQueries({ queryKey: [...BASE_KEY, 'categorias'] })
    },
    onError: error => showToast.error(error.message || 'No se pudo eliminar la categoría'),
  })
}

export function useRestaurarCategoria() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id }) => apiPost('/api/finanzas/categorias/restaurar', { id }),
    onSuccess: () => {
      showToast.success('Categoría restaurada')
      client.invalidateQueries({ queryKey: [...BASE_KEY, 'categorias'] })
    },
    onError: error => showToast.error(error.message || 'No se pudo restaurar la categoría'),
  })
}

export function useReasignarCuenta() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, cuentaOrigen }) =>
      apiPost('/api/finanzas/movimientos/reasignar-cuenta', { ids, cuenta_origen: cuentaOrigen }),
    onSuccess: data => {
      showToast.success(`Cuenta asignada a ${data?.actualizados ?? 0} movimiento(s)`)
      client.invalidateQueries({ queryKey: BASE_KEY })
      client.invalidateQueries({ queryKey: ['finanzas', 'cuentas-custodia'] })
    },
    onError: error => showToast.error(error.message || 'No se pudo asignar la cuenta'),
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

export function usePreviewSyncPos() {
  return useMutation({
    mutationFn: ({ fecha, desde, hasta, posUrl } = {}) =>
      apiPost('/api/finanzas/sync-pos', { fecha, desde, hasta, posUrl, confirm: false }),
  })
}

export function useEjecutarSyncPos() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ fecha, desde, hasta, posUrl } = {}) =>
      apiPost('/api/finanzas/sync-pos', { fecha, desde, hasta, posUrl, confirm: true }),
    onSuccess: async data => {
      const monto = Number(data?.total_ingresos_usd || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      const periodoTexto = data?.desde === data?.hasta ? (data?.desde || data?.fecha) : `${data?.desde} a ${data?.hasta}`
      showToast.success(`Ventas de ${periodoTexto} sincronizadas con éxito (+$${monto} USD)`)
      await client.invalidateQueries({ queryKey: BASE_KEY })
      client.refetchQueries({ queryKey: BASE_KEY })
    },
    onError: error => showToast.error(error.message || 'No se pudo sincronizar con el POS'),
  })
}

