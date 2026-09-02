// compat/components/ui/KpiCard.jsx
// Tarjeta KPI compartida: un solo look para Nómina y Finanzas (antes había 5 copias).
const COLORS = {
  indigo: 'bg-indigo-50 text-indigo-700',
  slate: 'bg-slate-50 text-slate-700',
  amber: 'bg-amber-50 text-amber-700',
  green: 'bg-green-50 text-green-700',
  red: 'bg-red-50 text-red-600',
  blue: 'bg-blue-50 text-blue-700',
}

export default function KpiCard({ icon: Icon, label, value, color = 'slate', sub, loading = false }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <span className={`w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-lg sm:rounded-xl flex items-center justify-center ${COLORS[color] || COLORS.slate}`}>
          <Icon size={16} />
        </span>
        <span className="text-xs text-slate-500 font-bold">{label}</span>
      </div>
      {loading ? (
        <div className="h-7 w-24 mt-3 rounded bg-slate-100 animate-pulse" aria-hidden="true" />
      ) : (
        <>
          <div className="mt-2 sm:mt-3 text-lg sm:text-xl font-black text-slate-800 break-words">{value}</div>
          {sub ? <div className="mt-1 text-[10px] sm:text-[11px] text-slate-400">{sub}</div> : null}
        </>
      )}
    </div>
  )
}
