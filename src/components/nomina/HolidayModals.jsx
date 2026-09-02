// src/components/nomina/HolidayModals.jsx
// Modales de alta calidad visual (Mobile & Desktop) para gestión y creación de feriados.
import { useState, useMemo } from 'react'
import {
  CalendarDays, Download, Check, AlertTriangle, X, Sparkles, Building2, Flag, MapPin,
  Calendar, CheckCircle2, ChevronLeft, ChevronRight, HelpCircle
} from 'lucide-react'
import { getVenezuelanHolidays } from './holidayUtils.js'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'

const inputClass = 'w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-50'

function formatReadableDate(dateStr) {
  if (!dateStr) return ''
  try {
    const [y, m, d] = dateStr.split('-')
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
    return date.toLocaleDateString('es-VE', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    })
  } catch {
    return dateStr
  }
}

export function HolidayFormModal({ initialDate, existingDates, onClose, onSubmit, pending }) {
  const [form, setForm] = useState({
    fecha: initialDate || new Date().toISOString().slice(0, 10),
    nombre: '',
    tipo: 'empresa', // 'empresa' | 'nacional' | 'regional'
    laborable: true,
  })
  const [error, setError] = useState(null)
  const isDuplicate = existingDates.has(form.fecha)

  function change(field, val) {
    setForm(f => ({ ...f, [field]: val }))
    setError(null)
  }

  function setRelativeDate(daysOffset) {
    const now = new Date()
    now.setUTCDate(now.getUTCDate() + daysOffset)
    const y = now.getUTCFullYear()
    const m = String(now.getUTCMonth() + 1).padStart(2, '0')
    const d = String(now.getUTCDate()).padStart(2, '0')
    change('fecha', `${y}-${m}-${d}`)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.nombre.trim()) {
      setError('El nombre del feriado es obligatorio')
      return
    }
    if (isDuplicate) {
      setError('Ya existe un feriado registrado para esta fecha')
      return
    }
    try {
      await onSubmit(form)
    } catch (err) {
      setError(err?.message || 'Error al registrar feriado')
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] sm:max-h-[85vh] overflow-y-auto flex flex-col animate-in fade-in slide-in-from-bottom-6 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera con Badge */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
              <CalendarDays size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800">Registrar Día Feriado</h3>
              <p className="text-xs text-slate-400">Configura días no laborables o con recargo de nómina</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4.5">
          {/* ═══ FECHA DEL FERIADO ═══ */}
          {initialDate ? (
            <div className="flex items-center justify-between p-3 rounded-2xl bg-amber-500/[0.08] border border-amber-200/80">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center font-black shrink-0">
                  <Calendar size={16} />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Fecha del feriado</span>
                  <span className="text-xs sm:text-sm font-black text-slate-800 capitalize block">{formatReadableDate(form.fecha)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black uppercase tracking-wider text-slate-600">
                  Fecha del feriado
                </label>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setRelativeDate(0)}
                    className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-all active:scale-95"
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    onClick={() => setRelativeDate(1)}
                    className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-all active:scale-95"
                  >
                    Mañana
                  </button>
                </div>
              </div>

              <DatePicker
                value={form.fecha}
                onChange={val => change('fecha', val)}
                disabled={pending}
              />

              {form.fecha && (
                <p className="text-[11px] text-slate-500 font-medium capitalize flex items-center gap-1 pl-1">
                  <Calendar size={12} className="text-primary" />
                  {formatReadableDate(form.fecha)}
                </p>
              )}
            </div>
          )}

          {isDuplicate && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800 flex items-center gap-2 animate-in fade-in">
              <AlertTriangle size={15} className="text-amber-600 shrink-0" />
              <span>Ya existe un feriado registrado para esta fecha.</span>
            </div>
          )}

          {/* ═══ NOMBRE DEL FERIADO ═══ */}
          <div className="space-y-1">
            <label className="text-xs font-black uppercase tracking-wider text-slate-600">
              Nombre o Motivo
            </label>
            <input
              value={form.nombre}
              onChange={e => change('nombre', e.target.value)}
              maxLength={160}
              className={inputClass}
              placeholder="Ej. Aniversario de la empresa, Día de San Benito..."
              disabled={pending}
              autoFocus
            />
          </div>

          {/* ═══ TIPO DE FERIADO (CARDS SELECCIONABLES) ═══ */}
          <div className="space-y-1.5">
            <label className="text-xs font-black uppercase tracking-wider text-slate-600">
              Clasificación del Feriado
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'empresa', label: 'Empresa', desc: 'Interno', icon: Building2, activeCls: 'border-blue-500 bg-blue-50/70 text-blue-900 ring-2 ring-blue-500/20' },
                { id: 'nacional', label: 'Nacional', desc: 'Ley / Oficial', icon: Flag, activeCls: 'border-amber-500 bg-amber-50/70 text-amber-900 ring-2 ring-amber-500/20' },
                { id: 'regional', label: 'Regional', desc: 'Estadal / Local', icon: MapPin, activeCls: 'border-purple-500 bg-purple-50/70 text-purple-900 ring-2 ring-purple-500/20' },
              ].map(t => {
                const isSelected = form.tipo === t.id
                const Icon = t.icon
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => change('tipo', t.id)}
                    className={`p-2.5 rounded-2xl border text-left flex flex-col justify-between transition-all ${
                      isSelected
                        ? t.activeCls
                        : 'border-slate-200 bg-slate-50/60 hover:bg-slate-100/60 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <Icon size={16} className={isSelected ? 'text-current' : 'text-slate-400'} />
                      {isSelected && <Check size={12} strokeWidth={3} />}
                    </div>
                    <div className="mt-2">
                      <span className="text-xs font-black block">{t.label}</span>
                      <span className="text-[10px] text-slate-400 block">{t.desc}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ═══ CONDICIÓN LABORAL (SWITCH / TOGGLE) ═══ */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-black text-slate-800 block">Feriado con recargo al laborar</span>
                <span className="text-[11px] text-slate-500 block leading-tight">
                  {form.laborable
                    ? 'Si el trabajador asiste este día, devenga recargo de feriado automáticamente'
                    : 'Día no laborable (asueto remunerado regular de descanso)'}
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={form.laborable}
                  onChange={e => change('laborable', e.target.checked)}
                  disabled={pending}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
              </label>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ═══ ACCIONES DEL FORMULARIO ═══ */}
          <div className="flex gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-600 hover:bg-slate-50 active:scale-95 transition-all"
              disabled={pending}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending || isDuplicate || !form.nombre.trim()}
              className="flex-1 h-11 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 px-4 text-xs font-black text-white shadow-md shadow-primary/20 active:scale-95 transition-all flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 size={15} />
              <span>{pending ? 'Guardando...' : 'Guardar Feriado'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function BatchImportModal({ existingDates, onClose, onSubmit, pending }) {
  const currentYear = new Date().getUTCFullYear()
  const [year, setYear] = useState(currentYear)
  const [tipo, setTipo] = useState('nacional')
  const [imported, setImported] = useState(false)
  const [search, setSearch] = useState('')

  const holidays = useMemo(() => getVenezuelanHolidays(year), [year])
  const newHolidays = useMemo(() => {
    const unselected = holidays.filter(h => !existingDates.has(h.fecha))
    if (!search.trim()) return unselected
    const q = search.toLowerCase()
    return unselected.filter(h => h.nombre.toLowerCase().includes(q) || h.fecha.includes(q))
  }, [holidays, existingDates, search])

  const existingCount = holidays.length - holidays.filter(h => !existingDates.has(h.fecha)).length

  async function handleImport() {
    for (const h of newHolidays) {
      await onSubmit({ ...h, tipo })
    }
    setImported(true)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col animate-in fade-in slide-in-from-bottom-6 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold">
              <Download size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800">Importar Feriados Oficiales</h3>
              <p className="text-xs text-slate-400">Calendario de Ley de Venezuela · {year}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between bg-slate-50 p-3 rounded-2xl border border-slate-100">
            <span className="text-xs font-bold text-slate-600">Año del calendario:</span>
            <div className="flex items-center gap-2 bg-white px-2 py-1 rounded-xl border border-slate-200 shadow-sm">
              <button
                type="button"
                onClick={() => setYear(y => y - 1)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-600"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="w-12 text-center text-sm font-black text-slate-800">{year}</span>
              <button
                type="button"
                onClick={() => setYear(y => y + 1)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-600"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 uppercase block">Ya Registrados</span>
              <span className="text-sm font-black text-slate-700">{existingCount} de {holidays.length}</span>
            </div>
            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
              <span className="text-[10px] font-bold text-emerald-600 uppercase block">Disponibles a Importar</span>
              <span className="text-sm font-black text-emerald-700">{newHolidays.length} feriados</span>
            </div>
          </div>

          {newHolidays.length > 0 && (
            <div className="max-h-52 overflow-y-auto space-y-1.5 rounded-2xl border border-slate-100 p-2 bg-slate-50/50">
              {newHolidays.map(h => (
                <div key={h.fecha} className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-100 shadow-xs">
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="text-xs font-bold text-slate-800 truncate">{h.nombre}</p>
                    <p className="text-[11px] text-slate-400 capitalize">{formatReadableDate(h.fecha)}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold shrink-0">
                    {h.tipo}
                  </span>
                </div>
              ))}
            </div>
          )}

          {newHolidays.length === 0 && !imported && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-800 flex items-center gap-2">
              <Check size={16} className="text-amber-600 shrink-0" />
              <span>Todos los feriados oficiales de {year} ya están registrados en el sistema.</span>
            </div>
          )}

          {imported && (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <span>¡Feriados importados con éxito! Se han registrado en tu calendario de nómina.</span>
            </div>
          )}
        </div>

        <div className="flex gap-2.5 p-4 sm:p-5 border-t border-slate-100 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-11 rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-600 hover:bg-slate-50"
            disabled={pending}
          >
            {imported ? 'Cerrar' : 'Cancelar'}
          </button>
          {!imported && newHolidays.length > 0 && (
            <button
              type="button"
              onClick={handleImport}
              disabled={pending}
              className="flex-1 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-4 text-xs font-black text-white shadow-md shadow-emerald-600/20"
            >
              {pending ? 'Importando...' : `Importar ${newHolidays.length} Feriados`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel, pending, danger }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4 animate-in fade-in duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${danger ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-800">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{message}</p>
          </div>
        </div>
        <div className="flex gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-11 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
            disabled={pending}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`flex-1 h-11 rounded-xl px-3 text-xs font-black text-white disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary-hover'
            }`}
          >
            {pending ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
