// src/components/layout/RateHeader.jsx
// Barra de tasas de cambio para la cabecera superior de la aplicación (móvil y desktop).
import { AlertTriangle } from 'lucide-react'
import useTasaCambioNomina from '../../hooks/useTasaCambioNomina.js'
import RateSelector from '../nomina/RateSelector.jsx'

export function RateHeader() {
  const { usd, eur, usdt, loading, stale, error, refresh } = useTasaCambioNomina()
  const format = value => value > 0 ? `${value.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'

  return (
    <div className="flex items-center gap-1.5 md:gap-2 text-[11px]" aria-label="Tasas de cambio">
      <span className="hidden lg:inline text-white/45 font-medium">Tasa Activa:</span>
      <RateSelector />
      <div className="hidden lg:flex items-center gap-1.5 ml-1 text-white/50 text-[10px]">
        <span title="BCV Dólar">USD: {loading ? '...' : format(usd)}</span>
        <span>·</span>
        <span title="BCV Euro">EUR: {loading ? '...' : format(eur)}</span>
        <span>·</span>
        <span title="USDT">USDT: {loading ? '...' : format(usdt)}</span>
      </div>
      {stale && (
        <AlertTriangle
          size={12}
          className="hidden sm:inline text-amber-300 shrink-0"
          aria-label="Se muestra el último valor disponible"
        />
      )}
      {error && (
        <button
          type="button"
          onClick={refresh}
          className="text-red-300 underline text-[10px] p-1 transition-colors hover:text-red-100 active:scale-95"
          style={{ touchAction: 'manipulation' }}
        >
          Reintentar
        </button>
      )}
    </div>
  )
}

export default RateHeader
