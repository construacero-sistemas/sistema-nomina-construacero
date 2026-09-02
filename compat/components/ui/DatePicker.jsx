// compat/components/ui/DatePicker.jsx
// Selector de fecha interactivo con estética moderna, bordes redondeados y experiencia móvil optimizada.
// Reemplaza el control nativo cuadrado de HTML5 por un calendario visual estilizado.
import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight, X, Sparkles } from 'lucide-react'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

const DIAS_SEMANA = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa']

function parseISO(str) {
  if (!str || typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null
  const [y, m, d] = str.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return isNaN(date.getTime()) ? null : { y, m, d, date }
}

function formatISO(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function formatDisplay(isoStr) {
  const parsed = parseISO(isoStr)
  if (!parsed) return ''
  return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m).padStart(2, '0')}/${parsed.y}`
}

export default function DatePicker({
  value,
  onChange,
  placeholder = 'DD/MM/AAAA',
  disabled = false,
  className = '',
  min,
  max,
  clearable = true,
}) {
  const [open, setOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [portalPos, setPortalPos] = useState({ top: 0, left: 0, width: 280 })
  const containerRef = useRef(null)
  const popoverRef = useRef(null)

  const parsedVal = useMemo(() => parseISO(value), [value])

  const todayObj = useMemo(() => {
    const n = new Date()
    return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() }
  }, [])

  // Mes y Año en vista en el calendario (derivado o navegado)
  const [viewOverride, setViewOverride] = useState(null)

  const viewYear = viewOverride?.y ?? parsedVal?.y ?? todayObj.y
  const viewMonth = viewOverride?.m ?? parsedVal?.m ?? todayObj.m

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Posicionamiento inteligente del popover
  useEffect(() => {
    if (!open || isMobile) return
    const updatePos = () => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const popoverWidth = 300
      const popoverHeight = 340

      let top = rect.bottom + window.scrollY + 6
      let left = rect.left + window.scrollX

      // Si se desborda por la derecha
      if (left + popoverWidth > window.innerWidth - 12) {
        left = window.innerWidth - popoverWidth - 12
      }
      if (left < 12) left = 12

      // Si se desborda por abajo, abrir hacia arriba
      if (rect.bottom + popoverHeight > window.innerHeight && rect.top - popoverHeight > 0) {
        top = rect.top + window.scrollY - popoverHeight - 6
      }

      setPortalPos({ top, left, width: popoverWidth })
    }

    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open, isMobile])

  // Click outside para cerrar
  useEffect(() => {
    if (!open) return
    function handleClickOutside(e) {
      if (
        containerRef.current && !containerRef.current.contains(e.target) &&
        popoverRef.current && !popoverRef.current.contains(e.target)
      ) {
        setOpen(false)
        setViewOverride(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [open])

  // Matriz de días del mes
  const gridDays = useMemo(() => {
    const firstDayIndex = new Date(viewYear, viewMonth - 1, 1).getDay() // 0 = Domingo
    const daysInCurrentMonth = new Date(viewYear, viewMonth, 0).getDate()
    const daysInPrevMonth = new Date(viewYear, viewMonth - 1, 0).getDate()

    const cells = []

    // Días del mes anterior
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i
      const prevM = viewMonth === 1 ? 12 : viewMonth - 1
      const prevY = viewMonth === 1 ? viewYear - 1 : viewYear
      cells.push({
        y: prevY,
        m: prevM,
        d,
        iso: formatISO(prevY, prevM, d),
        isCurrentMonth: false,
      })
    }

    // Días del mes actual
    for (let i = 1; i <= daysInCurrentMonth; i++) {
      cells.push({
        y: viewYear,
        m: viewMonth,
        d: i,
        iso: formatISO(viewYear, viewMonth, i),
        isCurrentMonth: true,
      })
    }

    // Días del mes siguiente para completar cuadrícula (múltiplo de 7)
    const remaining = (7 - (cells.length % 7)) % 7
    for (let i = 1; i <= remaining; i++) {
      const nextM = viewMonth === 12 ? 1 : viewMonth + 1
      const nextY = viewMonth === 12 ? viewYear + 1 : viewYear
      cells.push({
        y: nextY,
        m: nextM,
        d: i,
        iso: formatISO(nextY, nextM, i),
        isCurrentMonth: false,
      })
    }

    return cells
  }, [viewYear, viewMonth])

  function handlePrevMonth() {
    if (viewMonth === 1) {
      setViewOverride({ y: viewYear - 1, m: 12 })
    } else {
      setViewOverride({ y: viewYear, m: viewMonth - 1 })
    }
  }

  function handleNextMonth() {
    if (viewMonth === 12) {
      setViewOverride({ y: viewYear + 1, m: 1 })
    } else {
      setViewOverride({ y: viewYear, m: viewMonth + 1 })
    }
  }

  function emitChange(newIso) {
    if (typeof onChange === 'function') {
      onChange(newIso)
    }
    setOpen(false)
    setViewOverride(null)
  }

  function selectDay(cell) {
    emitChange(cell.iso)
  }

  function selectToday() {
    const todayIso = formatISO(todayObj.y, todayObj.m, todayObj.d)
    setViewOverride({ y: todayObj.y, m: todayObj.m })
    emitChange(todayIso)
  }

  function clearSelection(e) {
    e.stopPropagation()
    emitChange('')
  }

  const displayText = parsedVal ? formatDisplay(value) : ''

  const calendarContent = (
    <div
      ref={popoverRef}
      className={`bg-white rounded-3xl border border-slate-200/90 shadow-2xl shadow-slate-900/15 p-4 text-slate-800 select-none ${
        isMobile
          ? 'w-full max-w-sm mx-auto'
          : 'w-[304px]'
      }`}
      style={{ touchAction: 'manipulation' }}
    >
      {/* Cabecera del Mes & Navegación */}
      <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-100">
        <button
          type="button"
          onClick={handlePrevMonth}
          className="w-8 h-8 rounded-full hover:bg-slate-100 active:scale-95 flex items-center justify-center text-slate-600 transition-all"
          aria-label="Mes anterior"
        >
          <ChevronLeft size={17} />
        </button>

        <div className="text-center">
          <span className="text-xs font-black text-slate-800 tracking-wide block capitalize">
            {MESES[viewMonth - 1]} {viewYear}
          </span>
        </div>

        <button
          type="button"
          onClick={handleNextMonth}
          className="w-8 h-8 rounded-full hover:bg-slate-100 active:scale-95 flex items-center justify-center text-slate-600 transition-all"
          aria-label="Mes siguiente"
        >
          <ChevronRight size={17} />
        </button>
      </div>

      {/* Días de la Semana */}
      <div className="grid grid-cols-7 gap-1 text-center mb-1">
        {DIAS_SEMANA.map(d => (
          <span key={d} className="text-[11px] font-bold text-slate-400 py-1">
            {d}
          </span>
        ))}
      </div>

      {/* Cuadrícula de Días (Completamente Redondeados) */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {gridDays.map((cell, idx) => {
          const isSelected = value === cell.iso
          const isToday = cell.iso === formatISO(todayObj.y, todayObj.m, todayObj.d)

          let btnClass = 'w-9 h-9 mx-auto rounded-full flex items-center justify-center text-xs font-bold transition-all relative '

          if (isSelected) {
            btnClass += 'bg-primary text-white font-black shadow-md shadow-primary/30 scale-105 '
          } else if (isToday) {
            btnClass += 'bg-amber-100 text-amber-900 border border-amber-300 font-black hover:bg-amber-200 '
          } else if (!cell.isCurrentMonth) {
            btnClass += 'text-slate-300 hover:text-slate-500 hover:bg-slate-50 '
          } else {
            btnClass += 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 active:scale-95 '
          }

          return (
            <button
              key={`${cell.iso}-${idx}`}
              type="button"
              onClick={() => selectDay(cell)}
              className={btnClass}
            >
              <span>{cell.d}</span>
              {isToday && !isSelected && (
                <span className="w-1 h-1 rounded-full bg-amber-500 absolute bottom-1" />
              )}
            </button>
          )
        })}
      </div>

      {/* Acciones Rápidas Inferiores */}
      <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100 text-xs">
        {clearable && value ? (
          <button
            type="button"
            onClick={clearSelection}
            className="text-slate-400 hover:text-red-600 font-bold px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
          >
            Limpiar
          </button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={selectToday}
            className="text-primary hover:text-primary-hover font-black px-2.5 py-1 rounded-xl bg-primary/10 hover:bg-primary/20 transition-colors flex items-center gap-1"
          >
            <Sparkles size={12} />
            <span>Hoy</span>
          </button>
          {isMobile && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div ref={containerRef} className={`relative inline-block w-full ${className}`}>
      {/* Botón Trigger del Input */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={e => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault()
            setOpen(o => !o)
          }
        }}
        className={`w-full h-11 rounded-xl border px-3 flex items-center justify-between text-xs transition-all cursor-pointer select-none ${
          disabled
            ? 'opacity-50 cursor-not-allowed bg-slate-100 border-slate-200 text-slate-400'
            : open
            ? 'border-primary ring-2 ring-primary/20 bg-white text-slate-900 shadow-sm'
            : 'border-slate-200 bg-slate-50 hover:bg-white text-slate-800'
        }`}
        style={{ touchAction: 'manipulation' }}
      >
        <span className={`font-semibold truncate ${!displayText ? 'text-slate-400' : 'text-slate-800'}`}>
          {displayText || placeholder}
        </span>

        <div className="flex items-center gap-1 text-slate-400">
          {clearable && value && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={clearSelection}
              className="p-1 hover:text-slate-600 rounded-full hover:bg-slate-200/50 transition-colors"
              title="Borrar fecha"
            >
              <X size={13} />
            </span>
          )}
          <Calendar size={15} className={open ? 'text-primary' : 'text-slate-400'} />
        </div>
      </div>

      {/* Renderizado Popover / Portal */}
      {open && (
        isMobile ? (
          createPortal(
            <div
              className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-3 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
              onClick={() => setOpen(false)}
            >
              <div
                className="w-full max-w-sm animate-in slide-in-from-bottom duration-200"
                onClick={e => e.stopPropagation()}
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
              >
                {calendarContent}
              </div>
            </div>,
            document.body
          )
        ) : (
          createPortal(
            <div
              style={{
                position: 'absolute',
                top: `${portalPos.top}px`,
                left: `${portalPos.left}px`,
                zIndex: 9999,
              }}
              className="animate-in fade-in zoom-in-95 duration-100"
            >
              {calendarContent}
            </div>,
            document.body
          )
        )
      )}
    </div>
  )
}
