// src/hooks/useMonedaNomina.js
// Hook reactivo para gestión unificada de monedas y tasas en el sistema de Nómina.
// Regla: La moneda principal es SIEMPRE USD ($), y la secundaria es Bs, calculada
// según la tasa activa seleccionada (BCV Dólar, BCV Euro, USDT o Manual).
//
// La tasa MANUAL es única por cuenta y vive en el servidor (trazable: quién, cuándo
// y por qué); el localStorage solo conserva un respaldo local. Cuando la tasa
// elegida no tiene dato de mercado, se usa la del BCV dólar y se avisa con
// `tasaFallback` para que la interfaz nunca muestre un número mentiroso.
import { useMemo, useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import useTasaCambioNomina from './useTasaCambioNomina.js'
import { useTasaNominaStore } from '../store/useTasaNominaStore.js'
import { apiGet, apiPost } from './nominaApi.js'

export function formatUsd(n) {
  return `$${(Number(n) || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatBs(n) {
  return `Bs ${(Number(n) || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export const OPCIONES_TASA = [
  { id: 'bcv_usd', label: 'BCV Dólar ($)', shortLabel: 'BCV $' },
  { id: 'bcv_eur', label: 'BCV Euro (€)',  shortLabel: 'BCV €' },
  { id: 'usdt',    label: 'USDT (Paralelo)', shortLabel: 'USDT' },
  { id: 'manual',  label: 'Tasa Manual',    shortLabel: 'Manual' },
]

const KEY_TASA_MANUAL = ['nomina', 'tasa-manual']

export default function useMonedaNomina() {
  const marketRates = useTasaCambioNomina()
  const { tipoTasa, tasaManual: tasaManualLocal, setTipoTasa, setTasaManual, hidratarTasaManual } = useTasaNominaStore()
  const queryClient = useQueryClient()

  // Tasa manual del servidor (una por cuenta, con quién/cuándo/por qué). Si la
  // consulta falla (sin red, permisos), se usa el respaldo local en silencio.
  const tasaManualQuery = useQuery({
    queryKey: KEY_TASA_MANUAL,
    queryFn: () => apiGet('/api/nomina/tasa-manual'),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  })
  const tasaManualInfo = tasaManualQuery.data?.tasa || null
  const tasaManualServidor = Number(tasaManualInfo?.valor) || 0

  useEffect(() => {
    if (tasaManualServidor > 0) hidratarTasaManual(tasaManualServidor)
  }, [tasaManualServidor, hidratarTasaManual])

  const tasaManual = tasaManualServidor > 0 ? tasaManualServidor : Number(tasaManualLocal) || 0

  const guardarTasaManual = useMutation({
    mutationFn: ({ valor, motivo }) => apiPost('/api/nomina/tasa-manual', { valor, motivo }),
    onSuccess: data => {
      queryClient.setQueryData(KEY_TASA_MANUAL, { tasa: data?.tasa || null })
      const valor = Number(data?.tasa?.valor) || 0
      if (valor > 0) setTasaManual(valor) // también activa tipoTasa = 'manual'
    },
  })

  const fijarTasaManual = useCallback(
    (valor, motivo) => guardarTasaManual.mutateAsync({ valor, motivo }),
    [guardarTasaManual],
  )

  // Determinar el valor numérico exacto de la tasa efectiva
  const tasaActiva = useMemo(() => {
    if (tipoTasa === 'bcv_eur') {
      return Number(marketRates.eur) || Number(marketRates.usd) || 0
    }
    if (tipoTasa === 'usdt') {
      return Number(marketRates.usdt) || Number(marketRates.usd) || 0
    }
    if (tipoTasa === 'manual') {
      return tasaManual > 0 ? tasaManual : (Number(marketRates.usd) || 0)
    }
    // Default: bcv_usd
    return Number(marketRates.usd) || 0
  }, [tipoTasa, tasaManual, marketRates.usd, marketRates.eur, marketRates.usdt])

  // Aviso de respaldo: si la tasa elegida no tiene dato, el número mostrado
  // viene del BCV dólar y hay que decirlo (no mostrar un valor mentiroso).
  const tasaFallback = useMemo(() => {
    const usd = Number(marketRates.usd) || 0
    const elegida = tipoTasa === 'bcv_eur' ? Number(marketRates.eur) || 0
      : tipoTasa === 'usdt' ? Number(marketRates.usdt) || 0
      : tipoTasa === 'manual' ? tasaManual
      : usd
    if (elegida > 0) return null
    return usd > 0 ? 'bcv_usd' : 'sin_datos'
  }, [tipoTasa, tasaManual, marketRates.usd, marketRates.eur, marketRates.usdt])

  const nombreTasa = useMemo(() => {
    const opt = OPCIONES_TASA.find(o => o.id === tipoTasa)
    return opt?.label || 'BCV Dólar ($)'
  }, [tipoTasa])

  const shortLabelTasa = useMemo(() => {
    const opt = OPCIONES_TASA.find(o => o.id === tipoTasa)
    return opt?.shortLabel || 'BCV $'
  }, [tipoTasa])

  // Convertir USD -> Bs con la tasa activa
  const aBs = useCallback((montoUsd) => {
    return (Number(montoUsd) || 0) * tasaActiva
  }, [tasaActiva])

  // Formateadores rápidos
  const fmtUsd = useCallback((montoUsd) => {
    return formatUsd(montoUsd)
  }, [])

  const fmtBs = useCallback((montoUsd) => {
    const bs = aBs(montoUsd)
    return formatBs(bs)
  }, [aBs])

  const fmtDual = useCallback((montoUsd) => {
    const usdStr = formatUsd(montoUsd)
    if (tasaActiva > 0) {
      const bsStr = formatBs(aBs(montoUsd))
      return `${usdStr} · ${bsStr}`
    }
    return usdStr
  }, [tasaActiva, aBs])

  return {
    // Configuración y estado de tasas
    tipoTasa,
    setTipoTasa,
    tasaManual,
    setTasaManual,
    tasaActiva,
    nombreTasa,
    shortLabelTasa,
    opcionesTasa: OPCIONES_TASA,

    // Tasa manual trazable (servidor): quién la fijó, cuándo y por qué
    tasaManualInfo,
    fijarTasaManual,
    guardandoTasaManual: guardarTasaManual.isPending,
    errorTasaManual: guardarTasaManual.error?.message || '',

    // 'bcv_usd' si la tasa elegida no tiene dato y se muestra la del dólar BCV;
    // 'sin_datos' si no hay ninguna tasa disponible; null si todo es real.
    tasaFallback,

    // Tasas disponibles del mercado
    tasasMercado: {
      bcv_usd: marketRates.usd,
      bcv_eur: marketRates.eur,
      usdt: marketRates.usdt,
      manual: tasaManual,
    },

    // Conversión y formateo
    aBs,
    fmtUsd,
    fmtBs,
    fmtDual,

    // Metadatos de la API
    loading: marketRates.loading,
    error: marketRates.error,
    lastUpdate: marketRates.lastUpdate,
    stale: marketRates.stale,
    refresh: marketRates.refresh,
  }
}
