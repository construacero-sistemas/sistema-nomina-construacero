// src/components/nomina/AsistenciaMasivaModal.jsx
// Registra el horario para toda la plantilla activa en un día con 1 solo clic.
import { useState } from 'react'
import { Users, AlertTriangle, Sparkles, Clock, Calendar } from 'lucide-react'
import { useRegistrarAsistenciaMasivo } from '../../hooks/useNomina'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all font-mono'

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

  function aplicarPreset(entrada, salida) {
    setHoraEntrada(entrada)
    setHoraSalida(salida)
  }

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
    <Modal isOpen onClose={onClose} title="Marcaje Masivo de Plantilla" className="max-w-md">
      <div className="space-y-4">
        {/* Aviso informativo */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
            <Users size={16} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-800">
              {fecha && new Date(`${fecha}T12:00:00`).getDay() === 6
                ? `Marcaje de Sábado (${totalEmpleados} empleados activos)`
                : `Aplicar a ${totalEmpleados} empleados activos`}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              {fecha && new Date(`${fecha}T12:00:00`).getDay() === 6
                ? 'Aplica la jornada a la cuadrilla que laboró este sábado. Para los trabajadores que descansaron, puedes dejarlos sin marcaje en la grilla para no computarles horas.'
                : 'Marca la jornada completa de toda la plantilla en 1 clic. Luego podrás ajustar ausencias o excepciones individuales en la grilla.'}
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 font-medium">
            {error}
          </div>
        )}

        {/* Presets Rápidos */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
            Jornada Predeterminada
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => aplicarPreset('08:00', '17:00')}
              className="py-2.5 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 text-emerald-800 text-xs font-bold transition-all text-left flex items-center justify-between"
            >
              <div>
                <span>08:00 – 17:00</span>
                <span className="block text-[10px] font-normal text-emerald-600">Estándar (8h)</span>
              </div>
              <Sparkles size={14} className="text-emerald-600" />
            </button>

            <button
              type="button"
              onClick={() => aplicarPreset('08:00', '18:00')}
              className="py-2.5 px-3 rounded-xl bg-amber-50 hover:bg-amber-100/80 border border-amber-200 text-amber-800 text-xs font-bold transition-all text-left flex items-center justify-between"
            >
              <div>
                <span>08:00 – 18:00</span>
                <span className="block text-[10px] font-normal text-amber-600">+1h Extra (9h)</span>
              </div>
              <Clock size={14} className="text-amber-600" />
            </button>
          </div>
        </div>

        <form onSubmit={guardar} className="space-y-4 pt-1">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Fecha de Asistencia *</label>
            <DatePicker
              value={fecha}
              onChange={setFecha}
              disabled={cargando}
            />
            {fechaLabel && (
              <p className="text-[11px] text-slate-400 capitalize font-medium">{fechaLabel}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Hora Entrada</label>
              <input type="time" value={horaEntrada} onChange={e => setHoraEntrada(e.target.value)}
                className={inputCls} disabled={cargando} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Hora Salida</label>
              <input type="time" value={horaSalida} onChange={e => setHoraSalida(e.target.value)}
                className={inputCls} disabled={cargando} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer pt-1">
            <input type="checkbox" checked={esFeriado} onChange={e => setEsFeriado(e.target.checked)}
              disabled={cargando}
              className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-400" />
            Marcar este día como festivo / feriado
          </label>
        </form>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-3 mt-4 border-t border-slate-100">
        <button onClick={onClose} type="button" disabled={cargando}
          className="px-4 py-2 min-h-11 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-50">
          Cancelar
        </button>
        <button onClick={guardar} disabled={cargando}
          className="flex items-center gap-1.5 px-5 py-2 min-h-11 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all active:scale-95">
          <Users size={14} />
          {cargando ? 'Registrando...' : `Marcar para los ${totalEmpleados} empleados`}
        </button>
      </div>
    </Modal>
  )
}
