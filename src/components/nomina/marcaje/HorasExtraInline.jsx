// src/components/nomina/marcaje/HorasExtraInline.jsx
// Editor rápido en línea de horas extras para una tarjeta: chips desde 0.5h + campo manual.
import { useState } from 'react'
import { Clock, Trash2, X } from 'lucide-react'
import {
  ATAJOS_HORAS_EXTRA,
  HORAS_EXTRA_MAX,
  HORAS_EXTRA_MIN,
  normalizarHorasExtra,
  sumarHorasHHMM,
} from '../../../../server/lib/asistenciaExcepciones.js'
import { formatHora12 } from '../../../utils/timeUtils'

const TACTIL = { touchAction: 'manipulation' }

export default function HorasExtraInline({
  nombre,
  horaFinBase,
  horasActuales = 0,
  bloqueada = false,
  pendiente = false,
  onGuardar,
  onCancelar,
}) {
  const [valor, setValor] = useState(horasActuales > 0 ? String(horasActuales) : '1')
  const [error, setError] = useState('')

  const horasPreview = normalizarHorasExtra(valor)
  const salidaEstimada = horasPreview && horasPreview > 0 && horaFinBase
    ? formatHora12(sumarHorasHHMM(horaFinBase, horasPreview))
    : null

  function guardarValor(raw) {
    const num = normalizarHorasExtra(raw)
    if (num === null || num === 0) {
      setError(`Ingresa entre ${HORAS_EXTRA_MIN} y ${HORAS_EXTRA_MAX} horas extras (ej. 0.5, 1.5, 2).`)
      return
    }
    setError('')
    onGuardar(num)
  }

  return (
    <div
      role="group"
      aria-label={`Registrar horas extras de ${nombre}`}
      className="min-w-0 space-y-2.5 rounded-xl border border-amber-300 bg-white p-2.5 shadow-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-black text-slate-800">
          <Clock size={14} className="text-amber-600" aria-hidden="true" />
          Horas extras de hoy
        </span>
        <button
          type="button"
          onClick={onCancelar}
          disabled={bloqueada}
          aria-label={`Cerrar editor de horas extras de ${nombre}`}
          className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
          style={TACTIL}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Atajos de horas extras">
        {ATAJOS_HORAS_EXTRA.map(chip => {
          const activo = Number(valor.replace(',', '.')) === chip
          return (
            <button
              key={chip}
              type="button"
              disabled={bloqueada}
              onClick={() => { setValor(String(chip)); setError('') }}
              style={TACTIL}
              className={`min-h-11 rounded-lg border px-2 text-xs font-black transition-colors ${
                activo
                  ? 'border-amber-600 bg-amber-600 text-white shadow-xs'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-amber-50 hover:border-amber-300'
              }`}
            >
              +{chip}h
            </button>
          )
        })}
      </div>

      <label className="block text-[11px] font-bold text-slate-600">
        Cantidad manual (desde {HORAS_EXTRA_MIN} h)
        <div className="relative mt-1">
          <input
            type="text"
            inputMode="decimal"
            value={valor}
            disabled={bloqueada}
            onChange={e => { setValor(e.target.value); setError('') }}
            placeholder="Ej.: 0.5 o 2.5"
            aria-label={`Horas extras manuales de ${nombre}`}
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 pr-10 text-[16px] font-mono font-bold text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200 sm:text-sm"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">h</span>
        </div>
      </label>

      {salidaEstimada && (
        <p className="text-[11px] font-semibold text-amber-900">
          Salida estimada: <strong>{salidaEstimada}</strong> (+{horasPreview} h sobre su jornada)
        </p>
      )}
      {error && <p role="alert" className="text-[11px] font-bold text-rose-700">{error}</p>}

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled={bloqueada}
          aria-busy={pendiente}
          onClick={() => guardarValor(valor)}
          style={TACTIL}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-amber-600 px-3 text-xs font-black text-white shadow-xs transition-colors hover:bg-amber-700 disabled:opacity-55"
        >
          {pendiente ? 'Guardando extras…' : 'Guardar horas extras'}
          <span className="sr-only"> de {nombre}</span>
        </button>
        {horasActuales > 0 && (
          <button
            type="button"
            disabled={bloqueada}
            onClick={() => onGuardar(0)}
            style={TACTIL}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50/70 px-3 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-55"
          >
            <Trash2 size={13} aria-hidden="true" />
            Quitar extras<span className="sr-only"> de {nombre}</span>
          </button>
        )}
      </div>
    </div>
  )
}
