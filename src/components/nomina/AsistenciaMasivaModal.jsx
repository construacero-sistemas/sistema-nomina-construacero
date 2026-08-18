// src/components/nomina/AsistenciaMasivaModal.jsx
// Registra el mismo horario para toda la plantilla activa en un día.
import { useState } from 'react'
import { Users, AlertTriangle } from 'lucide-react'
import { useRegistrarAsistenciaMasivo } from '../../hooks/useNomina'
import { Modal } from '../../../compat/components/ui/Modal.jsx'

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'

export default function AsistenciaMasivaModal({ fechaInicial, totalEmpleados, onClose }) {
  const registrar = useRegistrarAsistenciaMasivo()

  const [fecha, setFecha]           = useState(fechaInicial)
  const [horaEntrada, setHoraEntrada] = useState('08:00')
  const [horaSalida, setHoraSalida]   = useState('17:00')
  const [esFeriado, setEsFeriado]   = useState(false)
  const [error, setError]           = useState('')

  const cargando = registrar.isPending

  const fechaLabel = fecha
    ? new Date(`${fecha}T12:00:00`).toLocaleDateString('es-VE', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      })
    : ''

  async function guardar(e) {
    if (e) e.preventDefault()
    setError('')
    if (!fecha) { setError('Selecciona una fecha'); return }
    if (!horaEntrada || !horaSalida) { setError('Indica hora de entrada y salida'); return }

    try {
      await registrar.mutateAsync({ fecha, horaEntrada, horaSalida, esFeriado })
      onClose()
    } catch (err) {
      setError(err.message || 'Error al registrar')
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Registrar día completo" className="max-w-md">
      <div className="space-y-4">
        {/* Aviso */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5">
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-900 leading-relaxed">
            Se aplicará el mismo horario a los <strong>{totalEmpleados} empleados activos</strong> en nómina.
            Los registros existentes de ese día serán <strong>sobrescritos</strong>.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={guardar} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Fecha *</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
              className={inputCls} disabled={cargando} />
            {fechaLabel && (
              <p className="text-[11px] text-slate-400 capitalize">{fechaLabel}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Entrada *</label>
              <input type="time" value={horaEntrada} onChange={e => setHoraEntrada(e.target.value)}
                className={inputCls} disabled={cargando} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Salida *</label>
              <input type="time" value={horaSalida} onChange={e => setHoraSalida(e.target.value)}
                className={inputCls} disabled={cargando} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer w-fit">
            <input type="checkbox" checked={esFeriado} onChange={e => setEsFeriado(e.target.checked)}
              disabled={cargando}
              className="w-4 h-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-400" />
            Marcar como día feriado
          </label>
        </form>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-slate-100">
        <button onClick={onClose} type="button" disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
          Cancelar
        </button>
        <button onClick={guardar} disabled={cargando}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-bold">
          <Users size={14} />
          {cargando ? 'Registrando...' : `Registrar (${totalEmpleados})`}
        </button>
      </div>
    </Modal>
  )
}
