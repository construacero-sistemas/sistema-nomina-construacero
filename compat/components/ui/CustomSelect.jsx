import { useState, useEffect, useRef, useMemo, useId } from 'react'
import { createPortal } from 'react-dom'
import { Search, ChevronDown, X, Check, Plus } from 'lucide-react'
import { normalizar, matchScore } from './selectMatching.js'
import { OverlayContext, useOverlay } from './useOverlay.js'
import { useOverlayPosition } from './useOverlayPosition.js'

export default function CustomSelect({ options = [], value, onChange, placeholder = 'Seleccionar...', searchable,
  clearable = false, creatable = false, createLabel = 'Crear', createMaxLength = null, disabled = false,
  icon: TriggerIcon, showSubInTrigger = true, rowAction, id, 'aria-label': ariaLabel, 'aria-labelledby': labelledBy }) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [showInlineCreate, setShowInlineCreate] = useState(false)
  const [newValueText, setNewValueText] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const triggerRef = useRef(null)
  const dropdownRef = useRef(null)
  const searchRef = useRef(null)
  const listRef = useRef(null)
  const inlineRef = useRef(null)
  const uid = useId()
  const listboxId = `${uid}-list`
  const dialogId = `${uid}-dialog`
  const showSearch = searchable ?? (creatable || options.length > 5)
  const { isMobile, position, mobileStyle } = useOverlayPosition({ open: abierto, anchorRef: triggerRef, panelRef: dropdownRef })

  function close() {
    setAbierto(false)
    setBusqueda('')
    setShowInlineCreate(false)
    setNewValueText('')
    setActiveIndex(-1)
  }
  const overlay = useOverlay({ open: abierto, panelRef: dropdownRef, onRequestClose: close, modal: isMobile,
    returnFocusRef: triggerRef, initialFocusRef: showSearch ? searchRef : listRef, dismissOnOutside: !isMobile })

  const seleccionada = options.find(option => option.value === value)
  const [lastLabel, setLastLabel] = useState(null)
  if (seleccionada) {
    const label = seleccionada.selectedLabel || seleccionada.label
    if (!lastLabel || lastLabel.value !== value || lastLabel.label !== label) setLastLabel({ value, label })
  } else if (!value && lastLabel) setLastLabel(null)
  const seleccionadaLabel = seleccionada?.selectedLabel || seleccionada?.label ||
    (value && lastLabel?.value === value ? lastLabel.label : (creatable && value ? value : null))
  const filtradas = useMemo(() => {
    if (!busqueda.trim()) return options
    return options.map(option => ({ ...option, _score: Math.max(matchScore(option.label, busqueda.trim()), matchScore(option.sub ?? '', busqueda.trim())) }))
      .filter(option => option._score > 0).sort((a, b) => b._score - a._score)
  }, [options, busqueda])
  const opcionActiva = filtradas.length ? (activeIndex >= 0 ? Math.min(activeIndex, filtradas.length - 1)
    : Math.max(0, filtradas.findIndex(option => option.value === value))) : -1
  const activeId = opcionActiva >= 0 ? `${listboxId}-opt-${opcionActiva}` : undefined
  const puedeCrear = creatable && busqueda.trim() && !options.some(option => normalizar(option.label) === normalizar(busqueda.trim())) &&
    (!createMaxLength || busqueda.trim().length <= createMaxLength)

  useEffect(() => {
    if (abierto && activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' })
  }, [abierto, activeId])
  useEffect(() => { if (showInlineCreate) inlineRef.current?.focus() }, [showInlineCreate])

  function elegir(nextValue) {
    if (disabled) return
    onChange?.(nextValue)
    close()
  }
  function crear(text) {
    const next = text.trim()
    if (!next || (createMaxLength && next.length > createMaxLength)) return
    elegir(next)
  }
  function navegarTeclado(event) {
    if (event.isComposing) return
    if (!abierto) {
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) && !disabled) {
        event.preventDefault()
        setAbierto(true)
      }
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!filtradas.length) return
      if (event.key === 'Home') setActiveIndex(0)
      else if (event.key === 'End') setActiveIndex(filtradas.length - 1)
      else setActiveIndex(Math.max(0, Math.min(filtradas.length - 1, opcionActiva + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (opcionActiva >= 0) elegir(filtradas[opcionActiva].value)
      else if (puedeCrear) crear(busqueda)
    }
  }

  return (
    <div className="relative min-w-0 max-w-full">
      <div className="flex items-stretch gap-1 min-w-0">
        <button ref={triggerRef} id={id} type="button" disabled={disabled}
          onClick={() => { if (abierto) overlay.requestClose('trigger'); else setAbierto(true) }}
          onKeyDown={navegarTeclado} role="combobox" aria-haspopup="dialog" aria-expanded={abierto}
          aria-controls={abierto ? dialogId : undefined} aria-label={ariaLabel || placeholder} aria-labelledby={labelledBy}
          className={`min-h-11 min-w-0 flex-1 flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-left text-base sm:text-sm transition-colors ${disabled ? 'cursor-not-allowed bg-slate-100 border-slate-300 text-slate-600' : abierto ? 'border-primary bg-white ring-1 ring-primary/30' : 'border-slate-300 bg-white hover:border-slate-500'}`}>
          {(() => { const Icon = TriggerIcon || seleccionada?.icon; return Icon ? <Icon size={18} aria-hidden="true" className="text-slate-600 shrink-0" /> : null })()}
          <span className={`min-w-0 flex-1 break-words ${seleccionadaLabel ? 'text-slate-800 font-medium' : 'text-slate-600'}`}>{seleccionadaLabel || placeholder}</span>
          {showSubInTrigger && seleccionada?.sub && <span className="text-xs text-slate-600 break-words max-w-[120px] hidden sm:inline">{seleccionada.sub}</span>}
          <ChevronDown size={18} aria-hidden="true" className={`text-slate-600 shrink-0 ${abierto ? 'rotate-180' : ''}`} />
        </button>
        {clearable && seleccionadaLabel && !disabled && <button type="button" aria-label="Limpiar selección"
          onClick={() => { onChange?.(''); setBusqueda(''); setActiveIndex(-1); triggerRef.current?.focus() }}
          className="min-h-11 min-w-11 shrink-0 rounded-xl border border-slate-300 bg-white p-2.5 text-slate-600 hover:bg-slate-100">
          <X size={18} aria-hidden="true" />
        </button>}
      </div>
      {abierto && createPortal(
        <OverlayContext.Provider value={overlay.overlayId}>
          <div ref={dropdownRef} id={dialogId} role="dialog" aria-modal={isMobile || undefined} aria-label={placeholder} tabIndex={-1}
            data-overlay-id={overlay.overlayId}
            className={`ui-select-sheet bg-white flex flex-col min-w-0 overflow-hidden border border-slate-300 shadow-2xl ${isMobile ? 'rounded-t-3xl' : 'rounded-2xl p-1.5'}`}
            style={{ ...(isMobile ? mobileStyle : position), zIndex: overlay.zIndex }}>
            <div className={`ui-overlay-header flex items-center justify-between gap-2 shrink-0 border-b border-slate-200 ${isMobile ? 'px-4 py-3' : 'px-2 py-1'}`}>
              <h3 className="min-w-0 break-words font-semibold text-slate-800">{placeholder}</h3>
              <button type="button" onClick={() => overlay.requestClose('close-button')} aria-label="Cerrar opciones"
                className="min-h-11 min-w-11 shrink-0 inline-flex items-center justify-center p-2 rounded-xl text-slate-700 hover:bg-slate-100">
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            {showSearch && <div className="p-3 shrink-0 border-b border-slate-200">
              <div className="relative">
                <Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                <input ref={searchRef} type="text" inputMode="search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                  role="combobox" aria-label={`Buscar: ${placeholder}`} aria-expanded="true" aria-autocomplete="list" aria-haspopup="listbox"
                  aria-controls={listboxId} aria-activedescendant={activeId} onKeyDown={navegarTeclado}
                  value={busqueda} onChange={event => { setBusqueda(event.target.value); setActiveIndex(-1) }}
                  maxLength={createMaxLength || undefined} placeholder="Buscar..."
                  className="min-h-11 w-full min-w-0 pl-10 pr-3 py-2 text-[16px] border border-slate-300 rounded-xl bg-slate-50 text-slate-800 placeholder:text-slate-600" />
              </div>
            </div>}
            <div className="overflow-y-auto overscroll-contain flex-1 min-h-0 p-2">
              {!filtradas.length && <p role="status" className="text-sm text-slate-600 text-center py-4">{busqueda ? 'Sin resultados' : 'Sin opciones'}</p>}
              <div ref={listRef} id={listboxId} role="listbox" aria-label={placeholder}
                tabIndex={showSearch ? -1 : 0} aria-activedescendant={!showSearch ? activeId : undefined}
                onKeyDown={event => { if (event.target === event.currentTarget) navegarTeclado(event) }} className="space-y-1 rounded-xl">
                {filtradas.map((option, index) => {
                  const selected = option.value === value
                  const Icon = option.icon
                  return <div key={option.value} role="presentation" className="flex gap-1 items-stretch min-w-0">
                    <button type="button" id={`${listboxId}-opt-${index}`} role="option" aria-selected={selected}
                      tabIndex={-1} onClick={() => elegir(option.value)} onMouseEnter={() => setActiveIndex(index)}
                      className={`min-h-11 min-w-0 flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl text-left ${selected ? 'bg-slate-800 text-white font-semibold' : index === opcionActiva ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}>
                      {Icon && <Icon size={18} aria-hidden="true" className="shrink-0" />}
                      <span className="min-w-0 flex-1 break-words"><span className="block text-base sm:text-sm">{option.label}</span>
                        {option.sub && <span className={`block text-xs mt-0.5 ${selected ? 'text-slate-100' : 'text-slate-600'}`}>{option.sub}</span>}
                      </span>
                      {selected && <Check size={18} aria-hidden="true" className="shrink-0" />}
                    </button>
                    {rowAction && !option.noAction && <button type="button" aria-label={`${rowAction.label} ${option.label}`} title={rowAction.title}
                      onClick={() => { rowAction.onSelect(option); close() }}
                      className="min-h-11 min-w-11 shrink-0 rounded-xl p-2 text-rose-700 hover:bg-rose-50">
                      {rowAction.icon ? <rowAction.icon size={18} aria-hidden="true" /> : rowAction.label}
                    </button>}
                  </div>
                })}
              </div>
            </div>
            <div className="ui-overlay-footer shrink-0 border-t border-slate-200 px-3 pt-2 text-slate-700">
              {puedeCrear && <button type="button" onClick={() => crear(busqueda)}
                className="min-h-11 w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left bg-emerald-50 text-emerald-800">
                <Plus size={18} aria-hidden="true" className="shrink-0" /><span className="min-w-0 break-words">{createLabel} "{busqueda.trim()}"</span>
              </button>}
              {creatable && (showInlineCreate ? <div className="flex flex-wrap gap-2 items-center py-2">
                <input ref={inlineRef} type="text" aria-label={createLabel} value={newValueText} maxLength={createMaxLength || undefined}
                  onChange={event => setNewValueText(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); crear(newValueText) } }}
                  placeholder={`${createLabel}...`} className="min-h-11 min-w-0 w-full px-3 py-2 text-[16px] border border-slate-300 rounded-xl bg-white text-slate-800" />
                <button type="button" onClick={() => crear(newValueText)} disabled={!newValueText.trim()}
                  className="min-h-11 px-4 py-2 rounded-xl bg-indigo-700 text-white disabled:bg-slate-600">Agregar</button>
                <button type="button" onClick={() => { setShowInlineCreate(false); setNewValueText('') }} aria-label="Cancelar creación"
                  className="min-h-11 min-w-11 p-2 rounded-xl text-slate-700 hover:bg-slate-100"><X size={18} aria-hidden="true" /></button>
              </div> : <button type="button" onClick={() => setShowInlineCreate(true)}
                className="min-h-11 w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-indigo-800 hover:bg-indigo-50">
                <Plus size={18} aria-hidden="true" className="shrink-0" /><span className="break-words">{createLabel}</span>
              </button>)}
              {isMobile && <button type="button" onClick={() => overlay.requestClose('close-button')}
                className="min-h-11 w-full px-3 py-2 mt-1 rounded-xl border border-slate-300 font-semibold text-slate-700">Cerrar</button>}
            </div>
          </div>
        </OverlayContext.Provider>, document.body)}
    </div>
  )
}
