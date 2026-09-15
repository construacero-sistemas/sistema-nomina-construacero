import { useState, useLayoutEffect, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight, X, Sparkles } from 'lucide-react'
import { OverlayContext, useOverlay } from './useOverlay.js'
import { useOverlayPosition } from './useOverlayPosition.js'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

function localDate(y, m, d) {
  const date = new Date(0)
  date.setHours(12, 0, 0, 0)
  date.setFullYear(y, m - 1, d)
  return date
}
function parseISO(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const date = localDate(y, m, d)
  return y > 0 && date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null
}
function formatISO(date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function addDays(date, amount) { return localDate(date.getFullYear(), date.getMonth() + 1, date.getDate() + amount) }
function addMonths(date, amount) {
  const first = localDate(date.getFullYear(), date.getMonth() + 1 + amount, 1)
  return localDate(first.getFullYear(), first.getMonth() + 1, Math.min(date.getDate(), localDate(first.getFullYear(), first.getMonth() + 2, 0).getDate()))
}

export default function DatePicker({ value, onChange, placeholder = 'DD/MM/AAAA', disabled = false,
  className = '', min, max, clearable = true, id, 'aria-label': ariaLabel, 'aria-labelledby': labelledBy }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const layerRef = useRef(null)
  const focusRef = useRef(null)
  const pendingFocus = useRef(false)
  const uid = useId()
  const parsedValue = parseISO(value)
  const minISO = parseISO(min) ? min : '0001-01-01'
  const maxISO = parseISO(max) ? max : '9999-12-31'
  const todayISO = formatISO(new Date())
  const withinRange = iso => Boolean(parseISO(iso)) && iso >= minISO && iso <= maxISO
  const clamp = iso => iso < minISO ? minISO : iso > maxISO ? maxISO : iso
  const initialISO = clamp(parsedValue ? value : todayISO)
  const [activeISO, setActiveISO] = useState(initialISO)
  const [viewISO, setViewISO] = useState(initialISO)
  const view = parseISO(viewISO) || parseISO(initialISO)
  const viewYear = view.getFullYear()
  const viewMonth = view.getMonth() + 1
  const { isMobile, position, mobileStyle } = useOverlayPosition({ open, anchorRef: triggerRef, panelRef: popoverRef, minWidth: 340, preferredHeight: 450 })
  const overlay = useOverlay({ open, panelRef: popoverRef, layerRef, returnFocusRef: triggerRef, initialFocusRef: focusRef,
    onRequestClose: () => setOpen(false), modal: isMobile, dismissOnOutside: !isMobile })

  useLayoutEffect(() => {
    if (open && pendingFocus.current) {
      focusRef.current?.focus({ preventScroll: true })
      pendingFocus.current = false
    }
  }, [open, activeISO, viewISO])

  function openCalendar() {
    if (disabled) return
    setViewISO(initialISO)
    setActiveISO(initialISO)
    setOpen(true)
  }
  function emitChange(iso) {
    if (disabled || (iso && !withinRange(iso))) return
    onChange?.(iso)
    setOpen(false)
  }
  function moveFocus(date) {
    const iso = clamp(formatISO(date))
    if (!withinRange(iso)) return
    pendingFocus.current = true
    setActiveISO(iso)
    setViewISO(iso)
  }
  function navigateDay(event, date) {
    let next
    if (event.key === 'ArrowLeft') next = addDays(date, -1)
    else if (event.key === 'ArrowRight') next = addDays(date, 1)
    else if (event.key === 'ArrowUp') next = addDays(date, -7)
    else if (event.key === 'ArrowDown') next = addDays(date, 7)
    else if (event.key === 'Home') next = addDays(date, -date.getDay())
    else if (event.key === 'End') next = addDays(date, 6 - date.getDay())
    else if (event.key === 'PageUp') next = addMonths(date, event.shiftKey ? -12 : -1)
    else if (event.key === 'PageDown') next = addMonths(date, event.shiftKey ? 12 : 1)
    if (next) { event.preventDefault(); moveFocus(next) }
  }
  function canViewMonth(amount) {
    const next = addMonths(localDate(viewYear, viewMonth, 1), amount)
    const first = formatISO(next)
    const last = formatISO(localDate(next.getFullYear(), next.getMonth() + 2, 0))
    return next.getFullYear() > 0 && next.getFullYear() <= 9999 && last >= minISO && first <= maxISO && minISO <= maxISO
  }
  function navigateMonth(amount) {
    if (!canViewMonth(amount)) return
    const iso = clamp(formatISO(addMonths(parseISO(activeISO) || view, amount)))
    setViewISO(iso)
    setActiveISO(iso)
  }
  const first = localDate(viewYear, viewMonth, 1)
  const start = addDays(first, -first.getDay())
  const count = Math.ceil((first.getDay() + localDate(viewYear, viewMonth + 1, 0).getDate()) / 7) * 7
  const gridDays = Array.from({ length: count }, (_, index) => addDays(start, index))
  const displayText = parsedValue ? `${String(parsedValue.getDate()).padStart(2, '0')}/${String(parsedValue.getMonth() + 1).padStart(2, '0')}/${parsedValue.getFullYear()}` : ''

  return <div className={`relative w-full min-w-0 ${className}`}>
    <div className="flex items-stretch gap-1 min-w-0">
      <button ref={triggerRef} id={id} type="button" disabled={disabled} onClick={() => open ? overlay.requestClose('trigger') : openCalendar()}
        aria-label={ariaLabel || `Fecha: ${displayText || placeholder}`} aria-labelledby={labelledBy}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${uid}-dialog` : undefined}
        className={`min-h-11 min-w-0 flex-1 rounded-xl border px-3 py-2 flex items-center justify-between gap-2 text-base sm:text-sm text-left ${disabled ? 'cursor-not-allowed bg-slate-100 border-slate-300 text-slate-600' : open ? 'border-primary ring-2 ring-primary/20 bg-white text-slate-900' : 'border-slate-300 bg-slate-50 hover:bg-white text-slate-800'}`}>
        <span className="min-w-0 break-words font-semibold">{displayText || placeholder}</span>
        <Calendar size={18} aria-hidden="true" className="text-slate-600 shrink-0" />
      </button>
      {clearable && value && !disabled && <button type="button" onClick={() => emitChange('')} aria-label="Borrar fecha"
        className="min-h-11 min-w-11 shrink-0 p-2 rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-100">
        <X size={18} aria-hidden="true" />
      </button>}
    </div>
    {open && createPortal(<OverlayContext.Provider value={overlay.overlayId}>
      <div ref={layerRef} data-overlay-id={overlay.overlayId}
        className={isMobile ? 'ui-overlay-layer fixed inset-0 flex items-end justify-center p-3 bg-slate-900/60 backdrop-blur-sm' : 'fixed'}
        style={{ ...(isMobile ? mobileStyle : position), zIndex: overlay.zIndex }}
        onClick={event => { if (event.target === event.currentTarget) overlay.requestClose('backdrop') }}>
        <div ref={popoverRef} role="dialog" id={`${uid}-dialog`} aria-modal={isMobile || undefined}
          aria-label="Elegir fecha" aria-describedby={`${uid}-help`} tabIndex={-1}
          className="date-picker-panel bg-white w-full max-w-sm min-w-0 rounded-3xl border border-slate-300 shadow-2xl text-slate-800 flex flex-col overflow-hidden"
          style={{ maxHeight: isMobile ? '100%' : position.maxHeight }}>
          <div className="ui-overlay-header flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 shrink-0">
            <h3 className="font-semibold">Elegir fecha</h3>
            <button type="button" onClick={() => overlay.requestClose('close-button')} aria-label="Cerrar calendario"
              className="min-h-11 min-w-11 p-2 rounded-xl text-slate-700 hover:bg-slate-100"><X size={20} aria-hidden="true" /></button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-2 py-3">
            <p id={`${uid}-help`} className="sr-only">Usa las flechas para elegir un día, Inicio y Fin para la semana, RePág y AvPág para cambiar de mes.</p>
            <div className="flex items-center justify-between gap-1 mb-2">
              <button type="button" onClick={() => navigateMonth(-1)} disabled={!canViewMonth(-1)} aria-label="Mes anterior"
                className="min-h-11 min-w-11 shrink-0 p-2 rounded-full hover:bg-slate-100 inline-flex items-center justify-center text-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed">
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
              <h4 id={`${uid}-month`} aria-live="polite" className="min-w-0 break-words text-center text-sm font-bold">{MESES[viewMonth - 1]} {viewYear}</h4>
              <button type="button" onClick={() => navigateMonth(1)} disabled={!canViewMonth(1)} aria-label="Mes siguiente"
                className="min-h-11 min-w-11 shrink-0 p-2 rounded-full hover:bg-slate-100 inline-flex items-center justify-center text-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed">
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            </div>
            <div role="grid" aria-labelledby={`${uid}-month`} className="date-picker-grid">
              <div role="row" className="grid grid-cols-7 text-center">
                {DIAS_SEMANA.map(day => <span key={day} role="columnheader" aria-label={day} className="text-xs font-semibold text-slate-600 py-2">{day.slice(0, 2)}</span>)}
              </div>
              {Array.from({ length: count / 7 }, (_, week) => <div key={week} role="row" className="grid grid-cols-7 text-center">
                {gridDays.slice(week * 7, week * 7 + 7).map(date => {
                  const iso = formatISO(date)
                  const selected = iso === value
                  const available = withinRange(iso)
                  const isToday = iso === todayISO
                  return <div key={iso} role="gridcell" aria-selected={selected} aria-disabled={!available || undefined} className="min-w-0">
                    <button ref={iso === activeISO ? focusRef : undefined} type="button" disabled={!available}
                      tabIndex={iso === activeISO && available ? 0 : -1} onClick={() => emitChange(iso)} onKeyDown={event => navigateDay(event, date)}
                      aria-label={date.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                      aria-current={isToday ? 'date' : undefined} data-date={iso}
                      className={`min-h-11 min-w-11 w-full rounded-full px-0 py-2 inline-flex items-center justify-center text-sm font-semibold ${selected ? 'bg-slate-800 text-white' : !available ? 'text-slate-500 bg-slate-50 cursor-not-allowed' : isToday ? 'bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-400' : date.getMonth() + 1 !== viewMonth ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-800 hover:bg-slate-100'}`}>
                      {date.getDate()}
                    </button>
                  </div>
                })}
              </div>)}
            </div>
          </div>
          <div className="ui-overlay-footer flex flex-wrap items-center justify-between gap-2 px-3 pt-2 border-t border-slate-200 shrink-0">
            {clearable && value && <button type="button" onClick={() => emitChange('')} className="min-h-11 px-3 py-2 rounded-xl text-slate-700 hover:bg-slate-100">Limpiar</button>}
            <button type="button" onClick={() => emitChange(todayISO)} disabled={!withinRange(todayISO)}
              className="min-h-11 flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 text-slate-800 font-semibold disabled:text-slate-500 disabled:cursor-not-allowed">
              <Sparkles size={16} aria-hidden="true" /><span>Hoy</span>
            </button>
            <button type="button" onClick={() => overlay.requestClose('close-button')} className="min-h-11 px-3 py-2 rounded-xl border border-slate-300 text-slate-700">Cerrar</button>
          </div>
        </div>
      </div>
    </OverlayContext.Provider>, document.body)}
  </div>
}
