import { BarChart3, Landmark, Wallet } from 'lucide-react'
import KpiCard from '../../../compat/components/ui/KpiCard.jsx'
import { formatNumber } from './formatos.js'

const monedas = [{ id: '', label: 'Todas (Consolidado)' }, { id: 'USD', label: 'USD' }, { id: 'VES', label: 'Bolívares (VES)' }, { id: 'USDT', label: 'USDT' }]
const money = n => n == null || !Number.isFinite(Number(n)) ? 'Sin confirmar' : formatNumber(n)
export default function ResumenPeriodoKpis({ summary, loading, moneda = '', onSelectMoneda }) {
  const completos = summary && !summary.movimientos_sin_usd
  return <section aria-label="Resumen financiero" className="space-y-3">
    {onSelectMoneda && <div role="group" aria-label="Filtro de moneda para el resumen" className="flex flex-wrap gap-2 bg-slate-100 p-2 border border-slate-200 rounded-2xl">
      {monedas.map(o => <button key={o.id} type="button" aria-pressed={o.id === moneda} onClick={() => onSelectMoneda(o.id)} className={`min-h-11 px-3 py-2 rounded-xl text-sm font-bold ${o.id === moneda ? 'bg-white text-slate-900 border border-slate-300' : 'text-slate-700'}`}>{o.label}</button>)}
    </div>}
    {!loading && !summary && <p className="p-3 border border-slate-200 rounded-xl text-slate-700 text-sm" role="status">Resumen sin confirmar. No se muestran importes en cero por un fallo de lectura.</p>}
    {summary?.movimientos_sin_usd > 0 && <p role="status" className="p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">{summary.movimientos_sin_usd} movimiento(s) sin tasa histórica. El consolidado USD está pendiente de valoración.</p>}
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {[['ingresos', 'Ingresos del período', BarChart3, 'green'], ['egresos', 'Gastos del período', Wallet, 'red'], ['balance', 'Flujo neto del período', Landmark, 'blue']].map(([key, label, Icon, color]) => <KpiCard key={key} icon={Icon} label={label} color={color} loading={loading}>
        <p className="text-lg font-black text-slate-900">{completos ? `$${money(summary[`${key}_usd`])} USD` : 'Consolidado pendiente'}</p>
        <dl className="space-y-1 mt-2 text-sm text-slate-700">
          <div className="flex flex-wrap justify-between gap-1"><dt>Dólares ($)</dt><dd className="font-bold">{money(summary?.[`${key}_usd_puro`])}</dd></div>
          <div className="flex flex-wrap justify-between gap-1"><dt>USDT</dt><dd className="font-bold">{money(summary?.[`${key}_usdt_puro`])}</dd></div>
          <div className="flex flex-wrap justify-between gap-1"><dt>Bolívares (Bs)</dt><dd className="font-bold">{money(summary?.[`${key}_ves_puro`])}</dd></div>
        </dl>
        <p className="text-xs text-slate-600 mt-2">Valoración con las tasas guardadas. Traspasos internos fuera del flujo operativo.</p>
      </KpiCard>)}
    </div>
  </section>
}
