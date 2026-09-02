// src/hooks/useMonedaNomina.js
// Hook reactivo para gestión unificada de monedas y tasas en el sistema de Nómina.
// Regla: La moneda principal es SIEMPRE USD ($), y la secundaria es Bs, calculada
// según la tasa activa seleccionada (BCV Dólar, BCV Euro, USDT o Manual).
import { useMemo, useCallback } from 'react'
import useTasaCambioNomina from './useTasaCambioNomina.js'
import { useTasaNominaStore } from '../store/useTasaNominaStore.js'

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

export default function useMonedaNomina() {
  const marketRates = useTasaCambioNomina()
  const { tipoTasa, tasaManual, setTipoTasa, setTasaManual } = useTasaNominaStore()

  // Determinar el valor numérico exacto de la tasa efectiva
  const tasaActiva = useMemo(() => {
    if (tipoTasa === 'bcv_eur') {
      return Number(marketRates.eur) || Number(marketRates.usd) || 0
    }
    if (tipoTasa === 'usdt') {
      return Number(marketRates.usdt) || Number(marketRates.usd) || 0
    }
    if (tipoTasa === 'manual') {
      return Number(tasaManual) > 0 ? Number(tasaManual) : (Number(marketRates.usd) || 0)
    }
    // Default: bcv_usd
    return Number(marketRates.usd) || 0
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
