// src/components/nomina/DescuentosEditor.jsx
// Lista de descuentos del recibo con motivo obligatorio (Anticipo, Préstamo,
// Falta, Multa u Otro). Cada fila exige motivo y monto positivo; el conjunto
// nunca puede dejar el neto en negativo.
import { Plus, Trash2, Wallet } from 'lucide-react'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import { MOTIVOS_DESCUENTO, crearFilaDescuento } from './descuentosUtils.js'

const inputCls = 'w-full min-h-11 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-[16px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'

export default function DescuentosEditor({ filas = [], validacion, onChange, disabled = false }) {
  const actualizar = (clave, campos) => onChange(filas.map(fila => (fila.clave === clave ? { ...fila, ...campos } : fila)))
  const quitar = clave => onChange(filas.filter(fila => fila.clave !== clave))
  return (
    <section aria-label="Descuentos del recibo" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium text-slate-700 inline-flex items-center gap-1.5">
          <Wallet size={16} className="text-slate-500" />
          Descuentos (USD)
        </label>
        <span className="text-xs font-semibold text-slate-600">
          Total: <strong className="text-rose-700">${validacion.total.toFixed(2)}</strong>
        </span>
      </div>

      {filas.length === 0 && (
        <p className="text-xs text-slate-500">Sin descuentos en este recibo.</p>
      )}

      {filas.map(fila => (
        <div key={fila.clave} className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1 basis-40">
              <CustomSelect
                aria-label="Motivo del descuento"
                placeholder="Motivo *"
                options={MOTIVOS_DESCUENTO}
                value={fila.motivo || null}
                onChange={motivo => actualizar(fila.clave, { motivo })}
                disabled={disabled}
              />
            </div>
            <div className="min-w-0 flex-1 basis-28">
              <input
                type="number" min="0" step="0.01" inputMode="decimal"
                aria-label="Monto del descuento"
                placeholder="Monto *"
                value={fila.monto}
                onChange={e => actualizar(fila.clave, { monto: e.target.value })}
                className={inputCls}
                disabled={disabled}
              />
            </div>
            <button
              type="button"
              aria-label="Quitar descuento"
              onClick={() => quitar(fila.clave)}
              disabled={disabled}
              className="min-h-11 min-w-11 px-3 rounded-xl border border-rose-200 text-rose-600 inline-flex items-center justify-center hover:bg-rose-50 disabled:opacity-50"
            >
              <Trash2 size={18} />
            </button>
          </div>
          <input
            type="text" maxLength={180}
            aria-label="Detalle del descuento"
            placeholder="Detalle (opcional) — p. ej. cuota 1 de 3"
            value={fila.detalle}
            onChange={e => actualizar(fila.clave, { detalle: e.target.value })}
            className={`${inputCls} !py-2`}
            disabled={disabled}
          />
          {validacion.errores[fila.clave] && (
            <p role="alert" className="text-xs font-semibold text-rose-600">{validacion.errores[fila.clave]}</p>
          )}
        </div>
      ))}

      {validacion.errorGlobal && (
        <p role="alert" className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-900">
          {validacion.errorGlobal}
        </p>
      )}

      <button
        type="button"
        onClick={() => onChange([...filas, crearFilaDescuento()])}
        disabled={disabled}
        className="w-full min-h-11 px-3 py-2 rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-slate-600 inline-flex items-center justify-center gap-2 hover:bg-slate-50 disabled:opacity-50"
      >
        <Plus size={18} /> Agregar descuento
      </button>
    </section>
  )
}
