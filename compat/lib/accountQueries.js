// Las claves privadas siempre pertenecen a la identidad autenticada.
import { useMemo } from 'react'
import { useQuery as useBaseQuery, useInfiniteQuery as useBaseInfiniteQuery, useQueryClient as useBaseClient } from '@tanstack/react-query'
import useAuthStore from '../store/useAuthStore.js'

export function accountQueryKey(accountId, key = []) {
  return ['account', accountId || 'unauthenticated', ...key]
}

function useAccountId() {
  return useAuthStore(state => state.accountId || state.perfil?.cuenta_id || state.user?.id || null)
}

export function useAccountQuery(options) {
  const accountId = useAccountId()
  return useBaseQuery({ ...options, queryKey: accountQueryKey(accountId, options.queryKey),
    queryFn: async context => {
      const result = await options.queryFn(context)
      const current = useAuthStore.getState()
      if ((current.accountId || current.perfil?.cuenta_id || current.user?.id) !== accountId) throw new DOMException('La cuenta cambió', 'AbortError')
      return result
    }, enabled: !!accountId && options.enabled !== false })
}

export function useAccountInfiniteQuery(options) {
  const accountId = useAccountId()
  return useBaseInfiniteQuery({ ...options, queryKey: accountQueryKey(accountId, options.queryKey),
    queryFn: async context => {
      const result = await options.queryFn(context)
      const current = useAuthStore.getState()
      if ((current.accountId || current.perfil?.cuenta_id || current.user?.id) !== accountId) throw new DOMException('La cuenta cambi\u00f3', 'AbortError')
      return result
    }, enabled: !!accountId && options.enabled !== false })
}

export function useAccountQueryClient() {
  const client = useBaseClient()
  const accountId = useAccountId()
  return useMemo(() => {
    const filters = (value = {}) => ({ ...value, queryKey: accountQueryKey(accountId, value.queryKey) })
    return {
      invalidateQueries: value => client.invalidateQueries(filters(value)),
      refetchQueries: value => client.refetchQueries(filters(value)),
      cancelQueries: value => client.cancelQueries(filters(value)),
      removeQueries: value => client.removeQueries(filters(value)),
      setQueryData: (key, update) => client.setQueryData(accountQueryKey(accountId, key), update),
      getQueryData: key => client.getQueryData(accountQueryKey(accountId, key)),
    }
  }, [client, accountId])
}
