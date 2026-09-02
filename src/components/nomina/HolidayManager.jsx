// src/components/nomina/HolidayManager.jsx
// Calendario interactivo, formulario ágil con presets de Venezuela, importación por lotes
// y gestión visual de feriados optimizada para Móvil y PC.
import { useState, useMemo } from 'react'
import {
  ChevronLeft, ChevronRight, CalendarDays, Plus, Trash2, Download, X,
  Calendar, Check, Flag, Building2, MapPin, Sparkles, Filter
} from 'lucide-react'
import { useCrearFeriado, useEliminarFeriado } from '../../hooks/useNomina.js'
import { DIAS_CORTO, MESES, TIPO_COLORS } from './holidayUtils.js'
import { HolidayFormModal, BatchImportModal, ConfirmModal } from './HolidayModals.jsx'

function formatDate(dateStr) {
  try {
    const [y, m, d] = dateStr.split('-')
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
    return date.toLocaleDateString('es-VE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  } catch {
    return dateStr
  }
}

export default function HolidayManager({ feriados, isEmbedded = false }) {
  const crear = useCrearFeriado()
  const eliminar = useEliminarFeriado()
  const existingDates = useMemo(() => new Set((feriados.data || []).map(f => f.fecha)), [feriados.data])
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date()
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() }
  })
  const [selectedDate, setSelectedDate] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [selectedTipo, setSelectedTipo] = useState('all')

  const holidaysByDate = useMemo(() => {
    const map = new Map()
    for (const f of feriados.data || []) {
      map.set(f.fecha, f)
    }
    return map
  }, [feriados.data])

  const calendarDays = useMemo(() => {
    const { year, month } = viewDate
    const firstDay = new Date(Date.UTC(year, month, 1))
    const lastDay = new Date(Date.UTC(year, month + 1, 0))
    const totalDays = lastDay.getUTCDate()
    let startOffset = firstDay.getUTCDay() - 1
    if (startOffset < 0) startOffset = 6

    const days = []
    const prevMonthLast = new Date(Date.UTC(year, month, 0)).getUTCDate()
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = prevMonthLast - i
      const m = month === 0 ? 11 : month - 1
      const y = month === 0 ? year - 1 : year
      days.push({ day: d, month: m, year: y, isCurrentMonth: false, isPrev: true })
    }

    for (let d = 1; d <= totalDays; d++) {
      days.push({ day: d, month, year, isCurrentMonth: true })
    }

    const remaining = 42 - days.length
    for (let d = 1; d <= remaining; d++) {
      const m = month === 11 ? 0 : month + 1
      const y = month === 11 ? year + 1 : year
      days.push({ day: d, month: m, year: y, isCurrentMonth: false, isNext: true })
    }

    return days
  }, [viewDate])

  const filteredHolidays = useMemo(() => {
    const list = feriados.data || []
    if (selectedTipo === 'all') return list
    return list.filter(f => f.tipo === selectedTipo)
  }, [feriados.data, selectedTipo])

  const feriadosDelMes = useMemo(() => {
    const prefix = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, '0')}`
    return (feriados.data || []).filter(f => f.fecha.startsWith(prefix))
  }, [feriados.data, viewDate])

  function prevMonth() {
    setViewDate(v => {
      if (v.month === 0) return { year: v.year - 1, month: 11 }
      return { year: v.year, month: v.month - 1 }
    })
  }

  function nextMonth() {
    setViewDate(v => {
      if (v.month === 11) return { year: v.year + 1, month: 0 }
      return { year: v.year, month: v.month + 1 }
    })
  }

  function handleDayClick(dayObj) {
    const monthStr = String(dayObj.month + 1).padStart(2, '0')
    const dayStr = String(dayObj.day).padStart(2, '0')
    const dateStr = `${dayObj.year}-${monthStr}-${dayStr}`
    setSelectedDate(dateStr)
    if (!dayObj.isCurrentMonth) {
      setViewDate({ year: dayObj.year, month: dayObj.month })
    }
  }

  async function handleCreateHoliday(data) {
    await crear.mutateAsync(data)
    setShowForm(false)
  }

  async function handleDeleteHoliday(id) {
    await eliminar.mutateAsync(id)
    setDeleteTarget(null)
  }

  const todayStr = useMemo(() => {
    const now = new Date()
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
  }, [])

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ═══ BARRA SUPERIOR DE ACCIONES ═══ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 sm:p-4 rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold shrink-0">
            <CalendarDays size={20} className="sm:w-[22px] sm:h-[22px]" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-black text-slate-800 leading-snug">
              {isEmbedded ? 'Explorador de Calendario' : 'Calendario Laboral'}
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-400">
              {feriados.data?.length || 0} feriados · {feriadosDelMes.length} este mes
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white h-10 sm:h-9 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs active:scale-95"
          >
            <Download size={14} className="text-emerald-600" />
            <span>Importar</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedDate(todayStr)
              setShowForm(true)
            }}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-primary hover:bg-primary-hover h-10 sm:h-9 px-3 text-xs font-black text-white transition-colors shadow-md shadow-primary/20 active:scale-95"
          >
            <Plus size={14} />
            <span>Nuevo Feriado</span>
          </button>
        </div>
      </div>

      {/* ═══ VISTA PRINCIPAL: CALENDARIO + PANEL LATERAL ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 sm:gap-6">
        {/* Calendario visual (8 columnas en desktop) */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-100 p-2.5 sm:p-5 shadow-sm space-y-3 sm:space-y-4">
          {/* Header del mes y navegación */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-base sm:text-lg font-black text-slate-800">
                {MESES[viewDate.month]}
              </h3>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={prevMonth}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors active:scale-95"
                aria-label="Mes anterior"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={nextMonth}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors active:scale-95"
                aria-label="Mes siguiente"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          {/* Días de la semana */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {DIAS_CORTO.map(d => (
              <div key={d} className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-400 py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Grid de días */}
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {calendarDays.map((d, idx) => {
              const monthStr = String(d.month + 1).padStart(2, '0')
              const dayStr = String(d.day).padStart(2, '0')
              const dateStr = `${d.year}-${monthStr}-${dayStr}`
              const holiday = holidaysByDate.get(dateStr)
              const isToday = dateStr === todayStr
              const isSelected = dateStr === selectedDate
              const isSunday = (idx % 7 === 6)
              const isWeekend = (idx % 7 === 5) || isSunday

              let cellBg = 'bg-slate-50/60 hover:bg-slate-100/80 border-slate-100'
              if (!d.isCurrentMonth) {
                cellBg = 'bg-slate-50/20 text-slate-300 hover:bg-slate-50 border-transparent'
              } else if (holiday) {
                const colors = TIPO_COLORS[holiday.tipo] || TIPO_COLORS.nacional
                cellBg = `${colors.bg} hover:brightness-95 border-amber-200/60`
              } else if (isSunday) {
                cellBg = 'bg-amber-500/[0.07] hover:bg-amber-500/[0.14] border-amber-200/50'
              }
              if (isSelected) cellBg += ' ring-2 ring-primary ring-inset shadow-xs'

              return (
                <button
                  key={`${d.year}-${d.month}-${d.day}-${idx}`}
                  type="button"
                  onClick={() => handleDayClick(d)}
                  className={`aspect-square sm:aspect-auto sm:min-h-[76px] p-1 sm:p-1.5 rounded-xl sm:rounded-2xl border text-left flex flex-col justify-between items-center sm:items-stretch transition-all relative ${cellBg}`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span
                      className={`text-[11px] sm:text-xs font-bold w-6 h-6 sm:w-5 sm:h-5 flex items-center justify-center rounded-full mx-auto sm:mx-0 ${
                        isToday
                          ? 'bg-primary text-white font-black shadow-xs'
                          : d.isCurrentMonth
                            ? isSunday
                              ? 'text-amber-800 font-black'
                              : isWeekend ? 'text-slate-400' : 'text-slate-700'
                            : 'text-slate-300'
                      }`}
                    >
                      {d.day}
                    </span>

                    {(holiday || (isSunday && d.isCurrentMonth)) && (
                      <span
                        className={`w-2 h-2 rounded-full hidden sm:block ${
                          holiday
                            ? TIPO_COLORS[holiday.tipo]?.dot || 'bg-amber-500'
                            : 'bg-amber-500/80'
                        }`}
                        title={holiday?.nombre || 'Domingo (Feriado legal)'}
                      />
                    )}
                  </div>

                  {/* Indicador de punto en móvil */}
                  {(holiday || (isSunday && d.isCurrentMonth)) && (
                    <div className="flex sm:hidden justify-center items-center pb-0.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          holiday
                            ? TIPO_COLORS[holiday.tipo]?.dot || 'bg-amber-500'
                            : 'bg-amber-500'
                        }`}
                      />
                    </div>
                  )}

                  {/* Detalle ampliado en desktop */}
                  {holiday ? (
                    <div className="mt-1 w-full hidden sm:block">
                      <p
                        className={`text-[9px] sm:text-[10px] font-black leading-tight line-clamp-1 sm:line-clamp-2 ${
                          TIPO_COLORS[holiday.tipo]?.text || 'text-amber-900'
                        }`}
                      >
                        {holiday.nombre}
                      </p>
                      <span className="text-[8px] sm:text-[9px] font-bold text-slate-500 uppercase tracking-tighter block mt-0.5">
                        {holiday.laborable ? 'Con recargo' : 'No lab.'}
                      </span>
                    </div>
                  ) : isSunday && d.isCurrentMonth ? (
                    <div className="mt-1 w-full hidden sm:block">
                      <p className="text-[9px] sm:text-[10px] font-black leading-tight line-clamp-1 text-amber-900">
                        Domingo
                      </p>
                      <span className="text-[8px] sm:text-[9px] font-bold text-amber-700 uppercase tracking-tighter block mt-0.5">
                        Feriado legal
                      </span>
                    </div>
                  ) : (
                    <div className="hidden sm:block" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Leyenda de colores */}
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100 text-xs">
            <span className="font-bold text-slate-400 text-[10px] uppercase tracking-wider">Leyenda:</span>
            {Object.entries(TIPO_COLORS).map(([tipo, c]) => (
              <div key={tipo} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
                <span className="text-slate-600 font-medium text-[11px]">{c.label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 ml-auto text-slate-400 text-[11px]">
              <span className="w-2.5 h-2.5 rounded-full bg-primary text-white inline-block" />
              <span>Hoy</span>
            </div>
          </div>
        </div>

        {/* Panel lateral: Lista detallada y acciones del día seleccionado (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Card del día seleccionado */}
          {selectedDate && (
            <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-400">Día seleccionado</h4>
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm sm:text-base font-black text-slate-800 capitalize">{formatDate(selectedDate)}</p>
                </div>
                {!holidaysByDate.has(selectedDate) && (
                  <button
                    type="button"
                    onClick={() => setShowForm(true)}
                    className="flex items-center gap-1.5 rounded-xl bg-primary text-white px-3 py-1.5 text-xs font-bold hover:bg-primary-hover shadow-sm active:scale-95 transition-all"
                  >
                    <Plus size={13} />
                    <span>Agregar Feriado</span>
                  </button>
                )}
              </div>

              {holidaysByDate.has(selectedDate) ? (
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-2">
                  {(() => {
                    const h = holidaysByDate.get(selectedDate)
                    const colors = TIPO_COLORS[h.tipo] || TIPO_COLORS.nacional
                    return (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${colors.bg} ${colors.text}`}>
                              {colors.label}
                            </span>
                            <h5 className="text-sm font-black text-slate-800 mt-1">{h.nombre}</h5>
                          </div>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(h)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Eliminar feriado"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-200/60">
                          <span>Régimen:</span>
                          <span className="font-bold text-slate-700">
                            {h.laborable ? 'Laborable con recargo si asiste' : 'No laborable (Descanso)'}
                          </span>
                        </div>
                      </>
                    )
                  })()}
                </div>
              ) : selectedDate && new Date(`${selectedDate}T12:00:00Z`).getUTCDay() === 0 ? (
                <div className="rounded-xl bg-amber-500/[0.08] border border-amber-200/80 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-200/60">
                        Descanso Dominical (Ley)
                      </span>
                      <h5 className="text-sm font-black text-slate-800 mt-1">Domingo (Feriado Semanal)</h5>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                  </div>
                  <p className="text-[11px] text-slate-600 leading-tight">
                    Por ley laboral, todos los domingos son feriados. Si el personal asiste a laborar, devenga recargo de feriado automáticamente.
                  </p>
                  <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-amber-200/60">
                    <span>Régimen:</span>
                    <span className="font-bold text-amber-900">Laborable con recargo si asiste</span>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Lista de feriados filtrables */}
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Calendar size={14} className="text-primary" />
                <span>Lista de Feriados ({filteredHolidays.length})</span>
              </h4>
            </div>

            {/* Pills de filtro rápido */}
            <div className="flex flex-wrap gap-1.5 pb-1">
              {[
                { id: 'all', label: 'Todos', icon: null },
                { id: 'nacional', label: 'Nacional', icon: Flag, color: 'text-amber-500' },
                { id: 'empresa', label: 'Empresa', icon: Building2, color: 'text-blue-500' },
                { id: 'regional', label: 'Regional', icon: MapPin, color: 'text-purple-500' },
              ].map(f => {
                const Icon = f.icon
                const activo = selectedTipo === f.id
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedTipo(f.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all shrink-0 ${
                      activo
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100/90 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {Icon && <Icon size={12} className={activo ? 'text-white' : f.color} />}
                    <span>{f.label}</span>
                  </button>
                )
              })}
            </div>

            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {filteredHolidays.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  No hay feriados registrados para este filtro.
                </div>
              ) : (
                filteredHolidays.map(f => {
                  const colors = TIPO_COLORS[f.tipo] || TIPO_COLORS.nacional
                  const isCurrent = f.fecha.startsWith(`${viewDate.year}-${String(viewDate.month + 1).padStart(2, '0')}`)
                  return (
                    <div
                      key={f.id}
                      className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                        isCurrent ? 'bg-amber-50/30 border-amber-200/60' : 'bg-white border-slate-100 hover:border-slate-200'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDate(f.fecha)
                          const [y, m] = f.fecha.split('-')
                          setViewDate({ year: Number(y), month: Number(m) - 1 })
                        }}
                        className="text-left flex-1 min-w-0"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
                          <p className="text-xs font-black text-slate-800 truncate">{f.nombre}</p>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{formatDate(f.fecha)}</p>
                      </button>

                      <div className="flex items-center gap-1">
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} uppercase`}>
                          {f.tipo}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(f)}
                          className="p-1 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modales */}
      {showForm && (
        <HolidayFormModal
          initialDate={selectedDate || todayStr}
          existingDates={existingDates}
          onClose={() => setShowForm(false)}
          onSubmit={handleCreateHoliday}
          pending={crear.isPending}
        />
      )}

      {showImport && (
        <BatchImportModal
          existingDates={existingDates}
          onClose={() => setShowImport(false)}
          onSubmit={crear.mutateAsync}
          pending={crear.isPending}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Eliminar feriado"
          message={`¿Estás seguro de eliminar el feriado "${deleteTarget.nombre}" (${formatDate(deleteTarget.fecha)})?`}
          confirmLabel="Eliminar feriado"
          danger
          onConfirm={() => handleDeleteHoliday(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
          pending={eliminar.isPending}
        />
      )}
    </div>
  )
}
