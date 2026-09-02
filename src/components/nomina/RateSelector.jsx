// src/components/nomina/RateSelector.jsx
// Selector visual de tasa de cambio para cálculo secundario en Bolívares (Bs).
import { useState } from 'react'
import { Check, ChevronDown, DollarSign, Edit2, RefreshCw } from 'lucide-react'
import useMonedaNomina, { formatBs } from '../../hooks/useMonedaNomina.js'

export function RateSelector({ className = '', compact = false }) {
  const {
    tipoTasa,
    setTipoTasa,
    tasaManual,
    setTasaManual,
    tasaActiva,
    shortLabelTasa,
    opcionesTasa,
    tasasMercado,
    loading,
    refresh,
  } = useMonedaNomina()

  const [open, setOpen] = useState(false)
  const [editingManual, setEditingManual] = useState(false)
  const [customVal, setCustomVal] = useState(tasaManual > 0 ? String(tasaManual) : '')

  function handleSelect(id) {
    if (id === 'manual') {
      setEditingManual(true)
    } else {
      setEditingManual(false)
      setTipoTasa(id)
      setOpen(false)
    }
  }

  function handleSaveManual(e) {
    if (e) e.preventDefault()
    const num = parseFloat(customVal.replace(',', '.'))
    if (num > 0) {
      setTasaManual(num)
      setEditingManual(false)
      setOpen(false)
    }
  }

  return (
    <div className={`relative inline-block ${className}`}>
      {/* Botón trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white transition-all text-xs font-bold active:scale-95"
        title="Cambiar tasa de conversión a Bolívares"
      >
        <span className="text-white/60 font-semibold">{shortLabelTasa}:</span>
        <span className="font-black text-amber-300">
          {loading ? '...' : formatBs(tasaActiva).replace('Bs ', '')}
        </span>
        <ChevronDown size={13} className={`text-white/60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Popover / Menú desplegable */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white text-slate-800 p-2.5 shadow-2xl border border-slate-200/80 z-50 animate-in fade-in slide-in-from-top-2">
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
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-left text-xs transition-all ${
                      isSelected
                        ? 'bg-amber-50 text-amber-950 font-black border border-amber-200'
                        : 'hover:bg-slate-50 text-slate-700 font-semibold'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center ${isSelected ? 'bg-amber-500 text-white' : 'border border-slate-300'}`}>
                        {isSelected && <Check size={10} strokeWidth={3} />}
                      </div>
                      <span>{opt.label}</span>
                    </div>

                    <span className="font-mono font-bold text-slate-600">
                      {valor > 0 ? `${valor.toFixed(2)} Bs` : (opt.id === 'manual' ? 'Definir' : '—')}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Input para tasa manual */}
            {editingManual && (
              <form onSubmit={handleSaveManual} className="mt-2 pt-2 border-t border-slate-100 space-y-1.5 animate-in fade-in">
                <label className="block text-[10px] font-bold text-slate-500 uppercase">Ingresar tasa manual (Bs/$)</label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="Ej. 42.50"
                    value={customVal}
                    onChange={e => setCustomVal(e.target.value)}
                    autoFocus
                    className="flex-1 h-11 rounded-xl border border-slate-300 px-2.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="submit"
                    className="px-3.5 h-11 rounded-xl bg-primary text-white text-xs font-black hover:bg-primary-hover active:scale-95"
                  >
                    Fijar
                  </button>
                </div>
              </form>
            )}

            <div className="mt-2 pt-1.5 border-t border-slate-100 px-1 text-[10px] text-slate-400 text-center">
              Moneda principal: <strong>USD ($)</strong> · Secundaria: <strong>Bs</strong>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default RateSelector

