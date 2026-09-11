// src/components/nomina/EmpleadoEliminarModal.jsx
// Modal de confirmación para eliminar por completo a un trabajador de la nómina
import { Trash2, AlertTriangle, ShieldAlert } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'

export default function EmpleadoEliminarModal({ empleado, isOpen = true, onClose, onConfirm, cargando = false }) {
  const nombre = capitalizarPalabras(empleado?.nombre || empleado?.empleado?.nombre) || 'este trabajador'

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Eliminar trabajador definitivamente"
      className="max-w-md"
    >
      <div className="space-y-4">
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3">
          <ShieldAlert size={22} className="text-rose-600 shrink-0 mt-0.5" />
          <div className="text-xs text-rose-950 space-y-1.5">
            <p className="font-bold text-sm text-rose-900">
              ¿Eliminar permanentemente a {nombre}?
            </p>
            <p className="text-rose-800 leading-relaxed">
              Esta acción eliminará el registro de nómina por completo. <strong>Solo se permite para trabajadores creados por error o pruebas</strong>.
            </p>
            <div className="p-2 rounded-xl bg-white/70 border border-rose-200/80 text-[11px] text-rose-900 font-medium">
              Nota: Si el trabajador cuenta con historial de asistencias o recibos de períodos pasados, el sistema rechazará la eliminación para proteger los balances contables.
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={cargando}
            style={{ touchAction: 'manipulation' }}
            className="min-h-11 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={cargando}
            style={{ touchAction: 'manipulation' }}
            className="min-h-11 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Trash2 size={14} />
            <span>{cargando ? 'Eliminando...' : 'Eliminar definitivamente'}</span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
