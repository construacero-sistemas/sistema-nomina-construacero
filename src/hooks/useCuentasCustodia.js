// Catálogo y saldo son lecturas distintas. Nunca calcular fondos desde la página visible.
import { useCallback, useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useAccountQuery as useQuery, useAccountQueryClient as useQueryClient } from '../../compat/lib/accountQueries.js'
import useAuthStore from '../../compat/store/useAuthStore.js'
import { authFetch } from '../../compat/services/authFetch.js'
import { showToast } from '../../compat/components/ui/toastBus.js'
import { tieneCapacidad } from '../config/accesoModulos.js'
export { BANCOS_VENEZUELA, PLATAFORMAS_INTERNACIONALES } from '../utils/cuentasCustodiaUtils.js'

const BASE_KEY = ['finanzas', 'cuentas-custodia']
async function api(path, body, signal) {
  const response = await authFetch(path, body === undefined ? { signal } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(payload.error || 'No se pudieron cargar las cuentas.'), { code: payload.code, status: response.status })
  return payload
}

export function useCuentasCustodia() {
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  const queryClient = useQueryClient()
  // Finanzas/Nómina necesitan solo el catálogo operativo para elegir cuenta al
  // registrar movimientos o pagar recibos. Los importes siguen reservados a
  // verSaldos y el servidor devuelve metadatos mínimos para estos roles.
  const puedeVerCatalogo = tieneCapacidad(perfil, 'verFinanzas') || tieneCapacidad(perfil, 'administrarNomina')
  const puedeVerSaldos = tieneCapacidad(perfil, 'verSaldos')
  const query = useQuery({
    queryKey: BASE_KEY,
    queryFn: ({ signal }) => api('/api/finanzas/cuentas-custodia', undefined, signal),
    enabled: puedeVerCatalogo || puedeVerSaldos, staleTime: 60000, retry: 1,
  })
  const saldos = useQuery({
    queryKey: ['finanzas', 'saldos'],
    queryFn: ({ signal }) => api('/api/finanzas/saldos', undefined, signal),
    enabled: puedeVerSaldos, staleTime: 0, retry: 1,
  })
  const cuentas = useMemo(() => {
    const available = puedeVerSaldos && !saldos.isError
      ? new Map((saldos.data?.cuentas || []).map(c => [c.cuentaCustodiaId, c]))
      : new Map()
    return (query.data?.cuentas || []).map(c => {
      const balance = available.get(c.id)
      const amountValid = !!balance && balance.saldoNativo != null && balance.saldoNativo !== '' && Number.isFinite(Number(balance.saldoNativo))
      const confirmed = amountValid && !saldos.isFetching && balance.conciliacion === 'confirmada' && saldos.data?.conciliacionPendiente === false
      return { ...c, saldo: amountValid ? Number(balance.saldoNativo) : null, saldoConfirmado: confirmed,
        disponible: confirmed && balance.disponible, valorUsd: balance?.valorUsd == null ? null : Number(balance.valorUsd),
        valoracionCompleta: balance?.valoracionCompleta === true, conciliacion: confirmed ? 'confirmada' : 'pendiente' }
    })
  }, [query.data, saldos.data, saldos.isError, saldos.isFetching, puedeVerSaldos])
  function mutation(path, message) {
    return {
      mutationFn: fields => api(path, fields),
      onSuccess: async () => {
        showToast.success(message)
        // Persistencia de datos protegidos deshabilitada por defecto. Solo la
        // respuesta confirmada refresca el catálogo en memoria, sin fantasmas.
        await queryClient.invalidateQueries({ queryKey: ['finanzas'] })
      },
      onError: error => showToast.error(error.message),
    }
  }
  const crear = useMutation(mutation('/api/finanzas/cuentas-custodia/crear', 'Cuenta creada'))
  const editar = useMutation(mutation('/api/finanzas/cuentas-custodia/actualizar', 'Cuenta actualizada'))
  const eliminar = useMutation(mutation('/api/finanzas/cuentas-custodia/eliminar', 'Cuenta eliminada. Puedes restaurarla desde la papelera.'))
  const restaurar = useMutation(mutation('/api/finanzas/cuentas-custodia/restaurar-una', 'Cuenta restaurada'))
  const descartar = useMutation(mutation('/api/finanzas/cuentas-custodia/descartar', 'Cuenta descartada de la papelera'))
  const defaults = useMutation(mutation('/api/finanzas/cuentas-custodia/restaurar', 'Cuentas restauradas'))
  return {
    cuentas,
    cuentasEliminadas: query.data?.eliminadas || [],
    cargando: query.isPending,
    error: query.isError ? query.error.message : '',
    saldos: puedeVerSaldos ? saldos.data || null : null,
    saldosCargando: puedeVerSaldos && (saldos.isPending || saldos.isFetching),
    saldosError: puedeVerSaldos && saldos.isError ? saldos.error.message : '',
    conciliacionPendiente: puedeVerSaldos && saldos.data?.conciliacionPendiente !== false,
    refetch: () => Promise.all([query.refetch(), saldos.refetch()]),
    agregarCuenta: nueva => crear.mutateAsync(nueva),
    editarCuenta: (id, updates) => editar.mutateAsync({ id, ...updates }),
    eliminarCuenta: id => eliminar.mutateAsync({ id }),
    restaurarCuentaEliminada: id => restaurar.mutateAsync({ id }),
    descartarCuentaEliminada: id => descartar.mutateAsync({ id, todos: false }),
    vaciarPapelera: () => descartar.mutateAsync({ todos: true }),
    restaurarPredeterminadas: () => defaults.mutateAsync({}),
  }
}
