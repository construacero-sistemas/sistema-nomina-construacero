// src/components/nomina/EmpleadoBajaModal.jsx
// Modal de confirmación segura para dar de baja a un trabajador de la nómina activa.
import { Trash2, AlertTriangle } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'

export default function EmpleadoBajaModal({ empleado, isOpen = true, onClose, onConfirm, cargando = false }) {
  const nombre = capitalizarPalabras(empleado?.nombre || empleado?.empleado?.nombre) || 'este empleado'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Confirmar baja del trabajador"
      className="max-w-sm"
    >
      <div className="space-y-4">
        <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200/80 flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
          <div className="text-xs text-red-900 space-y-1">
            <p className="font-bold">
              ¿Dar de baja a {nombre} de la nómina?
            </p>
            <p className="text-red-700 leading-relaxed">
              El trabajador dejará de aparecer en la lista activa de personal y en los cálculos de asistencia. Sus recibos históricos ya generados se conservarán intactos.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={cargando}
            style={{ touchAction: 'manipulation' }}
            className="min-h-11 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={cargando}
            style={{ touchAction: 'manipulation' }}
            className="min-h-11 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-md shadow-red-600/20 transition-all flex items-center gap-1.5 disabled:opacity-50"
          >
            <Trash2 size={14} />
            <span>{cargando ? 'Dando de baja...' : 'Confirmar Baja'}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
