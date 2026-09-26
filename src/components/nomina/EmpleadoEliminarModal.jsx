// src/components/nomina/EmpleadoEliminarModal.jsx
// Confirmación explícita para borrar la ficha y, si se autoriza, el historial no financiero.
import { useState } from 'react'
import { Trash2, AlertTriangle, ShieldAlert } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'

export default function EmpleadoEliminarModal({ empleado, isOpen = true, onClose, onConfirm, cargando = false }) {
  const nombre = capitalizarPalabras(empleado?.nombre || empleado?.empleado?.nombre) || 'este trabajador'
  const [incluirHistorial, setIncluirHistorial] = useState(false)
  const [confirmarNombre, setConfirmarNombre] = useState('')
  const [error, setError] = useState('')

  async function confirmarEliminacion() {
    setError('')
    try {
      await onConfirm({ incluirHistorial, empleadoId: empleado?.empleado_id, confirmarNombre })
    } catch (submitError) {
      setError(submitError?.message || 'No se pudo eliminar al trabajador.')
    }
  }

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
              Se eliminará definitivamente la ficha del trabajador y sus horarios.
            </p>
            <label className="flex min-h-11 items-start gap-2 rounded-xl border border-rose-200 bg-white/80 p-2.5 text-[11px] font-semibold leading-relaxed text-rose-950">
              <input
                type="checkbox"
                checked={incluirHistorial}
                onChange={event => setIncluirHistorial(event.target.checked)}
                disabled={cargando}
                className="mt-0.5 h-4 w-4 shrink-0 accent-rose-600"
              />
              También eliminar asistencias y recibos no pagados de períodos abiertos. Los pagos, períodos cerrados y la auditoría se conservan.
            </label>
            {incluirHistorial && (
              <label className="block space-y-1.5 text-[11px] font-bold text-rose-950">
                Escribe <strong className="select-all">{nombre}</strong> para confirmar esta eliminación
                <input
                  type="text"
                  value={confirmarNombre}
                  onChange={event => setConfirmarNombre(event.target.value)}
                  disabled={cargando}
                  autoComplete="off"
                  className="min-h-11 w-full rounded-xl border border-rose-300 bg-white px-3 text-[16px] font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                  aria-label="Confirmar el nombre del trabajador"
                />
              </label>
            )}
            <div className="p-2 rounded-xl bg-white/70 border border-rose-200/80 text-[11px] text-rose-900 font-medium">
              Si un recibo tiene un pago, una reversión, conceptos o una referencia financiera, el servidor rechazará el borrado para proteger la integridad del libro.
            </div>
            {error && <p role="alert" className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-800">{error}</p>}
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
            onClick={confirmarEliminacion}
            disabled={cargando || (incluirHistorial && confirmarNombre.trim().toLocaleLowerCase('es') !== nombre.trim().toLocaleLowerCase('es'))}
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
