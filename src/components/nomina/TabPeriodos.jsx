// src/components/nomina/TabPeriodos.jsx
// Lista de períodos de nómina abiertos/cerrados con acciones de cálculo y cierre.
import { useState, useMemo } from 'react'
import { Plus, ClipboardList, Calculator, Lock, Unlock, Eye, DollarSign, Users } from 'lucide-react'
import { useNominaPeriodos, useCalcularPeriodo, useCerrarPeriodo, useReabrirPeriodo } from '../../hooks/useNomina'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import EmptyState from '../../../compat/components/ui/EmptyState.jsx'
import PeriodoFormModal from './PeriodoFormModal'
import PeriodoDetalleModal from './PeriodoDetalleModal'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtFecha(f) {
  return new Date(`${f}T12:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })
}

const ESTADO_STYLE = {
  abierto: { label: 'Abierto', cls: 'bg-green-100 text-green-700 border-green-200' },
  cerrado: { label: 'Cerrado', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  pagado:  { label: 'Pagado',  cls: 'bg-slate-100 text-slate-600 border-slate-200' },
}

export default function TabPeriodos({ esAdmin }) {
  const { data: periodos = [], isLoading, isError, refetch } = useNominaPeriodos()
  const [modalNuevo, setModalNuevo] = useState(false)
  const [detalle, setDetalle]       = useState(null)

  // En esta pestaña solo los activos; los pagados van al historial
  const activos = useMemo(
    () => periodos.filter(p => p.estado !== 'pagado'),
    [periodos]
  )

  const kpis = useMemo(() => ({
    abiertos: activos.filter(p => p.estado === 'abierto').length,
    cerrados: activos.filter(p => p.estado === 'cerrado').length,
    totalNeto: activos.reduce((s, p) => s + (Number(p.total_neto_usd) || 0), 0),
  }), [activos])

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard icon={Unlock}     label="Períodos abiertos" value={kpis.abiertos} color="green" />
        <KpiCard icon={Lock}       label="Cerrados sin pagar" value={kpis.cerrados} color="amber" />
        <KpiCard icon={DollarSign} label="Total a pagar"      value={`$${fmt(kpis.totalNeto)}`} color="indigo" />
      </div>

      {/* Acciones */}
      {esAdmin && (
        <div className="flex justify-end">
          <button onClick={() => setModalNuevo(true)}
            className="flex items-center gap-2 text-white font-bold text-sm px-4 py-2 rounded-xl transition-all shadow-lg active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}>
            <Plus size={16} />
            Nuevo período
          </button>
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
        </div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          Error al cargar períodos. <button onClick={() => refetch()} className="underline font-bold">Reintentar</button>
        </div>
      ) : activos.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No hay períodos activos"
          description="Crea un período para calcular la nómina a partir de la asistencia registrada."
          actionLabel={esAdmin ? 'Nuevo período' : undefined}
          onAction={esAdmin ? () => setModalNuevo(true) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {activos.map(p => (
            <PeriodoCard
              key={p.id}
              periodo={p}
              esAdmin={esAdmin}
              onVerDetalle={() => setDetalle(p)}
            />
          ))}
        </div>
      )}

      {modalNuevo && <PeriodoFormModal onClose={() => setModalNuevo(false)} />}
      {detalle && (
        <PeriodoDetalleModal
          periodo={detalle}
          esAdmin={esAdmin}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  )
}

function PeriodoCard({ periodo, esAdmin, onVerDetalle }) {
  const calcular = useCalcularPeriodo()
  const cerrar   = useCerrarPeriodo()
  const reabrir  = useReabrirPeriodo()
  const [confirmando, setConfirmando] = useState(null) // 'cerrar' | 'reabrir'

  const est = ESTADO_STYLE[periodo.estado] ?? ESTADO_STYLE.abierto
  const abierto = periodo.estado === 'abierto'
  const tieneLineas = (periodo.total_empleados ?? 0) > 0
  const ocupado = calcular.isPending || cerrar.isPending || reabrir.isPending

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-lg transition-all">
      {/* Cabecera */}
      <div className="px-4 pt-3.5 pb-3 border-b border-slate-100">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-black text-slate-800 text-sm truncate">{periodo.nombre}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {fmtFecha(periodo.desde)} – {fmtFecha(periodo.hasta)} · <span className="capitalize">{periodo.tipo}</span>
            </p>
          </div>
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${est.cls}`}>
            {est.label}
          </span>
        </div>
      </div>

      {/* Métricas */}
      <div className="px-4 py-3 grid grid-cols-3 gap-2">
        <Metrica icon={Users} label="Empleados" value={periodo.total_empleados ?? 0} />
        <Metrica label="Bruto" value={`$${fmt(periodo.total_bruto_usd)}`} />
        <Metrica label="Neto"  value={`$${fmt(periodo.total_neto_usd)}`} destacado />
      </div>

      {/* Acciones */}
      <div className="border-t border-slate-100 px-3 py-2 flex flex-wrap items-center gap-1.5">
        <button onClick={onVerDetalle}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50 transition-colors">
          <Eye size={13} />
          Ver detalle
        </button>

        {esAdmin && abierto && (
          <button onClick={() => calcular.mutate(periodo.id)} disabled={ocupado}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50">
            <Calculator size={13} />
            {calcular.isPending ? 'Calculando...' : 'Calcular'}
          </button>
        )}

        {esAdmin && abierto && tieneLineas && (
          confirmando === 'cerrar' ? (
            <div className="flex items-center gap-1 ml-auto">
              <button onClick={() => { cerrar.mutate(periodo.id); setConfirmando(null) }} disabled={ocupado}
                className="px-2 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold disabled:opacity-50">
                Cerrar
              </button>
              <button onClick={() => setConfirmando(null)}
                className="px-2 py-1 rounded bg-slate-200 text-slate-600 text-[10px] font-bold">
                No
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmando('cerrar')} disabled={ocupado}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-50">
              <Lock size={13} />
              Cerrar
            </button>
          )
        )}

        {esAdmin && periodo.estado === 'cerrado' && (
          confirmando === 'reabrir' ? (
            <div className="flex items-center gap-1 ml-auto">
              <button onClick={() => { reabrir.mutate(periodo.id); setConfirmando(null) }} disabled={ocupado}
                className="px-2 py-1 rounded bg-green-500 hover:bg-green-600 text-white text-[10px] font-bold disabled:opacity-50">
                Reabrir
              </button>
              <button onClick={() => setConfirmando(null)}
                className="px-2 py-1 rounded bg-slate-200 text-slate-600 text-[10px] font-bold">
                No
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmando('reabrir')} disabled={ocupado}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-green-600 hover:bg-green-50 transition-colors disabled:opacity-50">
              <Unlock size={13} />
              Reabrir
            </button>
          )
        )}
      </div>
    </div>
  )
}

function Metrica({ icon: Icon, label, value, destacado }) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-slate-400 font-medium flex items-center justify-center gap-1">
        {Icon && <Icon size={10} />} {label}
      </div>
      <div className={`text-sm font-black mt-0.5 ${destacado ? 'text-amber-600' : 'text-slate-700'}`}>
        {value}
      </div>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, color }) {
  const colors = {
    green:  'bg-green-50 text-green-700',
    amber:  'bg-amber-50 text-amber-700',
    indigo: 'bg-indigo-50 text-indigo-700',
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
