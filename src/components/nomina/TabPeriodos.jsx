// src/components/nomina/TabPeriodos.jsx
// Gestión visual y fluida de períodos de nómina, cálculo y pagos.
// Regla: La moneda principal es SIEMPRE USD ($), y la secundaria es Bs, calculada con la tasa seleccionada.
import { useState, useMemo } from 'react'
import { Plus, ClipboardList, Calculator, Lock, Unlock, Eye, DollarSign, Users, Sparkles, CheckCircle2, ArrowRight, Trash2 } from 'lucide-react'
import { useNominaPeriodos, useCalcularPeriodo, useCerrarPeriodo, useReabrirPeriodo, useEliminarPeriodo } from '../../hooks/useNomina'
import useMonedaNomina, { formatBs, formatUsd } from '../../hooks/useMonedaNomina.js'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import EmptyState from '../../../compat/components/ui/EmptyState.jsx'
import KpiCard from '../../../compat/components/ui/KpiCard.jsx'
import RateSelector from './RateSelector.jsx'
import PeriodoFormModal from './PeriodoFormModal'
import PeriodoDetalleModal from './PeriodoDetalleModal'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtFecha(f) {
  return new Date(`${f}T12:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })
}

const ESTADO_STYLE = {
  abierto: { label: 'Abierto / En curso', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cerrado: { label: 'Calculado / Por pagar', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  pagado:  { label: 'Completado',  cls: 'bg-slate-100 text-slate-600 border-slate-200' },
}

export default function TabPeriodos({ esAdmin }) {
  const { data: periodos = [], isLoading, isError, refetch } = useNominaPeriodos()
  const { fmtBs, shortLabelTasa } = useMonedaNomina()
  const [modalNuevo, setModalNuevo] = useState(false)
  const [detalle, setDetalle]       = useState(null)

  // En esta pestaña los activos; los pagados van a historial
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
      {/* KPIs de Períodos Activos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard icon={Unlock}     label="Períodos en curso" value={kpis.abiertos} color="green" />
        <KpiCard icon={Lock}       label="Calculados por pagar" value={kpis.cerrados} color="amber" />
        <KpiCard
          icon={DollarSign}
          label="Monto Total a Pagar"
          value={`$${fmt(kpis.totalNeto)}`}
          subtext={`~ ${fmtBs(kpis.totalNeto)} (${shortLabelTasa})`}
          color="indigo"
        />
      </div>

      {/* Barra de control y creación */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-xs text-slate-500 font-medium hidden sm:block">
            Genera los períodos de pago basados en la asistencia registrada.
          </p>
          <div className="hidden md:flex items-center gap-1">
            <span className="text-[11px] text-slate-400 font-medium">Tasa:</span>
            <RateSelector />
          </div>
        </div>

        {esAdmin && (
          <button
            type="button"
            onClick={() => setModalNuevo(true)}
            className="ml-auto flex items-center gap-2 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-md shadow-primary/20 hover:brightness-110 active:scale-95 bg-primary"
          >
            <Plus size={15} />
            <span>Crear Nuevo Período</span>
          </button>
        )}
      </div>

      {/* Lista de Períodos Activos */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-xs font-medium">
          No se pudieron cargar los períodos. <button type="button" onClick={() => refetch()} className="underline font-bold">Reintentar</button>
        </div>
      ) : activos.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No hay períodos de nómina activos"
          description="Crea un período (ej. semanal o quincenal) para procesar la asistencia y liquidar salarios."
          actionLabel={esAdmin ? 'Crear período ahora' : undefined}
          onAction={esAdmin ? () => setModalNuevo(true) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
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
  const eliminar = useEliminarPeriodo()
  const { fmtBs } = useMonedaNomina()
  const [confirmando, setConfirmando] = useState(null)

  const est = ESTADO_STYLE[periodo.estado] ?? ESTADO_STYLE.abierto
  const abierto = periodo.estado === 'abierto'
  const tieneLineas = (periodo.total_empleados ?? 0) > 0
  const ocupado = calcular.isPending || cerrar.isPending || reabrir.isPending || eliminar.isPending

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
      {/* Cabecera de la tarjeta */}
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-black text-slate-800 text-sm truncate">{periodo.nombre}</h3>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">
              {fmtFecha(periodo.desde)} – {fmtFecha(periodo.hasta)} · <span className="capitalize font-semibold text-slate-700">{periodo.tipo}</span>
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {esAdmin && (
              confirmando === 'eliminar' ? (
                <div className="flex items-center gap-1 bg-red-50 border border-red-200 rounded-xl p-1 animate-in fade-in">
                  <span className="text-[10px] text-red-700 font-bold px-1">¿Eliminar?</span>
                  <button
                    type="button"
                    onClick={() => { eliminar.mutate(periodo.id); setConfirmando(null) }}
                    disabled={ocupado}
                    className="px-2 py-0.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[10px] font-black disabled:opacity-50 transition-colors"
                  >
                    Sí
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmando(null)}
                    className="px-1.5 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-[10px] font-bold hover:bg-slate-50 transition-colors"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmando('eliminar')}
                  title="Eliminar este período"
                  aria-label="Eliminar período"
                  disabled={ocupado}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                >
                  <Trash2 size={15} />
                </button>
              )
            )}

            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${est.cls}`}>
              {est.label}
            </span>
          </div>
        </div>
      </div>

      {/* Métricas clave */}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50/50">
        <div className="p-2 rounded-xl bg-white border border-slate-100 text-center">
          <span className="text-[10px] text-slate-400 font-bold block">Personal</span>
          <span className="text-xs font-black text-slate-800">{periodo.total_empleados ?? 0}</span>
        </div>
        <div className="p-2 rounded-xl bg-white border border-slate-100 text-center">
          <span className="text-[10px] text-slate-400 font-bold block">Total Bruto</span>
          <span className="text-xs font-black text-slate-800">${fmt(periodo.total_bruto_usd)}</span>
        </div>
        <div className="p-2 rounded-xl bg-white border border-emerald-200 text-center">
          <span className="text-[10px] text-emerald-700 font-bold block">Total Neto</span>
          <span className="text-xs font-black text-emerald-700 block">${fmt(periodo.total_neto_usd)}</span>
          <span className="text-[9px] text-emerald-600 font-mono font-medium block truncate">
            {fmtBs(periodo.total_neto_usd)}
          </span>
        </div>
      </div>

      {/* Barra de Acciones */}
      <div className="p-3 border-t border-slate-100 flex items-center justify-between gap-2 bg-white">
        <button
          type="button"
          onClick={onVerDetalle}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
        >
          <Eye size={14} />
          <span>Ver Recibos</span>
        </button>

        <div className="flex items-center gap-2">
          {esAdmin && abierto && (
            <button
              onClick={() => calcular.mutate(periodo.id)}
              disabled={ocupado}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold transition-all disabled:opacity-50 active:scale-95"
            >
              <Calculator size={14} />
              <span>{calcular.isPending ? 'Calculando...' : 'Calcular'}</span>
            </button>
          )}

          {esAdmin && abierto && tieneLineas && (
            confirmando === 'cerrar' ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { cerrar.mutate(periodo.id); setConfirmando(null) }}
                  disabled={ocupado}
                  className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold disabled:opacity-50"
                >
                  Sí, cerrar
                </button>
                <button
                  onClick={() => setConfirmando(null)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmando('cerrar')}
                disabled={ocupado}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-sm transition-all disabled:opacity-50 active:scale-95"
              >
                <Lock size={13} />
                <span>Cerrar para pago</span>
              </button>
            )
          )}

          {esAdmin && periodo.estado === 'cerrado' && (
            <button
              onClick={onVerDetalle}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white text-xs font-bold shadow-md shadow-emerald-950/20 transition-all active:scale-95"
            >
              <span>Pagar Recibos</span>
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
