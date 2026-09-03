// src/components/finanzas/ResumenPeriodoKpis.jsx
// Tarjetas KPI del resumen financiero con selector de moneda en 1 toque y desglose triple de tesorería (USD, USDT y Bs).
import { BarChart3, Landmark, Wallet } from 'lucide-react'

import KpiCard from '../../../compat/components/ui/KpiCard.jsx'
import { formatNumber, formatUsd } from './formatos.js'

const OPCIONES_MONEDA = [
  { id: '', label: 'Todas (Consolidado)' },
  { id: 'USD', label: 'USD' },
  { id: 'VES', label: 'Bolívares (VES)' },
  { id: 'USDT', label: 'USDT' },
]

function formatSigned(num, prefix = '', suffix = '') {
  const n = Number(num || 0)
  const abs = formatNumber(Math.abs(n))
  if (n < 0) return `-${prefix}${abs}${suffix}`
  return `${prefix}${abs}${suffix}`
}

function DesgloseTriple({ usd = 0, usdt = 0, ves = 0, totalUsdEstimado = 0 }) {
  return (
    <div className="space-y-1.5 pt-1">
      {/* Fila Dólares ($) */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500 font-bold flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
          <span>Dólares ($):</span>
        </span>
        <span className="font-black text-slate-900">{formatSigned(usd, '$')}</span>
      </div>

      {/* Fila USDT */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500 font-bold flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
          <span>USDT:</span>
        </span>
        <span className="font-black text-slate-900">{formatSigned(usdt, '', ' USDT')}</span>
      </div>

      {/* Fila Bolívares (Bs) */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500 font-bold flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" aria-hidden="true" />
          <span>Bolívares (Bs):</span>
        </span>
        <span className="font-black text-slate-900">{formatSigned(ves, 'Bs. ')}</span>
      </div>

      {/* Pie Consolidado Estimado */}
      <div className="pt-2 mt-1 border-t border-slate-100 flex items-center justify-between text-[11px]">
        <span className="text-slate-400 font-medium">≈ Total estimado:</span>
        <span className="font-black text-slate-700">~{formatSigned(totalUsdEstimado, '$', ' USD')}</span>
      </div>
    </div>
  )
}

export default function ResumenPeriodoKpis({ summary, loading, moneda = '', onSelectMoneda }) {
  const esVes = moneda === 'VES'
  const esUsdt = moneda === 'USDT'
  const esUsd = moneda === 'USD'
  const esTodas = !moneda

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
        >
          {esTodas ? (
            <DesgloseTriple
              usd={summary?.ingresos_usd_puro}
              usdt={summary?.ingresos_usdt_puro}
              ves={summary?.ingresos_ves_puro}
              totalUsdEstimado={summary?.ingresos_usd}
            />
          ) : null}
        </KpiCard>
        <KpiCard
          icon={Wallet}
          label={`Gastos ${sufijoLabel}`}
          value={formatVal(summary?.egresos_usd, summary?.egresos_ves)}
          sub={formatSub(summary?.egresos_usd, summary?.egresos_ves)}
          color="red"
          loading={loading}
        >
          {esTodas ? (
            <DesgloseTriple
              usd={summary?.egresos_usd_puro}
              usdt={summary?.egresos_usdt_puro}
              ves={summary?.egresos_ves_puro}
              totalUsdEstimado={summary?.egresos_usd}
            />
          ) : null}
        </KpiCard>
        <KpiCard
          icon={Landmark}
          label={`Flujo neto ${sufijoLabel}`}
          value={formatVal(summary?.balance_usd, summary?.balance_ves)}
          sub={formatSub(summary?.balance_usd, summary?.balance_ves)}
          color={balanceNum >= 0 ? 'blue' : 'red'}
          loading={loading}
        >
          {esTodas ? (
            <DesgloseTriple
              usd={summary?.balance_usd_puro}
              usdt={summary?.balance_usdt_puro}
              ves={summary?.balance_ves_puro}
              totalUsdEstimado={summary?.balance_usd}
            />
          ) : null}
        </KpiCard>
      </div>
    </section>
  )
}
