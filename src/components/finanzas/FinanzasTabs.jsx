// src/components/finanzas/FinanzasTabs.jsx
// Barra de pestañas segmentada de Finanzas: Movimientos (operación diaria) y
// Tesorería (saldos y carteras, solo para roles con verSaldos).
import { Landmark, ReceiptText } from 'lucide-react'
import { formatNumber } from './formatos.js'

const claseTab = activa => `inline-flex items-center justify-center gap-1.5 px-2.5 min-h-11 rounded-xl text-xs font-black transition-all cursor-pointer ${
  activa ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
}`

export default function FinanzasTabs({ puedeVerSaldos, pestanaVisible, onCambiar, cierrePendiente, patrimonioTotalUsd }) {
  return (
    <div className={`grid ${puedeVerSaldos ? 'grid-cols-2' : 'grid-cols-1'} gap-1 p-1 bg-slate-200/70 border border-slate-200 rounded-2xl`}>
      <button
        type="button"
        onClick={() => onCambiar('movimientos')}
        className={claseTab(pestanaVisible === 'movimientos')}
        style={{ touchAction: 'manipulation' }}
      >
        <ReceiptText size={15} className={`shrink-0 ${pestanaVisible === 'movimientos' ? 'text-primary' : 'text-slate-400'}`} />
        <span className="truncate">
          <span className="sm:hidden">Movimientos</span>
          <span className="hidden sm:inline">Movimientos y Flujo</span>
        </span>
      </button>

      {puedeVerSaldos && <button
        type="button"
        onClick={() => onCambiar('tesoreria')}
        className={claseTab(pestanaVisible === 'tesoreria')}
        style={{ touchAction: 'manipulation' }}
      >
        <Landmark size={15} className={`shrink-0 ${pestanaVisible === 'tesoreria' ? 'text-emerald-600' : 'text-slate-400'}`} />
        <span className="truncate">
          <span className="sm:hidden">Tesorería</span>
          <span className="hidden sm:inline">Tesorería y Carteras</span>
        </span>
        {cierrePendiente && <span aria-label="Cierre pendiente" className="h-2 w-2 shrink-0 rounded-full bg-amber-500 animate-pulse" />}
        {patrimonioTotalUsd != null && (
          <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold whitespace-nowrap shrink-0">
            ${formatNumber(patrimonioTotalUsd)} USD
          </span>
        )}
      </button>}
    </div>
  )
}
