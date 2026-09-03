// src/components/finanzas/ResumenPeriodoKpis.jsx
// Tarjetas KPI del resumen financiero con selector de moneda en 1 toque (Consolidado / USD / VES / USDT).
import { BarChart3, Landmark, Wallet } from 'lucide-react'

import KpiCard from '../../../compat/components/ui/KpiCard.jsx'
import { formatNumber, formatUsd } from './formatos.js'

const OPCIONES_MONEDA = [
  { id: '', label: 'Todas (Consolidado)' },
  { id: 'USD', label: 'USD' },
  { id: 'VES', label: 'Bolívares (VES)' },
  { id: 'USDT', label: 'USDT' },
]

export default function ResumenPeriodoKpis({ summary, loading, moneda = '', onSelectMoneda }) {
  const esVes = moneda === 'VES'
  const esUsdt = moneda === 'USDT'
  const esUsd = moneda === 'USD'

  // Configuración dinámica de etiquetas y valores según moneda activa
  const formatVal = (valUsd, valVes) => {
    if (esVes) return `Bs. ${formatNumber(valVes)}`
    if (esUsdt) return `${formatNumber(valUsd)} USDT`
    return formatUsd(valUsd)
  }

  const formatSub = (valUsd, valVes) => {
    if (esVes) return Number(valUsd) > 0 ? `~${formatUsd(valUsd)} equiv.` : null
    if (esUsd || esUsdt) return Number(valVes) > 0 ? `Bs. ${formatNumber(valVes)} equiv.` : null
    return `Bs. ${formatNumber(valVes)}`
  }

  const sufijoLabel = esVes ? 'en Bolívares' : esUsd ? 'en Dólares' : esUsdt ? 'en USDT' : 'del período'
  const balanceNum = esVes ? Number(summary?.balance_ves || 0) : Number(summary?.balance_usd || 0)

  return (
    <section aria-label="Resumen financiero" className="space-y-2.5">
      {/* Selector de píldoras por moneda */}
      {onSelectMoneda && (
        <div
          className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/60 border border-slate-200 rounded-2xl"
          role="group"
          aria-label="Filtro de moneda para el resumen"
        >
          {OPCIONES_MONEDA.map(opt => {
            const activo = moneda === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onSelectMoneda(opt.id)}
                aria-pressed={activo}
                className={`inline-flex items-center justify-center px-3 py-2 min-h-11 rounded-xl text-xs font-black transition-all cursor-pointer flex-1 sm:flex-none ${
                  activo
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
                style={{ touchAction: 'manipulation' }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Tarjetas KPI adaptativas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          icon={BarChart3}
          label={`Ingresos ${sufijoLabel}`}
          value={formatVal(summary?.ingresos_usd, summary?.ingresos_ves)}
          sub={formatSub(summary?.ingresos_usd, summary?.ingresos_ves)}
          color="green"
          loading={loading}
        />
        <KpiCard
          icon={Wallet}
          label={`Gastos ${sufijoLabel}`}
          value={formatVal(summary?.egresos_usd, summary?.egresos_ves)}
          sub={formatSub(summary?.egresos_usd, summary?.egresos_ves)}
          color="red"
          loading={loading}
        />
        <KpiCard
          icon={Landmark}
          label={`Flujo neto ${sufijoLabel}`}
          value={formatVal(summary?.balance_usd, summary?.balance_ves)}
          sub={formatSub(summary?.balance_usd, summary?.balance_ves)}
          color={balanceNum >= 0 ? 'blue' : 'red'}
          loading={loading}
        />
      </div>
    </section>
  )
}
