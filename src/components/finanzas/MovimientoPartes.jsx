// src/components/finanzas/MovimientoPartes.jsx
// Editor opcional de "¿Cuántos pagos/egresos?" — divide el monto total en N tramos
// (partes), cada uno con su monto y referencia, sin salir del formulario.
import { useState } from 'react'
import { Divide, Plus, Trash2, X, Check } from 'lucide-react'

function formatNumber(value) {
  return Number(value || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function MovimientoPartes({
  montoTotal,
  partes,
  onChange,
  disabled,
  moneda,
}) {
  const [habilitado, setHabilitado] = useState(partes.length > 0)

  const suma = partes.reduce((acc, p) => acc + (Number(p.monto) || 0), 0)
  const restante = (Number(montoTotal) || 0) - suma
  const completa = Math.abs(restante) < 0.01

  function actualizar(index, campo, valor) {
    const next = partes.map((p, i) => i === index ? { ...p, [campo]: valor } : p)
    onChange(next)
  }

  function agregarParte() {
    // La nueva parte nace con el monto restante para que solo haya que confirmar
    const nuevo = restante !== 0 && partes.length > 0 ? restante : ''
    onChange([...partes, { monto: nuevo === '' ? '' : Number(nuevo), referencia: '' }])
  }

  function quitarParte(index) {
    const next = partes.filter((_, i) => i !== index)
    onChange(next)
    if (next.length === 0) setHabilitado(false)
  }

  function repartirIgual() {
    const n = partes.length || 2
    const total = Number(montoTotal) || 0
    const base = Math.floor((total / n) * 100) / 100
    const tramos = Array.from({ length: n }, (_, i) => {
      const monto = i === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base
      return { monto, referencia: partes[i]?.referencia || '' }
    })
    onChange(tramos)
  }

  function desactivar() {
    setHabilitado(false)
    onChange([])
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-2.5">
      {/* Toggle principal */}
      <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
        <span className="flex items-center gap-2 text-xs font-bold text-slate-700 min-w-0">
          <Divide size={15} className="text-primary shrink-0" />
          <span className="leading-tight">¿Se pagó/cobró en varias partes?</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={habilitado}
          onClick={() => {
            if (habilitado) {
              desactivar()
            } else {
              setHabilitado(true)
              // Al activar, sembramos un tramo con lo que falta por asignar.
              if (partes.length === 0) {
                onChange([{ monto: Number(montoTotal) > 0 ? Number(montoTotal) : '', referencia: '' }])
              }
            }
          }}
          disabled={disabled}
          className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${habilitado ? 'bg-primary' : 'bg-slate-300'}`}
          style={{ touchAction: 'manipulation' }}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${habilitado ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </label>
      <p className="text-[11px] text-slate-500 leading-snug px-0.5">
        Divide el total en {partes.length === 1 ? '1 egreso/pago' : `${partes.length || 'N'} egresos/pagos`}. Cada parte lleva su propio comprobante.
      </p>

      {habilitado && (
        <div className="space-y-2">
          {partes.map((parte, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-center text-[11px] font-black text-slate-400">{index + 1}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={parte.monto}
                onChange={e => actualizar(index, 'monto', e.target.value)}
                placeholder="Monto"
                disabled={disabled}
                className="w-28 min-w-0 h-11 rounded-xl border border-slate-200 bg-white px-2.5 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <input
                type="text"
                value={parte.referencia}
                onChange={e => actualizar(index, 'referencia', e.target.value)}
                placeholder="N° comprobante (opcional)"
                disabled={disabled}
                className="flex-1 min-w-0 h-11 rounded-xl border border-slate-200 bg-white px-2.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <button
                type="button"
                onClick={() => quitarParte(index)}
                disabled={disabled}
                aria-label={`Quitar parte ${index + 1}`}
                className="p-2 shrink-0 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={agregarParte}
              disabled={disabled}
              className="inline-flex items-center gap-1 px-2.5 h-9 rounded-lg bg-slate-200/70 hover:bg-slate-300 text-[11px] font-black text-slate-700 transition-all active:scale-95"
            >
              <Plus size={13} />
              <span>Añadir parte</span>
            </button>
            <button
              type="button"
              onClick={repartirIgual}
              disabled={disabled || !(Number(montoTotal) > 0)}
              className="inline-flex items-center gap-1 px-2.5 h-9 rounded-lg text-[11px] font-black text-primary hover:bg-primary/10 transition-all active:scale-95"
            >
              <Divide size={13} />
              <span>Repartir igual</span>
            </button>
          </div>

          {/* Suma vs total */}
          <div className={`flex items-center justify-between rounded-xl px-2.5 py-2 text-xs font-bold ${completa ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            <span className="min-w-0">Suma: {formatNumber(suma)} {moneda}</span>
            <span className="whitespace-nowrap pl-2">
              {completa
                ? <>Total {formatNumber(montoTotal)} {moneda} <Check size={13} className="inline align-text-bottom" /></>
                : <>Falta {formatNumber(Math.max(restante, 0))} {moneda} para {formatNumber(montoTotal)}</>}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
