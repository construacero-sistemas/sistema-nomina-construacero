// src/components/nomina/HolidaySummaryCard.jsx
// Tarjeta ejecutiva compacta de feriados para la pestaña de configuración.
// Reemplaza el calendario gigante por un panel Bento limpio con acceso en 1 clic al calendario modal.
import { useState, useMemo } from 'react'
import {
  CalendarDays, Plus, Download, Calendar, ArrowRight, Trash2,
  Sparkles, CheckCircle2, Flag, Building2, MapPin
} from 'lucide-react'
import { useCrearFeriado, useEliminarFeriado } from '../../hooks/useNomina.js'
import { TIPO_COLORS } from './holidayUtils.js'
import { HolidayFormModal, BatchImportModal, ConfirmModal } from './HolidayModals.jsx'
import HolidayCalendarModal from './HolidayCalendarModal.jsx'

function formatDate(dateStr) {
  try {
    const [y, m, d] = dateStr.split('-')
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
    return date.toLocaleDateString('es-VE', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
  } catch {
    return dateStr
  }
}

export default function HolidaySummaryCard({ feriados, onRefresh }) {
  const crear = useCrearFeriado()
  const eliminar = useEliminarFeriado()

  const [modalForm, setModalForm] = useState(false)
  const [modalImport, setModalImport] = useState(false)
  const [modalCalendar, setModalCalendar] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const list = useMemo(() => feriados.data || [], [feriados.data])
  const existingDates = useMemo(() => new Set(list.map(f => f.fecha)), [list])

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const currentYear = useMemo(() => new Date().getUTCFullYear(), [])
  const currentMonthStr = useMemo(() => `${currentYear}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`, [currentYear])

  // Feriados este mes
  const feriadosMes = useMemo(() => {
    return list.filter(f => f.fecha.startsWith(currentMonthStr))
  }, [list, currentMonthStr])

  // Próximos feriados (a partir de hoy)
  const proximos = useMemo(() => {
    return list
      .filter(f => f.fecha >= todayStr)
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .slice(0, 4)
  }, [list, todayStr])

  const proximo = proximos[0] || null

  async function handleCreate(data) {
    await crear.mutateAsync(data)
    setModalForm(false)
  }

  async function handleDelete(id) {
    await eliminar.mutateAsync(id)
    setDeleteTarget(null)
  }

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
      {/* ═══ CABECERA ═══ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold shrink-0">
            <CalendarDays size={22} />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-800">Días Feriados y No Laborables</h3>
            <p className="text-xs text-slate-400">
              {list.length} feriados configurados · Impactan recargos y días de descanso
            </p>
          </div>
        </div>

        {/* Acciones principales */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setModalImport(true)}
            className="flex items-center gap-1.5 px-3 py-2 min-h-11 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all active:scale-95 shadow-xs"
            title="Importar feriados oficiales de ley de Venezuela"
          >
            <Download size={14} className="text-emerald-600" />
            <span className="hidden sm:inline">Importar Feriados</span>
            <span className="sm:hidden">Importar</span>
          </button>

          <button
            type="button"
            onClick={() => setModalForm(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 min-h-11 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-black transition-all active:scale-95 shadow-md shadow-primary/20"
          >
            <Plus size={14} />
            <span>Nuevo Feriado</span>
          </button>
        </div>
      </div>

      {/* ═══ BENTO GRID DE ESTADO RÁPIDO ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* KPI 1: Registrados este año */}
        <div className="bg-slate-50 border border-slate-200/70 rounded-2xl p-3.5 flex flex-col justify-between">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Feriados</span>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-2xl font-black text-slate-800">{list.length}</span>
            <span className="text-xs text-slate-400">en {currentYear}</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1">{feriadosMes.length} este mes actual</span>
        </div>

        {/* KPI 2: Próximo Feriado */}
        <div className="bg-amber-50/60 border border-amber-200/80 rounded-2xl p-3.5 flex flex-col justify-between sm:col-span-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 flex items-center gap-1">
              <Sparkles size={11} className="text-amber-500" />
              Próximo Feriado
            </span>
            {proximo && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-900 uppercase">
                {proximo.tipo}
              </span>
            )}
          </div>

          {proximo ? (
            <div className="mt-1 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-black text-slate-800 truncate">{proximo.nombre}</p>
                <p className="text-xs text-amber-800 font-semibold capitalize mt-0.5">
                  {formatDate(proximo.fecha)} · {proximo.laborable ? 'Laborable con recargo' : 'No laborable'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 mt-1 font-medium">No hay feriados próximos registrados para este año.</p>
          )}

          <div className="mt-2 pt-2 border-t border-amber-200/50 flex justify-end">
            <button
              type="button"
              onClick={() => setModalCalendar(true)}
              className="text-xs font-black text-amber-900 hover:text-amber-950 flex items-center gap-1 hover:underline active:scale-95 transition-all"
            >
              <span>Abrir Calendario Completo</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* ═══ PRÓXIMOS FERIADOS EN LISTA COMPACTA ═══ */}
      {proximos.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
              Próximas fechas no laborables
            </span>
            <button
              type="button"
              onClick={() => setModalCalendar(true)}
              className="text-[11px] font-bold text-primary hover:underline"
            >
              Ver todos ({list.length})
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {proximos.map(f => {
              const colors = TIPO_COLORS[f.tipo] || TIPO_COLORS.nacional
              return (
                <div
                  key={f.id}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-100/70 transition-all"
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
                      <p className="text-xs font-bold text-slate-800 truncate">{f.nombre}</p>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 capitalize">{formatDate(f.fecha)}</p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${colors.bg} ${colors.text}`}>
                      {f.tipo}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(f)}
                      className="p-1 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Eliminar feriado"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ═══ MODALES ═══ */}
      {modalForm && (
        <HolidayFormModal
          initialDate={todayStr}
          existingDates={existingDates}
          onClose={() => setModalForm(false)}
          onSubmit={handleCreate}
          pending={crear.isPending}
        />
      )}

      {modalImport && (
        <BatchImportModal
          existingDates={existingDates}
          onClose={() => setModalImport(false)}
          onSubmit={crear.mutateAsync}
          pending={crear.isPending}
        />
      )}

      {modalCalendar && (
        <HolidayCalendarModal
          feriados={feriados}
          onClose={() => setModalCalendar(false)}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Eliminar feriado"
          message={`¿Estás seguro de eliminar el feriado "${deleteTarget.nombre}" (${formatDate(deleteTarget.fecha)})?`}
          confirmLabel="Eliminar feriado"
          danger
          onConfirm={() => handleDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
          pending={eliminar.isPending}
        />
      )}
    </div>
  )
}
