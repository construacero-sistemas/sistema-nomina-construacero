// src/components/nomina/TabHistorial.jsx
// Períodos ya pagados — consulta y reimpresión de recibos (solo lectura).
import { useState, useMemo } from 'react'
import { Archive, Eye, Calendar, DollarSign, Users } from 'lucide-react'
import { useNominaPeriodos } from '../../hooks/useNomina'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import EmptyState from '../../../compat/components/ui/EmptyState.jsx'
import PeriodoDetalleModal from './PeriodoDetalleModal'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtFecha(f) {
  return new Date(`${f}T12:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function TabHistorial() {
  const { data: periodos = [], isLoading, isError, refetch } = useNominaPeriodos()
  const [detalle, setDetalle] = useState(null)
  const [anio, setAnio] = useState('todos')

  const pagados = useMemo(
    () => periodos.filter(p => p.estado === 'pagado'),
    [periodos]
  )

  const anios = useMemo(() => {
    const set = new Set(pagados.map(p => new Date(`${p.desde}T12:00:00`).getFullYear()))
    return [...set].sort((a, b) => b - a)
  }, [pagados])

  const filtrados = useMemo(() => {
    if (anio === 'todos') return pagados
    return pagados.filter(p => new Date(`${p.desde}T12:00:00`).getFullYear() === Number(anio))
  }, [pagados, anio])

  const totales = useMemo(() => ({
    periodos: filtrados.length,
    neto: filtrados.reduce((s, p) => s + (Number(p.total_neto_usd) || 0), 0),
    recibos: filtrados.reduce((s, p) => s + (Number(p.total_empleados) || 0), 0),
  }), [filtrados])

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard icon={Calendar}   label="Períodos pagados" value={totales.periodos} color="slate" />
        <KpiCard icon={Users}      label="Recibos emitidos" value={totales.recibos} color="indigo" />
        <KpiCard icon={DollarSign} label="Total liquidado"  value={`$${fmt(totales.neto)}`} color="green" />
      </div>

      {/* Filtro por año */}
      {anios.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setAnio('todos')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              anio === 'todos' ? 'bg-primary text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}>
            Todos
          </button>
          {anios.map(a => (
            <button key={a} onClick={() => setAnio(String(a))}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                anio === String(a) ? 'bg-primary text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {a}
            </button>
          ))}
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          Error al cargar el historial. <button onClick={() => refetch()} className="underline font-bold">Reintentar</button>
        </div>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="Sin períodos pagados"
          description="Los períodos completamente liquidados aparecerán aquí para consulta y reimpresión."
        />
      ) : (
        <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold">Período</th>
                <th className="text-left px-3 py-2.5 font-semibold">Rango</th>
                <th className="text-center px-3 py-2.5 font-semibold">Tipo</th>
                <th className="text-right px-3 py-2.5 font-semibold">Empleados</th>
                <th className="text-right px-3 py-2.5 font-semibold">Bruto</th>
                <th className="text-right px-3 py-2.5 font-semibold">Neto pagado</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(p => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/50 transition-colors">
                  <td className="px-3 py-2.5 font-semibold text-slate-700">{p.nombre}</td>
                  <td className="px-3 py-2.5 text-slate-500">
                    {fmtFecha(p.desde)} – {fmtFecha(p.hasta)}
                  </td>
                  <td className="text-center px-3 py-2.5">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold capitalize">
                      {p.tipo}
                    </span>
                  </td>
                  <td className="text-right px-3 py-2.5 text-slate-600">{p.total_empleados ?? 0}</td>
                  <td className="text-right px-3 py-2.5 text-slate-600">${fmt(p.total_bruto_usd)}</td>
                  <td className="text-right px-3 py-2.5 font-black text-green-600">${fmt(p.total_neto_usd)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button onClick={() => setDetalle(p)} title="Ver recibos"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors">
                      <Eye size={14} />
                    </button>
                  </td>
                </tr>
              ))}

              {/* Totales */}
              <tr className="border-t-2 border-slate-200 bg-slate-50">
                <td colSpan={3} className="px-3 py-2.5 font-black text-slate-700">Total</td>
                <td className="text-right px-3 py-2.5 font-bold text-slate-600">{totales.recibos}</td>
                <td className="text-right px-3 py-2.5 font-bold text-slate-700">
                  ${fmt(filtrados.reduce((s, p) => s + (Number(p.total_bruto_usd) || 0), 0))}
                </td>
                <td className="text-right px-3 py-2.5 font-black text-green-700">${fmt(totales.neto)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {detalle && (
        <PeriodoDetalleModal
          periodo={detalle}
          esAdmin={false}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, color }) {
  const colors = {
    slate:  'bg-slate-50 text-slate-700',
    indigo: 'bg-indigo-50 text-indigo-700',
    green:  'bg-green-50 text-green-700',
  }
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon size={16} />
        </div>
        <span className="text-xs text-slate-500 font-medium">{label}</span>
      </div>
      <div className="text-lg font-black text-slate-800">{value}</div>
    </div>
  )
}
