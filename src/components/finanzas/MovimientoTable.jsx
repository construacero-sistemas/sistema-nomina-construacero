// src/components/finanzas/MovimientoTable.jsx
// Presentación responsive del libro; no calcula ni muta importes en el cliente.
import { Ban, CalendarDays, Eye } from 'lucide-react'

function money(value, currency) {
  return `${Number(value || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${currency}`
}

function date(value) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function MovimientoTable({ movimientos, onAnular }) {
  return <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2"><div><h2 className="text-sm font-black text-slate-800">Movimientos</h2><p className="text-[11px] text-slate-400">{movimientos.length} registro(s) en la página</p></div><CalendarDays size={17} className="text-slate-400" /></div>
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full min-w-[860px] text-xs" aria-label="Movimientos financieros"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400"><tr><th className="px-4 py-3 text-left">Fecha</th><th className="px-4 py-3 text-left">Tipo</th><th className="px-4 py-3 text-left">Categoría / concepto</th><th className="px-4 py-3 text-right">Monto</th><th className="px-4 py-3 text-right">Total VES</th><th className="px-4 py-3 text-left">Estado</th><th className="px-4 py-3" /></tr></thead><tbody>{movimientos.map(item => <DesktopRow key={item.id} item={item} onAnular={onAnular} />)}</tbody></table>
    </div>
    <div className="md:hidden divide-y divide-slate-100">{movimientos.map(item => <MobileRow key={item.id} item={item} onAnular={onAnular} />)}</div>
  </div>
}

function DesktopRow({ item, onAnular }) {
  const activo = item.estado === 'activo'
  return <tr className="border-t border-slate-100 hover:bg-slate-50/70"><td className="px-4 py-3 text-slate-500">{date(item.fecha)}</td><td className="px-4 py-3"><TypeBadge type={item.tipo} /></td><td className="px-4 py-3 max-w-[260px]"><p className="truncate font-bold text-slate-700">{item.concepto}</p><p className="truncate text-[11px] text-slate-400">{item.categoria}</p></td><td className="px-4 py-3 text-right font-bold text-slate-700">{money(item.monto, item.moneda)}</td><td className="px-4 py-3 text-right font-black text-slate-800">{money(item.monto_ves, 'VES')}</td><td className="px-4 py-3"><StateBadge state={item.estado} /></td><td className="px-4 py-3 text-right">{activo && <button type="button" onClick={() => onAnular(item)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-50" title="Anular movimiento"><Ban size={13} /> Anular</button>}</td></tr>
}

function MobileRow({ item, onAnular }) {
  const activo = item.estado === 'activo'
  return <article className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black text-slate-800">{item.concepto}</p><p className="mt-0.5 truncate text-xs text-slate-500">{item.categoria} · {date(item.fecha)}</p></div><TypeBadge type={item.tipo} /></div><div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3"><Metric label="Monto" value={money(item.monto, item.moneda)} /><Metric label="Total VES" value={money(item.monto_ves, 'VES')} accent={item.tipo === 'ingreso'} /></div><div className="mt-3 flex items-center justify-between gap-2"><StateBadge state={item.estado} />{activo ? <button type="button" onClick={() => onAnular(item)} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-red-600 hover:bg-red-50"><Ban size={14} /> Anular</button> : <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Eye size={13} /> Conservado</span>}</div></article>
}

function Metric({ label, value, accent }) {
  return <div><p className="text-[10px] font-medium text-slate-400">{label}</p><p className={`mt-0.5 truncate text-sm font-black ${accent ? 'text-green-600' : 'text-slate-700'}`}>{value}</p></div>
}

function TypeBadge({ type }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${type === 'ingreso' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{type}</span>
}

function StateBadge({ state }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${state === 'activo' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>{state}</span>
}
