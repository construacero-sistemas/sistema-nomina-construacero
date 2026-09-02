// src/components/nomina/AsistenciaModal.jsx
// Registro y edición rápida e intuitiva de la asistencia diaria de un empleado.
import { useState } from 'react'
import { Clock, Trash2, Calendar, AlertCircle, Sparkles, UserX } from 'lucide-react'
import { useRegistrarAsistencia, useEliminarAsistencia } from '../../hooks/useNomina'
import { Modal } from '../../../compat/components/ui/Modal.jsx'

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all font-mono'

export default function AsistenciaModal({ empleado, fecha, registro, feriado, esAdmin, onClose }) {
  const registrar = useRegistrarAsistencia()
  const eliminar  = useEliminarAsistencia()

  const jornada = Number(empleado?.horas_jornada) || 8
  const puedeEditar = !!esAdmin

  const [horaEntrada, setHoraEntrada] = useState(
    String(registro?.hora_entrada ?? empleado?.hora_inicio ?? '08:00').slice(0, 5)
  )
  const [horaSalida, setHoraSalida] = useState(
    String(registro?.hora_salida ?? empleado?.hora_fin ?? '17:00').slice(0, 5)
  )
  const [esFeriado, setEsFeriado]   = useState(registro?.es_feriado ?? !!feriado)
  const [esAusencia, setEsAusencia] = useState(registro?.es_ausencia ?? false)
  const [nota, setNota]             = useState(registro?.nota ?? '')
  const [confirmandoBorrar, setConfirmandoBorrar] = useState(false)
  const [error, setError] = useState('')

  // Preview dinámico de horas calculadas
  const preview = (() => {
    if (esAusencia || !horaEntrada || !horaSalida) return { total: 0, normales: 0, extra: 0 }
    const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
    let sal = toMin(horaSalida)
    const ent = toMin(horaEntrada)
    if (sal <= ent) sal += 24 * 60
    const total = Math.max(0, (sal - ent) / 60)
    return {
      total,
      normales: Math.min(total, jornada),
      extra: Math.max(0, total - jornada),
    }
  })()

  const fechaLabel = new Date(`${fecha}T12:00:00`).toLocaleDateString('es-VE', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })

  const cargando = registrar.isPending || eliminar.isPending

  function aplicarPreset(entrada, salida) {
    setEsAusencia(false)
    setHoraEntrada(entrada)
    setHoraSalida(salida)
  }

  function marcarAusenciaRapida() {
    setEsAusencia(true)
    setEsFeriado(false)
  }

  async function guardar(e) {
    if (e) e.preventDefault()
    setError('')
    if (!esAusencia && (!horaEntrada || !horaSalida)) {
      setError('Indica hora de entrada y salida, o marca el día como ausencia')
      return
    }
    try {
      await registrar.mutateAsync({
        empleadoId: empleado.empleado_id,
        fecha,
        horaEntrada: esAusencia ? null : horaEntrada,
        horaSalida:  esAusencia ? null : horaSalida,
        esFeriado, esAusencia,
        nota: nota || undefined,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Error al registrar')
    }
  }

  async function borrar() {
    try {
      await eliminar.mutateAsync(registro.id)
      onClose()
    } catch (err) {
      setError(err.message || 'Error al eliminar')
    }
  }

  return (
    <Modal
      isOpen onClose={onClose}
      title={empleado?.empleado?.nombre || 'Registro de Asistencia'}
      className="max-w-md">
      <div className="space-y-4">
        {/* Cabecera del día */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-800 capitalize">{fechaLabel}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Jornada laboral configurada: <strong className="text-slate-700">{jornada} horas</strong>
            </p>
          </div>
          {feriado ? (
            <span className="px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 text-[10px] font-bold border border-purple-200">
              {feriado.nombre || 'Feriado'}
            </span>
          ) : new Date(`${fecha}T12:00:00`).getDay() === 6 ? (
            <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 text-[10px] font-bold border border-amber-200">
              Sábado Rotativo
            </span>
          ) : null}
        </div>

        {new Date(`${fecha}T12:00:00`).getDay() === 6 && (
          <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-2.5 text-[11px] text-amber-900 leading-relaxed">
            <strong>Sábado Rotativo:</strong> Registra la jornada si el trabajador laboró este fin de semana para computar su pago de sábado. Si disfrutó de su descanso reglamentario, no es necesario registrar marcaje.
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 font-medium">
            {error}
          </div>
        )}

        {/* Presets Rápidos de 1 Toque */}
        {puedeEditar && (
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Atajos Rápidos
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => aplicarPreset('08:00', '17:00')}
                className="py-2 px-2 rounded-xl bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 text-emerald-800 text-[11px] font-bold transition-all text-center"
              >
                08:00 – 17:00
                <span className="block text-[9px] font-normal text-emerald-600">Estándar (8h)</span>
              </button>

              <button
                type="button"
                onClick={() => aplicarPreset('08:00', new Date(`${fecha}T12:00:00`).getDay() === 6 ? '13:00' : '18:00')}
                className="py-2 px-2 rounded-xl bg-amber-50 hover:bg-amber-100/80 border border-amber-200 text-amber-800 text-[11px] font-bold transition-all text-center"
              >
                {new Date(`${fecha}T12:00:00`).getDay() === 6 ? '08:00 – 13:00' : '08:00 – 18:00'}
                <span className="block text-[9px] font-normal text-amber-600">
                  {new Date(`${fecha}T12:00:00`).getDay() === 6 ? 'Medio Sábado (5h)' : '+1h Extra'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => aplicarPreset('08:00', '19:00')}
                className="py-2 px-2 rounded-xl bg-amber-50 hover:bg-amber-100/80 border border-amber-200 text-amber-800 text-[11px] font-bold transition-all text-center"
              >
                08:00 – 19:00
                <span className="block text-[9px] font-normal text-amber-600">+2h Extra</span>
              </button>

              <button
                type="button"
                onClick={marcarAusenciaRapida}
                className="py-2 px-2 rounded-xl bg-red-50 hover:bg-red-100/80 border border-red-200 text-red-700 text-[11px] font-bold transition-all text-center"
              >
                Falta / Ausencia
                <span className="block text-[9px] font-normal text-red-500">Injustificada</span>
              </button>
            </div>
          </div>
        )}

        <form onSubmit={guardar} className="space-y-4 pt-1">
          {/* Opciones del día */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox" checked={esAusencia}
                onChange={e => { setEsAusencia(e.target.checked); if (e.target.checked) setEsFeriado(false) }}
                disabled={cargando || !puedeEditar}
                className="w-4 h-4 rounded border-slate-300 text-red-500 focus:ring-red-400"
              />
              Marcar como Ausencia / No asistió
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox" checked={esFeriado}
                onChange={e => setEsFeriado(e.target.checked)}
                disabled={cargando || !puedeEditar || esAusencia}
                className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-400"
              />
              Día feriado
            </label>
          </div>

          {/* Horas */}
          {!esAusencia && (
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  <Clock size={13} className="text-slate-400" />
                  Hora de Entrada
                </label>
                <input type="time" value={horaEntrada} onChange={e => setHoraEntrada(e.target.value)}
                  className={inputCls} disabled={cargando || !puedeEditar} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  <Clock size={13} className="text-slate-400" />
                  Hora de Salida
                </label>
                <input type="time" value={horaSalida} onChange={e => setHoraSalida(e.target.value)}
                  className={inputCls} disabled={cargando || !puedeEditar} />
              </div>
            </div>
          )}

          {/* Preview interactivo de Horas */}
          {!esAusencia && preview.total > 0 && (
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-2 text-center">
                <span className="text-[10px] text-slate-400 font-bold block">Trabajadas</span>
                <span className="text-sm font-black text-slate-800">{preview.total.toFixed(1)}h</span>
              </div>
              <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-2 text-center">
                <span className="text-[10px] text-emerald-700 font-bold block">Normales</span>
                <span className="text-sm font-black text-emerald-800">{preview.normales.toFixed(1)}h</span>
              </div>
              <div className={`border rounded-xl p-2 text-center ${preview.extra > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
                <span className="text-[10px] font-bold block">Horas Extra</span>
                <span className="text-sm font-black">{preview.extra > 0 ? `+${preview.extra.toFixed(1)}h` : '0.0h'}</span>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Nota u observación (opcional)</label>
            <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2}
              placeholder="Ej: Llegó 15 min tarde, permiso médico, apoyo en despacho..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
              disabled={cargando || !puedeEditar} />
          </div>
        </form>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-3 mt-4 border-t border-slate-100">
        {registro && esAdmin ? (
          confirmandoBorrar ? (
            <div className="flex items-center gap-1.5">
              <button onClick={borrar} disabled={cargando}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-50">
                Sí, eliminar
              </button>
              <button onClick={() => setConfirmandoBorrar(false)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">
                Cancelar
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmandoBorrar(true)} disabled={cargando} aria-label="Eliminar registro de asistencia"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
              <Trash2 size={14} aria-hidden="true" /> Eliminar
            </button>
          )
        ) : <span />}

        <div className="flex gap-2">
          <button onClick={onClose} type="button" disabled={cargando}
            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-50">
            Cerrar
          </button>
          {puedeEditar && (
            <button onClick={guardar} disabled={cargando}
              className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all active:scale-95">
              {registrar.isPending ? 'Guardando...' : 'Guardar asistencia'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
