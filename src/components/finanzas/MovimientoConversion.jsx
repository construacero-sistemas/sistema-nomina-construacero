// src/components/finanzas/MovimientoConversion.jsx
// Sección de equivalencia (VES/USD) + selector de tasa (BCV/USDT/Manual) del
// formulario de movimiento. Extraída de MovimientoForm para mantener el límite
// de 600 líneas por archivo del guardrail.
import { ChevronUp, SlidersHorizontal, Sparkles } from 'lucide-react'

function formatNumber(value) {
  return Number(value || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// Flags temporales: ocultan la fila de tasa ("Tasa: X Bs/$ (BCV) · Cambiar")
// y la línea de equivalencia ("Equivale a ≈ ...") del bloque de conversión.
// Al poner true reaparecen.
const MOSTRAR_TASA = false
const MOSTRAR_EQUIVALE = false

export default function MovimientoConversion({
  esVes,
  equivalenteUsd,
  equivalenteVes,
  tasaEfectiva,
  modoTasa,
  usarBcv,
  usarUsdt,
  usarManual,
  mostrarOpcionesTasa,
  abrirSelector,
  cerrarSelector,
  tasaManual,
  setTasaManual,
  observacionTasa,
  setObservacionTasa,
  usd,
  usdt,
  disabled,
}) {
  // Si tanto la equivalencia como la tasa están ocultas, no rendimos nada
  // (el bloque de conversión completo desaparece del formulario).
  if (!MOSTRAR_EQUIVALE && !MOSTRAR_TASA) return null

  return (
    <div className="space-y-2 pt-2.5 border-t border-slate-200/80">
      <div className="space-y-2 text-xs">
        {MOSTRAR_EQUIVALE && (
        <div className="flex items-center gap-1.5 font-bold text-slate-800">
          <Sparkles size={14} className="text-amber-600 shrink-0" />
          {esVes ? (
            <span>
              Equivale a ≈ <strong className="text-primary font-black">${formatNumber(equivalenteUsd)} USD</strong>
            </span>
          ) : (
            <span>
              Equivale a ≈ <strong className="text-emerald-700 font-black">Bs. {formatNumber(equivalenteVes)} VES</strong>
            </span>
          )}
        </div>
        )}

        {/* Tasa aplicada y Botón para ver/ocultar selector */}
        {MOSTRAR_TASA && (!mostrarOpcionesTasa ? (
          <div className="flex items-center justify-between gap-2 w-full text-slate-500">
            <span className="text-[11px] font-bold min-w-0 truncate">
              Tasa: <strong className="text-slate-700 font-black">{formatNumber(tasaEfectiva)} Bs/$</strong> ({modoTasa === 'manual' ? 'Manual' : modoTasa.toUpperCase()})
            </span>
            <button
              type="button"
              onClick={abrirSelector}
              className="inline-flex items-center gap-1 px-3 h-9 shrink-0 rounded-lg bg-slate-200/80 hover:bg-slate-300 text-[11px] font-black text-slate-700 transition-all cursor-pointer active:scale-95"
              title="Elegir o personalizar tasa de cambio"
              style={{ touchAction: 'manipulation' }}
            >
              <SlidersHorizontal size={12} />
              <span>Cambiar</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-slate-500">Tasa:</span>
            <div className="inline-flex items-center rounded-xl p-1 bg-slate-200/80 border border-slate-300/60">
              <button
                type="button"
                onClick={() => { usarBcv(); setTasaManual('') }}
                className={`px-2.5 h-8 rounded-lg text-[11px] font-black transition-all cursor-pointer ${modoTasa === 'bcv' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
              >
                BCV ({formatNumber(usd)})
              </button>
              {usdt > 0 && (
                <button
                  type="button"
                  onClick={() => { usarUsdt(); setTasaManual('') }}
                  className={`px-2.5 h-8 rounded-lg text-[11px] font-black transition-all cursor-pointer ${modoTasa === 'usdt' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  USDT ({formatNumber(usdt)})
                </button>
              )}
              <button
                type="button"
                onClick={() => { usarManual(); setTasaManual('') }}
                className={`px-2.5 h-8 rounded-lg text-[11px] font-black transition-all cursor-pointer ${modoTasa === 'manual' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Manual
              </button>
            </div>
            <button
              type="button"
              onClick={cerrarSelector}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
              title="Ocultar selector de tasa"
              aria-label="Ocultar selector de tasa"
            >
              <ChevronUp size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Input de Tasa Manual cuando está abierto */}
      {mostrarOpcionesTasa && modoTasa === 'manual' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <div className="space-y-1">
            <label className="block text-[11px] font-bold text-slate-600">Tasa personalizada (Bs/$):</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={tasaManual}
              onChange={e => setTasaManual(e.target.value)}
              placeholder={`Ej: ${formatNumber(usd)}`}
              className="w-full h-11 px-3 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              disabled={disabled}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-bold text-slate-600">Nota / Motivo (Opcional):</label>
            <input
              type="text"
              inputMode="text"
              value={observacionTasa}
              onChange={e => setObservacionTasa(e.target.value)}
              placeholder="Ej: Tasa acordada para pago en efectivo"
              className="w-full h-11 px-3 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  )
}
