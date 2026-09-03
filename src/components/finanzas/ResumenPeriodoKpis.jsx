// src/components/finanzas/ResumenPeriodoKpis.jsx
// Tarjetas KPI del resumen del período en Finanzas (ingresos, gastos, flujo neto).
import { BarChart3, Landmark, Wallet } from 'lucide-react'

import KpiCard from '../../../compat/components/ui/KpiCard.jsx'
import { formatNumber, formatUsd } from './formatos.js'

/** KPIs del resumen del período — `summary` y `loading` vienen del hook de resumen. */
export default function ResumenPeriodoKpis({ summary, loading }) {
  return (
    <section aria-label="Resumen financiero" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <KpiCard icon={BarChart3} label="Ingresos del período" value={formatUsd(summary?.ingresos_usd)} sub={`Bs. ${formatNumber(summary?.ingresos_ves)}`} color="green" loading={loading} />
      <KpiCard icon={Wallet} label="Gastos del período" value={formatUsd(summary?.egresos_usd)} sub={`Bs. ${formatNumber(summary?.egresos_ves)}`} color="red" loading={loading} />
      <KpiCard
        icon={Landmark}
        label="Flujo neto del período"
        value={formatUsd(summary?.balance_usd)}
        sub={`Bs. ${formatNumber(summary?.balance_ves)}`}
        color={Number(summary?.balance_usd) >= 0 ? 'blue' : 'red'}
        loading={loading}
      />
    </section>
  )
}
