// src/components/nomina/ControlAsistenciaToggle.jsx
// Interruptor por empleado: ¿aparece en la zona de Asistencia?
// Separa "está en nómina" (activo) de "se le registra asistencia"
// (controla_asistencia). Apagarlo NO cambia el salario ni el cálculo: la línea del
// período deja de sumar días para ese perfil, así que si tiene salario fijo se
// confirma con el usuario antes de aplicarlo.
import { useState } from 'react'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'

export default function ControlAsistenciaToggle({ config, onCambiar, cargando = false }) {
  const [confirmando, setConfirmando] = useState(false)
  const activo = config?.controla_asistencia !== false
  const salarioDia = Number(config?.salario_dia_usd) || 0
  const nombre = capitalizarPalabras(config?.empleado?.nombre) || 'Este trabajador'

  function alternar() {
    if (cargando) return
    // Quitar de Asistencia a alguien con sueldo fijo deja su período sin días:
    // se explica antes de aplicarlo en vez de hacerlo en silencio.
    if (activo && salarioDia > 0) {
      setConfirmando(true)
      return
    }
    onCambiar(!activo)
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex min-w-0 items-center gap-1.5 text-[11px] font-bold ${activo ? 'text-slate-500' : 'text-amber-700'}`}>
          <CalendarClock size={12} aria-hidden="true" />
          <span className="truncate">Aparece en Asistencia</span>
        </span>

        <button
          type="button"
          role="switch"
          aria-checked={activo}
          aria-label={activo ? `Quitar a ${nombre} de la zona de Asistencia` : `Incluir a ${nombre} en la zona de Asistencia`}
          onClick={alternar}
          disabled={cargando}
          className="inline-flex min-h-11 min-w-[3.5rem] shrink-0 items-center justify-center rounded-full disabled:opacity-50"
          style={{ touchAction: 'manipulation' }}
        >
          <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${activo ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className="sr-only">{activo ? 'Sí aparece' : 'No aparece'}</span>
            <span
              aria-hidden="true"
              className={`absolute h-5 w-5 rounded-full bg-white shadow transition-all ${activo ? 'left-[1.375rem]' : 'left-0.5'}`}
            />
          </span>
        </button>
      </div>

      {confirmando && (
        <Modal
          isOpen
          onClose={() => setConfirmando(false)}
          title="Quitar de la zona de Asistencia"
          className="max-w-md"
          busy={cargando}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="min-h-11 rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={cargando}
                onClick={() => { setConfirmando(false); onCambiar(false) }}
                className="min-h-11 rounded-xl bg-amber-500 px-4 text-xs font-black text-white shadow-md shadow-amber-500/20 transition-colors hover:bg-amber-600 disabled:opacity-60"
              >
                Quitar de Asistencia
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
              <div className="min-w-0 space-y-1.5 text-xs leading-relaxed text-amber-950">
                <p>
                  <strong>{nombre}</strong> tiene un salario fijo de <strong>${salarioDia.toFixed(2)}</strong> por día.
                </p>
                <p>
                  En este sistema la nómina se paga por día registrado en Asistencia. Si lo quitas, el período
                  dejará de sumar sus días y su línea quedará en $0, salvo bonos y comisiones que cargues aparte.
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Úsalo solo para perfiles que cobran por comisión o por monto fijo y no registran asistencia diaria.
            </p>
          </div>
        </Modal>
      )}
    </>
  )
}
