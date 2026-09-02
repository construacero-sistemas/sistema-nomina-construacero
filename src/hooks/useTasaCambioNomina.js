import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'

const TEN_MINUTES = 1000 * 60 * 10

// El Worker cachea las tasas 10 minutos; pedir sin refresh=1 permite que varias
// pantallas y pestañas compartan la misma respuesta (HIT) sin castigar al BCV.
async function fetchTasas({ signal }) {
  const response = await fetch('/api/rates', { cache: 'no-store', signal })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'No se pudieron cargar las tasas')
  return {
    usd: Number(payload.bcv?.price) || 0,
    eur: Number(payload.euro?.price) || 0,
    usdt: Number(payload.usdt?.price) || 0,
    source: payload.source || payload.bcv?.source || '',
    lastUpdate: payload.lastUpdate || null,
    stale: Boolean(payload.stale),
  }
}

export default function useTasaCambioNomina() {
  const query = useQuery({
    queryKey: ['tasas-cambio'],
    queryFn: fetchTasas,
    staleTime: TEN_MINUTES,
    refetchInterval: TEN_MINUTES,
    refetchOnWindowFocus: false,
  })

  const refresh = useCallback(() => query.refetch(), [query.refetch])

  return {
    usd: query.data?.usd || 0,
    eur: query.data?.eur || 0,
    usdt: query.data?.usdt || 0,
    source: query.data?.source || '',
    lastUpdate: query.data?.lastUpdate || null,
    stale: Boolean(query.data?.stale),
    loading: query.isPending,
    error: query.isError ? (query.error?.message || 'No se pudieron cargar las tasas') : '',
    refresh,
  }
}
