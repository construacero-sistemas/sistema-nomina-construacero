// src/components/nomina/TabPeriodos.jsx
// Gestión visual y fluida de períodos de nómina, cálculo y pagos.
// Regla: La moneda principal es SIEMPRE USD ($), y la secundaria es Bs, calculada con la tasa seleccionada.
import { useState, useMemo } from 'react'
import { Plus, ClipboardList, Calculator, Lock, Unlock, Eye, DollarSign, Users, Sparkles, CheckCircle2, ArrowRight, Trash2, MoreVertical, AlertCircle } from 'lucide-react'
import { useNominaPeriodos, useCalcularPeriodo, useCerrarPeriodo, useEliminarPeriodo } from '../../hooks/useNomina'
import useMonedaNomina, { formatBs, formatUsd } from '../../hooks/useMonedaNomina.js'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import EmptyState from '../../../compat/components/ui/EmptyState.jsx'
import KpiCard from '../../../compat/components/ui/KpiCard.jsx'
import RateSelector from './RateSelector.jsx'
import PeriodoFormModal from './PeriodoFormModal'
import PeriodoDetalleModal from './PeriodoDetalleModal'
import { Modal } from '../../../compat/components/ui/Modal.jsx'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtFecha(f) {
  return new Date(`${f}T12:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })
}

const ESTADO_STYLE = {
  abierto: { label: 'Abierto', detail: 'Pendiente de cálculo', cls: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' },
  cerrado: { label: 'Calculado · Por pagar', detail: 'Listo para pago', cls: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  pagado:  { label: 'Completado', detail: 'Pagado', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
}

// La pestaña ya se renderiza solo para roles con `administrarNomina`, así que aquí no hace
// falta un gate de lectura: cada ESCRITURA se gatea con la capacidad que exige su endpoint.
export default function TabPeriodos({ puedeGestionarNomina = false, puedePagarNomina = false }) {
  const { data: periodos = [], isLoading, isError, refetch } = useNominaPeriodos()
  const { fmtBs, shortLabelTasa } = useMonedaNomina()
  const [modalNuevo, setModalNuevo] = useState(false)
  const [detalle, setDetalle] = useState(null)
  const [tarjetaEliminar, setTarjetaEliminar] = useState(null)

  const activos = useMemo(() => periodos.filter(p => p.estado !== 'pagado'), [periodos])
  const kpis = useMemo(() => ({
    abiertos: activos.filter(p => p.estado === 'abierto').length,
    cerrados: activos.filter(p => p.estado === 'cerrado').length,
    totalNeto: activos.reduce((s, p) => s + (Number(p.total_neto_usd) || 0), 0),
  }), [activos])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard icon={Unlock} label="Períodos en curso" value={kpis.abiertos} color="green" />
        <KpiCard icon={Lock} label="Calculados por pagar" value={kpis.cerrados} color="amber" />
        <KpiCard icon={DollarSign} label="Monto Total a Pagar" value={`$${fmt(kpis.totalNeto)}`} subtext={`~ ${fmtBs(kpis.totalNeto)} (${shortLabelTasa})`} color="indigo" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-xs text-slate-500 font-medium hidden sm:block">Genera los períodos de pago basados en la asistencia registrada.</p>
          <div className="hidden md:flex items-center gap-1">
            <span className="text-[11px] text-slate-400 font-medium">Tasa:</span>
            <RateSelector light />
          </div>
        </div>
        {puedeGestionarNomina && (
          <button type="button" onClick={() => setModalNuevo(true)} className="ml-auto flex items-center gap-2 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-md shadow-primary/20 hover:brightness-110 active:scale-95 bg-primary">
            <Plus size={15} /><span>Crear Nuevo Período</span>
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}</div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700 text-xs font-medium">
          No se pudieron cargar los períodos. <button type="button" onClick={() => refetch()} className="underline font-bold">Reintentar</button>
        </div>
      ) : activos.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No hay períodos de nómina activos" description="Crea un período (ej. semanal o quincenal) para procesar la asistencia y liquidar salarios." actionLabel={puedeGestionarNomina ? 'Crear período ahora' : undefined} onAction={puedeGestionarNomina ? () => setModalNuevo(true) : undefined} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {activos.map(p => (
            <PeriodoCard key={p.id} periodo={p} puedeGestionarNomina={puedeGestionarNomina} puedePagarNomina={puedePagarNomina} onVerDetalle={() => setDetalle(p)} onEliminar={() => setTarjetaEliminar(p)} />
          ))}
        </div>
      )}

      {modalNuevo && <PeriodoFormModal onClose={() => setModalNuevo(false)} />}
      {detalle && <PeriodoDetalleModal periodo={detalle} puedeGestionarNomina={puedeGestionarNomina} puedePagarNomina={puedePagarNomina} onClose={() => setDetalle(null)} />}
      {tarjetaEliminar && <ConfirmarEliminarPeriodo periodo={tarjetaEliminar} onCancel={() => setTarjetaEliminar(null)} />}
    </div>
  )
}

function ConfirmarEliminarPeriodo({ periodo, onCancel }) {
  const eliminar = useEliminarPeriodo()
  return (
    <Modal isOpen title="Eliminar período de nómina" onClose={onCancel} busy={eliminar.isPending}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-900">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <p className="text-sm">Se eliminará <strong>{periodo.nombre}</strong> junto con sus recibos. No se puede eliminar si ya tiene pagos registrados. Esta acción no se puede deshacer.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={eliminar.isPending} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={() => eliminar.mutate(periodo.id, { onSuccess: onCancel })} disabled={eliminar.isPending} className="min-h-11 rounded-xl bg-rose-700 px-4 py-2 text-sm font-bold text-white hover:bg-rose-800 disabled:opacity-50">
            {eliminar.isPending ? 'Eliminando…' : 'Eliminar período'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function PeriodoCard({ periodo, puedeGestionarNomina = false, puedePagarNomina = false, onVerDetalle, onEliminar }) {
  const calcular = useCalcularPeriodo()
  const cerrar = useCerrarPeriodo()
  const { fmtBs } = useMonedaNomina()
  const [confirmandoCierre, setConfirmandoCierre] = useState(false)
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [jornadasAbiertas, setJornadasAbiertas] = useState(null)

  function calcularPeriodo() {
    calcular.mutate(periodo.id, {
      onError: error => {
        const detalle = error?.payload?.jornadas_abiertas
        if (!Array.isArray(detalle)) return
        setJornadasAbiertas({ total: Number(error.payload.total_jornadas_abiertas) || detalle.length, detalle })
      },
    })
  }

  const estBase = ESTADO_STYLE[periodo.estado] ?? ESTADO_STYLE.abierto
  const abierto = periodo.estado === 'abierto'
  const tieneLineas = (periodo.total_empleados ?? 0) > 0
  const est = abierto
    ? { ...estBase, detail: tieneLineas ? 'Calculado · revisar antes de cerrar' : 'Pendiente de cálculo' }
    : estBase
  const ocupado = calcular.isPending || cerrar.isPending
  const bruto = Number(periodo.total_bruto_usd) || 0
  const deducciones = Number(periodo.total_deducciones_usd) || 0
  const neto = Number(periodo.total_neto_usd) || 0
  const accionesCierre = confirmandoCierre
  const tieneAccionesPrincipales = (puedeGestionarNomina && abierto) || (puedePagarNomina && periodo.estado === 'cerrado')

  return (
    <article className="flex min-w-0 flex-col overflow-visible rounded-2xl border border-slate-200/90 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="relative flex min-w-0 items-start gap-2.5 border-b border-slate-100 px-4 py-3.5">
        <div className={`mt-1.5 size-2 shrink-0 rounded-full ${est.dot}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-black text-slate-800">{periodo.nombre}</h3>
          <p className="mt-0.5 text-xs font-medium text-slate-500">
            {fmtFecha(periodo.desde)} – {fmtFecha(periodo.hasta)} · <span className="capitalize font-semibold text-slate-700">{periodo.tipo}</span>
          </p>
          <p className="mt-1 text-[11px] font-semibold text-slate-500" role="status">{est.detail}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`max-w-[9.5rem] rounded-full border px-2.5 py-1 text-center text-[10px] font-bold leading-tight ${est.cls}`}>{est.label}</span>
          {puedeGestionarNomina && (
            <div className="relative">
              <button type="button" aria-label={`Más acciones para ${periodo.nombre}`} aria-haspopup="menu" aria-expanded={menuAbierto} onClick={() => setMenuAbierto(value => !value)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Más acciones">
                <MoreVertical size={18} />
              </button>
              {menuAbierto && (
                <>
                  <button type="button" aria-label="Cerrar menú de acciones" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuAbierto(false)} />
                  <div role="menu" aria-label={`Acciones de ${periodo.nombre}`} className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                    <button type="button" role="menuitem" onClick={() => { setMenuAbierto(false); onEliminar() }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-rose-700 hover:bg-rose-50">
                      <Trash2 size={15} /> Eliminar período
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 bg-slate-50/60 p-3 sm:grid-cols-4">
        <Metric label="Personal" value={periodo.total_empleados ?? 0} />
        <Metric label="Bruto" value={`$${fmt(bruto)}`} />
        <Metric label="Deducciones" value={`$${fmt(deducciones)}`} />
        <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-2.5 sm:col-span-1 sm:block sm:p-2">
          <div className="min-w-0">
            <span className="block text-[10px] font-bold text-primary/75">Neto a pagar · USD</span>
            <span className="block truncate text-base font-black tabular-nums text-primary">${fmt(neto)}</span>
          </div>
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-600 sm:mt-0.5 sm:block sm:text-[10px]">≈ {fmtBs(neto)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 bg-white p-3">
        <button type="button" onClick={onVerDetalle} className={`inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 hover:text-slate-900 ${tieneAccionesPrincipales ? '' : 'col-span-2'}`}>
          <Eye size={14} /><span>Ver recibos</span>
        </button>

        {puedeGestionarNomina && abierto && (
          <button type="button" onClick={calcularPeriodo} disabled={ocupado} className={`inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-bold transition-colors disabled:opacity-50 active:scale-95 ${tieneLineas ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50' : 'bg-primary text-white shadow-sm hover:bg-primary-hover'}`}>
            <Calculator size={14} /><span>{calcular.isPending ? 'Calculando…' : tieneLineas ? 'Recalcular' : 'Calcular nómina'}</span>
          </button>
        )}

        {puedeGestionarNomina && abierto && tieneLineas && (
          accionesCierre ? (
            <div role="group" aria-label={`Confirmar cierre de ${periodo.nombre}`} className="col-span-2 grid w-full grid-cols-1 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
              <span className="text-xs font-bold text-amber-950">¿Confirmas cerrar este período para habilitar el pago?</span>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => cerrar.mutate(periodo.id, { onSuccess: () => setConfirmandoCierre(false) })} disabled={ocupado} className="min-h-11 rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50">Confirmar cierre</button>
                <button type="button" onClick={() => setConfirmandoCierre(false)} disabled={ocupado} className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmandoCierre(true)} disabled={ocupado} className="col-span-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-bold text-amber-900 transition-colors hover:bg-amber-100 disabled:opacity-50 active:scale-95">
              <Lock size={13} /><span>Cerrar para pago</span>
            </button>
          )
        )}

        {puedePagarNomina && periodo.estado === 'cerrado' && (
          <button type="button" onClick={onVerDetalle} className="col-span-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 active:scale-95">
            <span>Pagar recibos</span><ArrowRight size={14} />
          </button>
        )}
      </div>

      {jornadasAbiertas && (
        <Modal isOpen onClose={() => setJornadasAbiertas(null)} title="Jornadas sin hora de salida" className="max-w-md" busy={calcular.isPending}>
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">
              {jornadasAbiertas.total === 1 ? '1 marcaje tiene entrada y no tiene salida.' : `${jornadasAbiertas.total} marcajes tienen entrada y no tienen salida.`}
              {' '}Esas jornadas no se pagan ni cuentan como ausencia: corrígelas en el reloj real o en el registro manual, o confirma que se liquidan sin pago.
            </p>
            <ul className="max-h-56 space-y-1.5 overflow-y-auto custom-scrollbar">
              {jornadasAbiertas.detalle.map(jornada => (
                <li key={`${jornada.empleado_id}|${jornada.fecha}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                  <span className="min-w-0 truncate text-xs font-bold text-slate-700">{jornada.empleado_nombre || 'Empleado'}</span>
                  <span className="shrink-0 font-mono text-[11px] text-slate-500">{fmtFecha(jornada.fecha)}{jornada.hora_entrada ? ` · ${String(jornada.hora_entrada).slice(0, 5)}` : ''}</span>
                </li>
              ))}
            </ul>
            {jornadasAbiertas.total > jornadasAbiertas.detalle.length && <p className="text-[11px] font-medium text-slate-500">…y {jornadasAbiertas.total - jornadasAbiertas.detalle.length} más.</p>}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setJornadasAbiertas(null)} disabled={calcular.isPending} className="min-h-11 rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Corregir marcajes</button>
              <button type="button" onClick={() => { calcular.mutate({ periodoId: periodo.id, confirmarJornadasAbiertas: true }); setJornadasAbiertas(null) }} disabled={calcular.isPending} className="min-h-11 rounded-xl bg-amber-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50">Calcular sin pagarlas</button>
            </div>
          </div>
        </Modal>
      )}
    </article>
  )
}

function Metric({ label, value }) {
  return (
    <div className="flex min-h-[3.4rem] min-w-0 flex-col justify-center rounded-xl border border-slate-100 bg-white p-2.5 sm:p-2">
      <span className="block text-[10px] font-bold text-slate-500">{label}</span>
      <span className="block truncate text-sm font-black tabular-nums text-slate-800">{value}</span>
    </div>
  )
}
