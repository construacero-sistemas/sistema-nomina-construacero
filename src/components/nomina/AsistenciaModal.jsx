// src/components/nomina/AsistenciaModal.jsx
// Registro/edición de la asistencia de un empleado en un día concreto.
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useRegistrarAsistencia, useEliminarAsistencia } from '../../hooks/useNomina'
import { Modal } from '../../../compat/components/ui/Modal.jsx'

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'

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

  // Preview de horas calculadas
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
      title={empleado?.empleado?.nombre || 'Asistencia'}
      className="max-w-md">
      <div className="space-y-4">
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
          <p className="text-xs text-slate-600 capitalize">{fechaLabel}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Jornada configurada: {jornada}h
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={guardar} className="space-y-4">
          {/* Marcadores del día */}
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox" checked={esAusencia}
                onChange={e => { setEsAusencia(e.target.checked); if (e.target.checked) setEsFeriado(false) }}
                disabled={cargando || !puedeEditar}
                className="w-4 h-4 rounded border-slate-300 text-red-500 focus:ring-red-400"
              />
              Ausencia
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox" checked={esFeriado}
                onChange={e => setEsFeriado(e.target.checked)}
                disabled={cargando || !puedeEditar || esAusencia}
                className="w-4 h-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-400"
              />
              Día feriado
            </label>
          </div>

          {/* Horas */}
          {!esAusencia && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Entrada</label>
                <input type="time" value={horaEntrada} onChange={e => setHoraEntrada(e.target.value)}
                  className={inputCls} disabled={cargando || !puedeEditar} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Salida</label>
                <input type="time" value={horaSalida} onChange={e => setHoraSalida(e.target.value)}
                  className={inputCls} disabled={cargando || !puedeEditar} />
              </div>
            </div>
          )}

          {/* Preview */}
          {!esAusencia && preview.total > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Trabajadas', value: `${preview.total.toFixed(1)}h`,    cls: 'text-slate-800' },
                { label: 'Normales',   value: `${preview.normales.toFixed(1)}h`, cls: 'text-green-600' },
                { label: 'Extra',      value: `${preview.extra.toFixed(1)}h`,    cls: preview.extra > 0 ? 'text-amber-600' : 'text-slate-400' },
              ].map(k => (
                <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-2 text-center">
                  <div className="text-[10px] text-slate-400 font-medium">{k.label}</div>
                  <div className={`text-sm font-black mt-0.5 ${k.cls}`}>{k.value}</div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Nota (opcional)</label>
            <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2}
              placeholder="Ej: permiso médico, llegó tarde..."
              className={inputCls} disabled={cargando || !puedeEditar} />
          </div>
        </form>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t border-slate-100">
        {registro && esAdmin ? (
          confirmandoBorrar ? (
            <div className="flex items-center gap-1.5">
              <button onClick={borrar} disabled={cargando}
                className="px-2.5 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-bold disabled:opacity-50">
                Confirmar
              </button>
              <button onClick={() => setConfirmandoBorrar(false)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-200 text-slate-600 text-xs font-bold">
                No
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmandoBorrar(true)} disabled={cargando} title="Eliminar registro"
              className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50">
              <Trash2 size={15} />
            </button>
          )
        ) : <span />}

        <div className="flex gap-2">
          <button onClick={onClose} type="button" disabled={cargando}
            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          {puedeEditar && (
            <button onClick={guardar} disabled={cargando}
              className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-bold">
              {registrar.isPending ? 'Guardando...' : 'Guardar'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
