// src/components/nomina/RateSelector.jsx
// Selector visual de tasa de cambio para cálculo secundario en Bolívares (Bs).
import { useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown, DollarSign, Edit2, RefreshCw } from 'lucide-react'
import useMonedaNomina, { formatBs } from '../../hooks/useMonedaNomina.js'

export function RateSelector({ className = '', compact = false }) {
  const {
    tipoTasa,
    setTipoTasa,
    tasaManual,
    tasaActiva,
    shortLabelTasa,
    opcionesTasa,
    tasasMercado,
    loading,
    refresh,
    tasaManualInfo = null,
    fijarTasaManual = async () => {},
    guardandoTasaManual = false,
    errorTasaManual = '',
    tasaFallback = null,
    stale = false,
  } = useMonedaNomina()

  const [open, setOpen] = useState(false)
  const [editingManual, setEditingManual] = useState(false)
  const [customVal, setCustomVal] = useState(tasaManual > 0 ? String(tasaManual) : '')
  const [motivoVal, setMotivoVal] = useState('')
  const [errorManual, setErrorManual] = useState('')
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const [menuPosition, setMenuPosition] = useState({ left: 12, top: 12 })

  useLayoutEffect(() => {
    if (!open) return undefined

    const positionMenu = () => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      const menu = menuRef.current?.getBoundingClientRect()
      if (!trigger || !menu) return

      const viewportWidth = window.visualViewport?.width || window.innerWidth
      const viewportHeight = window.visualViewport?.height || window.innerHeight
      const margin = 12
      const menuWidth = Math.min(256, viewportWidth - margin * 2)
      const left = Math.min(Math.max(margin, trigger.left), viewportWidth - menuWidth - margin)
      const below = viewportHeight - trigger.bottom - margin
      const above = trigger.top - margin
      const top = menu.height <= below || below >= above
        ? trigger.bottom + 8
        : Math.max(margin, trigger.top - Math.min(menu.height, above) - 8)

      setMenuPosition({ left, top })
    }

    positionMenu()
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    window.visualViewport?.addEventListener('resize', positionMenu)
    window.visualViewport?.addEventListener('scroll', positionMenu)

    return () => {
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
      window.visualViewport?.removeEventListener('resize', positionMenu)
      window.visualViewport?.removeEventListener('scroll', positionMenu)
    }
  }, [open, editingManual])

  function handleSelect(id) {
    if (id === 'manual') {
      setEditingManual(true)
      setErrorManual('')
    } else {
      setEditingManual(false)
      setTipoTasa(id)
      setOpen(false)
    }
  }

  // La tasa manual se guarda en el servidor con quién, cuándo y por qué
  // (trazable) y se sincroniza entre navegadores; el motivo es obligatorio.
  async function handleSaveManual(e) {
    if (e) e.preventDefault()
    const num = parseFloat(String(customVal).replace(',', '.'))
    if (!(num > 0)) { setErrorManual('Escribe una tasa mayor que cero.'); return }
    const motivo = motivoVal.trim()
    if (motivo.length < 3) { setErrorManual('Explica el motivo de la tasa (mínimo 3 caracteres).'); return }
    setErrorManual('')
    try {
      await fijarTasaManual(num, motivo)
      setEditingManual(false)
      setOpen(false)
    } catch {
      setErrorManual(errorTasaManual || 'No se pudo guardar la tasa manual.')
    }
  }

  return (
    <div className={`relative inline-block ${className}`}>
      {/* Botón trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 sm:py-1 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white transition-all text-xs font-bold active:scale-95 min-h-11 sm:min-h-0 ${compact ? 'text-[11px] px-2' : ''}`}
        style={{ touchAction: 'manipulation' }}
        title="Cambiar tasa de conversión a Bolívares"
        aria-label={`Cambiar tasa de conversión: ${shortLabelTasa} ${formatBs(tasaActiva)}`}
        aria-expanded={open}
      >
        <span className="text-white/60 font-semibold">{shortLabelTasa}:</span>
        <span className="font-black text-amber-300">
          {loading ? '...' : formatBs(tasaActiva).replace('Bs ', '')}
        </span>
        <ChevronDown size={13} className={`text-white/60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Popover / Menú desplegable */}
      {open && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
          <div
            ref={menuRef}
            className="fixed w-64 max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl bg-white text-slate-800 p-2.5 shadow-2xl border border-slate-200/80 z-[110] animate-in fade-in slide-in-from-top-2"
            style={{ left: menuPosition.left, top: menuPosition.top }}
          >
            {tasaFallback && (
              <p role="status" className="mb-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-semibold text-amber-900 leading-relaxed">
                {tasaFallback === 'sin_datos'
                  ? 'No hay tasas disponibles ahora. Los montos en Bs quedan sin equivalencia hasta que se actualicen.'
                  : 'La tasa elegida no tiene dato; se muestra la del BCV Dólar como referencia.'}
              </p>
            )}
            {stale && !tasaFallback && (
              <p role="status" className="mb-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-semibold text-amber-900">
                Tasas desactualizadas: se usa la última conocida.
              </p>
            )}
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-100 mb-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Tasa secundaria (Bs)
              </span>
              <button
                type="button"
                onClick={() => refresh()}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                title="Actualizar tasas"
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            <div className="space-y-1">
              {opcionesTasa.map(opt => {
                const isSelected = tipoTasa === opt.id
                let valor = 0
                if (opt.id === 'bcv_usd') valor = tasasMercado.bcv_usd
                if (opt.id === 'bcv_eur') valor = tasasMercado.bcv_eur
                if (opt.id === 'usdt') valor = tasasMercado.usdt
                if (opt.id === 'manual') valor = tasaManual

                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelect(opt.id)}
                    className={`w-full min-h-11 flex items-center justify-between px-2.5 py-2 rounded-xl text-left text-xs transition-all ${
                      isSelected
                        ? 'bg-amber-50 text-amber-950 font-black border border-amber-200'
                        : 'hover:bg-slate-50 text-slate-700 font-semibold'
                    }`}
                    style={{ touchAction: 'manipulation' }}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <div className={`w-4 h-4 shrink-0 rounded-full flex items-center justify-center ${isSelected ? 'bg-amber-500 text-white' : 'border border-slate-300'}`}>
                        {isSelected && <Check size={10} strokeWidth={3} />}
                      </div>
                      <span className="truncate">{opt.label}</span>
                    </div>

                    <span className="shrink-0 font-mono font-bold text-slate-600">
                      {valor > 0 ? `${valor.toFixed(2)} Bs` : (opt.id === 'manual' ? 'Definir' : 'Sin dato')}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Input para tasa manual */}
            {editingManual && (
              <form onSubmit={handleSaveManual} className="mt-2 pt-2 border-t border-slate-100 space-y-1.5 animate-in fade-in">
                <label className="block text-[10px] font-bold text-slate-500 uppercase">Ingresar tasa manual (Bs/$)</label>
                <div className="flex min-w-0 gap-1.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="Ej. 42.50"
                    value={customVal}
                    onChange={e => setCustomVal(e.target.value)}
                    autoFocus
                    disabled={guardandoTasaManual}
                    className="h-11 w-0 min-w-0 flex-1 rounded-xl border border-slate-300 px-2.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="submit"
                    disabled={guardandoTasaManual}
                    className="h-11 shrink-0 rounded-xl bg-primary px-3.5 text-xs font-black text-white hover:bg-primary-hover active:scale-95 disabled:opacity-50"
                  >
                    {guardandoTasaManual ? 'Guardando…' : 'Fijar'}
                  </button>
                </div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase">Motivo (quién y por qué)</label>
                <input
                  type="text"
                  maxLength={300}
                  placeholder="Ej. Tasa acordada con finanzas para la semana"
                  value={motivoVal}
                  onChange={e => setMotivoVal(e.target.value)}
                  disabled={guardandoTasaManual}
                  className="h-11 w-full rounded-xl border border-slate-300 px-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                {(errorManual || errorTasaManual) && (
                  <p role="alert" className="text-[10px] font-bold text-rose-700">{errorManual || errorTasaManual}</p>
                )}
              </form>
            )}

            <div className="mt-2 pt-1.5 border-t border-slate-100 px-1 text-[10px] text-slate-400 text-center space-y-0.5">
              <p>Moneda principal: <strong>USD ($)</strong> · Secundaria: <strong>Bs</strong></p>
              {tasaManualInfo?.fijada_por_nombre && (
                <p>
                  Tasa manual fijada por <strong>{tasaManualInfo.fijada_por_nombre}</strong>
                  {tasaManualInfo.observado_en ? ` · ${String(tasaManualInfo.observado_en).slice(0, 10)}` : ''}
                  {tasaManualInfo.motivo ? ` · ${tasaManualInfo.motivo}` : ''}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default RateSelector

