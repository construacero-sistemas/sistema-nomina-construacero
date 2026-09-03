// src/hooks/useCuentasCustodia.js
// Gestión de cuentas bancarias y billeteras de custodia PERSISTIDAS en Supabase
// (tabla cuentas_custodia) a través del backend, con fallback local.
//
// Antes vivían solo en localStorage; ahora se comparten entre dispositivos.
// Estrategia:
//   1. Cargar desde `/api/finanzas/cuentas-custodia` (fuente de verdad).
//   2. Mientras carga o si el backend no responde, usar un cache en localStorage
//      con las cuentas semilla por defecto (fallback offline).
//   3. El saldo se calcula en cliente asignando cada movimiento a su cuenta
//      explícita (sin doble conteo).
import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import useAuthStore from '../../compat/store/useAuthStore.js'
import { authFetch } from '../../compat/services/authFetch.js'
import { showToast } from '../../compat/components/ui/toastBus.js'
import { asignarMovimientoACuenta } from '../utils/carterasHelper.js'
import { CUENTAS_DEFAULT } from '../utils/cuentasCustodiaUtils.js'

export { BANCOS_VENEZUELA, PLATAFORMAS_INTERNACIONALES } from '../utils/cuentasCustodiaUtils.js'

const BASE_KEY = ['finanzas', 'cuentas-custodia']
const ADMIN_ROLE = 'administracion'

function puedeFinanzas(perfil) {
  return perfil?.rol === ADMIN_ROLE
}

function storageKey(cuentaId) {
  return `nomina_cuentas_custodia_${cuentaId}`
}

function readLocalCache(cuentaId) {
  try {
    const saved = localStorage.getItem(storageKey(cuentaId))
    if (saved) {
      const parsed = JSON.parse(saved)
      // Una lista vacía en cache es válida: el tenant eliminó todas sus cuentas.
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    // fallback
  }
  return null
}

function writeLocalCache(cuentaId, cuentas) {
  try {
    localStorage.setItem(storageKey(cuentaId), JSON.stringify(cuentas))
  } catch {
    // ignore
  }
}

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

export function useCuentasCustodia(movimientos = []) {
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  const cuentaId = perfil?.cuenta_id || 'default'
  const puede = puedeFinanzas(perfil)
  const queryClient = useQueryClient()

  // Lista de cuentas desde el backend (fuente de verdad). Mientras carga o si
  // falla, se usa el cache local: primero localStorage, luego las semillas.
  const query = useQuery({
    queryKey: [...BASE_KEY, cuentaId],
    queryFn: async () => {
      const data = await apiGet('/api/finanzas/cuentas-custodia')
      // Cachear la última versión vista (incluida la vacía) para el fallback offline.
      if (Array.isArray(data?.cuentas)) {
        writeLocalCache(cuentaId, data.cuentas)
      }
      return data
    },
    enabled: puede && Boolean(cuentaId),
    staleTime: 1000 * 60 * 10,
    // Placeholder con la MISMA forma que la respuesta del API. Un cache vacío
    // ([]) se respeta; sin cache se muestran las semillas mientras carga.
    placeholderData: () => ({ cuentas: readLocalCache(cuentaId) ?? CUENTAS_DEFAULT }),
    retry: 1,
  })

  // Fuente de verdad con fallback: backend > localStorage > semillas.
  // IMPORTANTE: una lista VACÍA del servidor es un estado válido (el tenant
  // eliminó todas sus cuentas) y NO dispara el fallback — solo el error o la
  // carga inicial usan el cache local/semillas.
  const cuentasBase = useMemo(() => {
    if (query.isSuccess) {
      const server = query.data?.cuentas
      return Array.isArray(server) ? server : []
    }
    // Cargando o error: mostrar algo útil mientras tanto.
    return readLocalCache(cuentaId) || CUENTAS_DEFAULT
  }, [query.isSuccess, query.data, cuentaId])
  // Mutaciones que invalidan la query para refrescar desde el backend.
  const crearMutation = useMutation({
    mutationFn: fields => apiPost('/api/finanzas/cuentas-custodia/crear', fields),
    onSuccess: () => {
      showToast.success('Cuenta creada')
      queryClient.invalidateQueries({ queryKey: [...BASE_KEY, cuentaId] })
    },
    onError: error => showToast.error(error.message || 'No se pudo crear la cuenta'),
  })

  const actualizarMutation = useMutation({
    mutationFn: ({ id, ...fields }) => apiPost('/api/finanzas/cuentas-custodia/actualizar', { id, ...fields }),
    onSuccess: () => {
      showToast.success('Cuenta actualizada')
      queryClient.invalidateQueries({ queryKey: [...BASE_KEY, cuentaId] })
    },
    onError: error => showToast.error(error.message || 'No se pudo actualizar la cuenta'),
  })

  const eliminarMutation = useMutation({
    mutationFn: id => apiPost('/api/finanzas/cuentas-custodia/eliminar', { id }),
    onSuccess: () => {
      showToast.success('Cuenta eliminada. Puedes restaurarla desde la papelera.')
      queryClient.invalidateQueries({ queryKey: [...BASE_KEY, cuentaId] })
    },
    onError: error => showToast.error(error.message || 'No se pudo eliminar la cuenta'),
  })

  const restaurarUnaMutation = useMutation({
    mutationFn: id => apiPost('/api/finanzas/cuentas-custodia/restaurar-una', { id }),
    onSuccess: () => {
      showToast.success('Cuenta restaurada')
      queryClient.invalidateQueries({ queryKey: [...BASE_KEY, cuentaId] })
    },
    onError: error => showToast.error(error.message || 'No se pudo restaurar la cuenta'),
  })

  // Callbacks de uso en la UI: aplican optimista en localStorage y luego llaman al backend.
  const agregarCuenta = useCallback((nueva) => {
    const id = `cuenta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const optimista = { ...nueva, id, predeterminada: false, activo: true }
    writeLocalCache(cuentaId, [...(readLocalCache(cuentaId) || CUENTAS_DEFAULT), optimista])
    return crearMutation.mutateAsync(nueva)
  }, [cuentaId, crearMutation])

  const editarCuenta = useCallback((id, updates) => {
    const base = readLocalCache(cuentaId) || CUENTAS_DEFAULT
    writeLocalCache(cuentaId, base.map(c => c.id === id ? { ...c, ...updates } : c))
    return actualizarMutation.mutateAsync({ id, ...updates })
  }, [cuentaId, actualizarMutation])

  const eliminarCuenta = useCallback((id) => {
    const base = readLocalCache(cuentaId) || CUENTAS_DEFAULT
    writeLocalCache(cuentaId, base.filter(c => c.id !== id))
    return eliminarMutation.mutateAsync(id)
  }, [cuentaId, eliminarMutation])

  const restaurarCuentaEliminada = useCallback((id) => {
    return restaurarUnaMutation.mutateAsync(id)
  }, [restaurarUnaMutation])

  const restaurarPredeterminadas = useCallback(() => {
    writeLocalCache(cuentaId, CUENTAS_DEFAULT)
    return apiPost('/api/finanzas/cuentas-custodia/restaurar', {}).then(() => {
      queryClient.invalidateQueries({ queryKey: [...BASE_KEY, cuentaId] })
      showToast.success('Cuentas restauradas')
    }).catch(error => showToast.error(error.message || 'No se pudieron restaurar las cuentas'))
  }, [cuentaId, queryClient])

  // Calcular saldos de cada cuenta asignando cada movimiento a su cuenta explícita.
  // Un movimiento sin cuenta explícita no se suma a ninguna (vive en su subcuenta).
  const cuentasConSaldos = useMemo(() => {
    const saldosPorCuenta = new Map()
    for (const mov of movimientos) {
      if (mov.estado === 'anulado') continue
      const cuentaAsignada = asignarMovimientoACuenta(mov, cuentasBase)
      if (!cuentaAsignada) continue
      const monedaCuenta = cuentaAsignada.moneda || mov.moneda || 'USD'
      const monto = monedaCuenta === 'VES'
        ? (Number(mov.monto_ves) || Number(mov.monto) || 0)
        : (Number(mov.monto) || 0)
      const prev = saldosPorCuenta.get(cuentaAsignada.id) || { entradas: 0, salidas: 0 }
      if (mov.tipo === 'ingreso') prev.entradas += monto
      else prev.salidas += monto
      saldosPorCuenta.set(cuentaAsignada.id, prev)
    }
    return cuentasBase.map(cuenta => {
      const prev = saldosPorCuenta.get(cuenta.id) || { entradas: 0, salidas: 0 }
      const saldo = prev.entradas - prev.salidas
      return {
        ...cuenta,
        saldo: Number(saldo.toFixed(2)),
        entradas: Number(prev.entradas.toFixed(2)),
        salidas: Number(prev.salidas.toFixed(2)),
      }
    })
  }, [cuentasBase, movimientos])

  return {
    cuentas: cuentasConSaldos,
    // Papelera: cuentas eliminadas (borrado lógico) que se pueden restaurar.
    cuentasEliminadas: Array.isArray(query.data?.eliminadas) ? query.data.eliminadas : [],
    cargando: query.isPending,
    agregarCuenta,
    editarCuenta,
    eliminarCuenta,
    restaurarCuentaEliminada,
    restaurarPredeterminadas,
  }
}
