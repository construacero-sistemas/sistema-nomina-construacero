// src/hooks/useFinanzas.js
// Acceso del frontend al libro financiero; todas las lecturas son acotadas.
import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAccountQuery as useQuery, useAccountInfiniteQuery as useInfiniteQuery, useAccountQueryClient as useQueryClient } from '../../compat/lib/accountQueries.js'
import useAuthStore from '../../compat/store/useAuthStore.js'
import { authFetch } from '../../compat/services/authFetch.js'
import { showToast } from '../../compat/components/ui/toastBus.js'
import { tieneCapacidad } from '../config/accesoModulos.js'

const BASE_KEY = ['finanzas']

// Compuerta derivada de la matriz única: finanzas y los roles totales.
function puedeFinanzas(perfil) {
  return tieneCapacidad(perfil, 'verFinanzas')
}

// authFetch refresca la sesión y reintenta automáticamente en 401.
async function apiGet(path, signal) {
  const response = await authFetch(path, { signal })
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

export function useFinanzasMovimientos({ desde, hasta, tipo = '', categoria = '', moneda = '', cartera = '', mostrarAnulados = false } = {}) {
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  const pageSize = 50
  const buildUrl = ({ offset = 0, versionLibro } = {}) => {
    const params = new URLSearchParams({ desde, hasta, limit: String(pageSize), offset: String(offset) })
    if (versionLibro != null) params.set('versionLibro', versionLibro)
    if (cartera) params.set('cartera', cartera)
    if (tipo) params.set('tipo', tipo)
    if (categoria) params.set('categoria', categoria)
    if (moneda) params.set('moneda', moneda)
    if (mostrarAnulados) params.set('mostrarAnulados', 'true')
    return `/api/finanzas/movimientos?${params}`
  }
  return useInfiniteQuery({
    queryKey: [...BASE_KEY, 'movimientos', desde, hasta, tipo, categoria, moneda, cartera, mostrarAnulados],
    queryFn: ({ pageParam, signal }) => apiGet(buildUrl(pageParam), signal),
    initialPageParam: { offset: 0 },
    getNextPageParam: lastPage => lastPage?.paginacion?.siguiente != null
      ? { offset: lastPage.paginacion.siguiente, versionLibro: lastPage.versionLibro }
      : undefined,
    retry: false,
    enabled: puedeFinanzas(perfil) && Boolean(desde && hasta && desde <= hasta),
    staleTime: 1000 * 15,
  })
}

export function useFinanzasResumen({ desde, hasta, tipo = '', categoria = '', moneda = '', cartera = '' } = {}) {
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  const puedeVerSaldos = tieneCapacidad(perfil, 'verSaldos')
  const params = new URLSearchParams({ desde, hasta })
  if (tipo) params.set('tipo', tipo)
  if (categoria) params.set('categoria', categoria)
  if (moneda) params.set('moneda', moneda)
  if (cartera) params.set('cartera', cartera)
  return useQuery({
    queryKey: [...BASE_KEY, 'resumen', desde, hasta, tipo, categoria, moneda, cartera],
    queryFn: ({ signal }) => apiGet(`/api/finanzas/reportes/resumen?${params}`, signal),
    // Los roles de operación del libro (finanzas) no ven agregados; tampoco
    // solicitamos un resumen que su interfaz no puede presentar.
    enabled: puedeFinanzas(perfil) && puedeVerSaldos && Boolean(desde && hasta && desde <= hasta),
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
    mutationFn: ({ ids, cuentaCustodiaId }) =>
      apiPost('/api/finanzas/movimientos/reasignar-cuenta', { ids, cuentaCustodiaId }),
    onSuccess: data => {
      showToast.success(`Cuenta asignada a ${data?.actualizados ?? 0} movimiento(s)`)
      client.invalidateQueries({ queryKey: BASE_KEY })
      client.invalidateQueries({ queryKey: ['finanzas', 'cuentas-custodia'] })
    },
    onError: error => showToast.error(error.message || 'No se pudo asignar la cuenta'),
  })
}

export function usePreviewConciliacion() {
  return useMutation({
    mutationFn: ({ desde, hasta, tipo = '', categoria = '', moneda = '', cartera = '' } = {}) => {
      const params = new URLSearchParams({ desde, hasta, limit: '100' })
      if (tipo) params.set('tipo', tipo)
      if (categoria) params.set('categoria', categoria)
      if (moneda) params.set('moneda', moneda)
      if (cartera) params.set('cartera', cartera)
      return apiGet(`/api/finanzas/movimientos/conciliacion-preview?${params}`)
    },
    onError: error => showToast.error(error.message || 'No se pudo simular la conciliación'),
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
    mutationFn: async ({ fecha, desde, hasta, posUrl, distribucion } = {}) => {
      const data = await apiPost('/api/finanzas/sync-pos', { fecha, desde, hasta, posUrl, distribucion, confirm: true })
      if (data?.ok !== true || data.synced !== true || !Array.isArray(data.resultados)) {
        throw new Error('No se confirmó la sincronización. Revisa el estado antes de repetirla.')
      }
      return data
    },
    onSuccess: async data => {
      const total = data.total_ingresos_usd
      const periodoTexto = data.desde === data.hasta ? (data.desde || data.fecha) : `${data.desde} a ${data.hasta}`
      if (total == null || !Number.isFinite(Number(total)) || data.movimientos_sin_usd > 0) {
        showToast.warning(`Movimientos de ${periodoTexto} guardados; valoración USD pendiente. No repitas la importación para corregir tasas.`)
      } else {
        const monto = Number(total).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        showToast.success(`Movimientos de ${periodoTexto} sincronizados. Total del conjunto: $${monto} USD (puede incluir actualizaciones).`)
      }
      await client.invalidateQueries({ queryKey: BASE_KEY })
    },
    onError: error => showToast.error(error.message || 'No se pudo sincronizar con el POS'),
  })
}

