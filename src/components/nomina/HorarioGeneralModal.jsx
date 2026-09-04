// src/components/nomina/HorarioGeneralModal.jsx
// Modal de edición del horario laboral estándar y jornada por defecto de la empresa.
import { useState, useMemo } from 'react'
import { Clock, Sparkles, Check, AlertCircle, CalendarDays, Coffee } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { useGuardarConfigNomina } from '../../hooks/useNomina.js'
import { formatHora12, formatRangoHoras12 } from '../../utils/timeUtils.js'

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all font-mono min-h-11'

export default function HorarioGeneralModal({ isOpen, onClose, configActual = {} }) {
  const guardar = useGuardarConfigNomina()

  const [horaInicio, setHoraInicio] = useState(
    String(configActual.nomina_hora_inicio || '08:00').slice(0, 5)
  )
  const [horaFin, setHoraFin] = useState(
    String(configActual.nomina_hora_fin || '17:00').slice(0, 5)
  )
  const [horasDescanso, setHorasDescanso] = useState(
    String(configActual.nomina_horas_descanso != null ? configActual.nomina_horas_descanso : 1.0)
  )
  const [horasJornada, setHorasJornada] = useState(
    String(configActual.nomina_horas_jornada != null ? configActual.nomina_horas_jornada : 8.0)
  )
  const [error, setError] = useState('')

  // Cálculo de tiempo transcurrido entre inicio y fin
  const calculoTiempo = useMemo(() => {
    if (!horaInicio || !horaFin) return { transcurrido: 0, efectivaSugerida: 0 }
    const toMin = t => {
      const [h, m] = t.split(':').map(Number)
      return (h || 0) * 60 + (m || 0)
    }
    let fin = toMin(horaFin)
    const ini = toMin(horaInicio)
    if (fin <= ini) fin += 24 * 60
    const transcurrido = Math.max(0, (fin - ini) / 60)
    const descanso = Math.max(0, Number(horasDescanso) || 0)
    const efectivaSugerida = Math.max(0, transcurrido - descanso)
    return { transcurrido, efectivaSugerida }
  }, [horaInicio, horaFin, horasDescanso])

  function aplicarPreset(inicio, fin, descanso, efectiva) {
    setHoraInicio(inicio)
    setHoraFin(fin)
    setHorasDescanso(String(descanso))
    setHorasJornada(String(efectiva))
  }

  function sincronizarConCalculo() {
    setHorasJornada(String(Math.round(calculoTiempo.efectivaSugerida * 10) / 10))
  }

  async function handleSubmit(e) {
    if (e) e.preventDefault()
    setError('')

    const numJornada = Number(horasJornada)
    const numDescanso = Number(horasDescanso)

    if (!horaInicio || !horaFin) {
      setError('Debes especificar la hora de entrada y de salida.')
      return
    }
    if (!Number.isFinite(numJornada) || numJornada <= 0 || numJornada > 24) {
      setError('La jornada efectiva debe ser un valor mayor a 0 y hasta 24 horas.')
      return
    }
    if (!Number.isFinite(numDescanso) || numDescanso < 0 || numDescanso > 12) {
      setError('Las horas de descanso deben ser un valor entre 0 y 12.')
      return
    }

    try {
      await guardar.mutateAsync({
        nomina_hora_inicio: horaInicio,
        nomina_hora_fin: horaFin,
        nomina_horas_jornada: numJornada,
        nomina_horas_descanso: numDescanso,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Error al guardar la configuración del horario general.')
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Horario Laboral Estándar de la Empresa"
      className="max-w-md"
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-500 leading-relaxed">
          Define el horario habitual y las horas de jornada laboral por defecto que se usarán para los empleados de la empresa.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-xs text-red-700">
            <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-500" />
            <span>{error}</span>
          </div>
        )}

        {/* Vista previa en formato 12 horas */}
        <div className="p-3.5 rounded-2xl bg-primary/[0.04] border border-primary/20 space-y-1.5">
          <span className="text-[10px] uppercase font-bold tracking-wider text-primary block">
            Vista Previa de Jornada General
          </span>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-primary" />
              <span className="text-sm font-black text-slate-800">
                {formatRangoHoras12(horaInicio, horaFin) || 'Sin horario'}
              </span>
            </div>
            <span className="text-xs font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-md">
              {Number(horasJornada) || 0}h efectivas
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            {formatHora12(horaInicio)} a {formatHora12(horaFin)} · {Number(horasDescanso) || 0}h de descanso / almuerzo
          </p>
        </div>

        {/* Preajustes Rápidos */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Preajustes Frecuentes
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => aplicarPreset('08:00', '17:00', 1.0, 8.0)}
              className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left transition-all min-h-11"
              style={{ touchAction: 'manipulation' }}
            >
              <div className="text-[11px] font-bold text-slate-800">08:00 AM – 05:00 PM</div>
              <div className="text-[10px] text-slate-500">8h efectivas + 1h descanso</div>
            </button>

            <button
              type="button"
              onClick={() => aplicarPreset('07:30', '16:30', 1.0, 8.0)}
              className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left transition-all min-h-11"
              style={{ touchAction: 'manipulation' }}
            >
              <div className="text-[11px] font-bold text-slate-800">07:30 AM – 04:30 PM</div>
              <div className="text-[10px] text-slate-500">8h efectivas + 1h descanso</div>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Entradas de Hora */}
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <span>Entrada</span>
                <span className="text-[11px] font-semibold text-primary">{formatHora12(horaInicio)}</span>
              </label>
              <input
                type="time"
                value={horaInicio}
                onChange={e => setHoraInicio(e.target.value)}
                className={inputCls}
                disabled={guardar.isPending}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <span>Salida</span>
                <span className="text-[11px] font-semibold text-primary">{formatHora12(horaFin)}</span>
              </label>
              <input
                type="time"
                value={horaFin}
                onChange={e => setHoraFin(e.target.value)}
                className={inputCls}
                disabled={guardar.isPending}
                required
              />
            </div>
          </div>

          {/* Horas Efectivas y Descanso */}
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <CalendarDays size={13} className="text-slate-400" />
                Jornada Efectiva (h)
              </label>
              <input
                type="number"
                step="0.5"
                min="1"
                max="24"
                value={horasJornada}
                onChange={e => setHorasJornada(e.target.value)}
                className={inputCls}
                disabled={guardar.isPending}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                <Coffee size={13} className="text-slate-400" />
                Descanso / Comida (h)
              </label>
              <input
                type="number"
                step="0.5"
                min="0"
                max="12"
                value={horasDescanso}
                onChange={e => setHorasDescanso(e.target.value)}
                className={inputCls}
                disabled={guardar.isPending}
                required
              />
            </div>
          </div>

          {calculoTiempo.transcurrido > 0 && Math.abs(Number(horasJornada) - calculoTiempo.efectivaSugerida) > 0.05 && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
              <span>Sugerido según horas: <strong>{calculoTiempo.efectivaSugerida.toFixed(1)}h</strong></span>
              <button
                type="button"
                onClick={sincronizarConCalculo}
                className="font-bold text-amber-800 underline hover:text-amber-950 text-[11px]"
              >
                Ajustar a {calculoTiempo.efectivaSugerida.toFixed(1)}h
              </button>
            </div>
          )}

          {/* Acciones */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={guardar.isPending}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 font-bold text-xs transition-all min-h-11"
              style={{ touchAction: 'manipulation' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardar.isPending}
              className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-bold text-xs transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50 min-h-11"
              style={{ touchAction: 'manipulation' }}
            >
              {guardar.isPending ? (
                <span>Guardando...</span>
              ) : (
                <>
                  <Check size={14} />
                  <span>Guardar Horario General</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
