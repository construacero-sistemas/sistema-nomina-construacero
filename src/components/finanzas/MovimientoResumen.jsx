// src/components/finanzas/MovimientoResumen.jsx
// Tarjeta de resumen previa a guardar del formulario de movimiento financiero.
// Se muestra en vivo en cuanto el usuario ingresa un monto, para revisar exactamente
// lo que se va a registrar antes de pulsar "Guardar movimiento".
import { FileText } from 'lucide-react'

function formatNumber(value) {
  return Number(value || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function MovimientoResumen({
  tipo,
  moneda,
  montoNum,
  esVes,
  equivalenteUsd,
  equivalenteVes,
  tasaEfectiva,
  modoTasa,
  categoria,
  metodoLabel,
  concepto,
  referencia,
  cuentaOrigen,
  numPartes,
}) {
  if (!(montoNum > 0)) return null

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5" aria-label="Resumen del movimiento">
      <div className="flex items-center gap-2">
        <FileText size={15} className="text-primary shrink-0" />
        <span className="text-xs font-black text-slate-700 uppercase tracking-wider">Resumen del movimiento</span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className={`px-2.5 py-1 rounded-lg text-xs font-black ${
          tipo === 'ingreso' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
        }`}>
          {tipo === 'ingreso' ? 'Entrada (+)' : 'Salida (−)'}
        </span>
        <span className="text-lg font-black text-slate-900">
          {moneda} {formatNumber(montoNum)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="min-w-0">
          <span className="block text-[10px] font-bold text-slate-400 uppercase">Equivale</span>
          <span className="font-black text-slate-700 break-words">
            {esVes ? `≈ ${formatNumber(equivalenteUsd)} USD` : `≈ ${formatNumber(equivalenteVes)} VES`}
          </span>
        </div>
        <div className="min-w-0">
          <span className="block text-[10px] font-bold text-slate-400 uppercase">Tasa aplicada</span>
          <span className="font-black text-slate-700 break-words">
            {esVes ? 'Fija 1:1' : `${formatNumber(tasaEfectiva)} Bs/$ (${modoTasa === 'manual' ? 'Manual' : modoTasa.toUpperCase()})`}
          </span>
        </div>
        <div className="min-w-0">
          <span className="block text-[10px] font-bold text-slate-400 uppercase">Categoría</span>
          <span className="font-bold text-slate-700 break-words">{categoria || '—'}</span>
        </div>
        <div className="min-w-0">
          <span className="block text-[10px] font-bold text-slate-400 uppercase">Método</span>
          <span className="font-bold text-slate-700 break-words">{metodoLabel || '—'}</span>
        </div>
        {cuentaOrigen && (
          <div className="min-w-0">
            <span className="block text-[10px] font-bold text-slate-400 uppercase">Cuenta</span>
            <span className="font-bold text-slate-700 break-words">{cuentaOrigen}</span>
          </div>
        )}
        {numPartes > 0 && (
          <div className="min-w-0">
            <span className="block text-[10px] font-bold text-slate-400 uppercase">Pagos</span>
            <span className="font-bold text-slate-700 break-words">{numPartes} tramo{numPartes > 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      <div className="min-w-0">
        <span className="block text-[10px] font-bold text-slate-400 uppercase">Motivo</span>
        <span className="text-xs font-semibold text-slate-700 break-words">{concepto || '—'}</span>
      </div>

      {referencia.trim() && (
        <div className="text-xs text-slate-600 min-w-0">
          <span className="font-bold">Referencia:</span> {referencia.trim()}
        </div>
      )}
    </div>
  )
}
