// src/components/finanzas/CategoriaAcciones.jsx
// Piezas de UI para gestionar categorías desde el formulario de movimientos:
// panel inline de creación y diálogo de confirmación de borrado (baja lógica).
import { Loader2, Trash2 } from 'lucide-react'

const inputClass = 'w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all'

/** Panel inline para crear una categoría personalizada sin salir del formulario. */
export function CrearCategoriaPanel({ tipo, nombre, onNombre, onGuardar, onCancelar, pending }) {
  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/5 p-3.5 space-y-2.5" role="group" aria-label="Crear nueva categoría">
      <div className="flex items-center gap-2">
        <span className="text-xs font-black text-primary">
          Nueva categoría · {tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}
        </span>
      </div>
      <input
        value={nombre}
        onChange={e => onNombre(e.target.value)}
        maxLength={80}
        placeholder="Ej: Mantenimiento, Publicidad, Comisiones..."
        className={inputClass}
        disabled={pending}
        aria-label="Nombre de la nueva categoría"
        autoFocus
      />
      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={onCancelar}
          disabled={pending}
          className="h-11 px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onGuardar}
          disabled={pending}
          className="h-11 px-4 rounded-xl bg-primary text-xs font-black text-white hover:bg-primary-hover disabled:opacity-50 active:scale-95 transition-all inline-flex items-center gap-2 cursor-pointer shadow-sm"
        >
          {pending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Creando...
            </>
          ) : (
            'Crear categoría'
          )}
        </button>
      </div>
    </div>
  )
}

/**
 * Confirmación de borrado de categoría. Nunca borra la fila: es baja lógica
 * y el historial de movimientos conserva el nombre.
 */
export function EliminarCategoriaDialog({ nombre, movimientosCount = 0, pending, onClose, onConfirm }) {
  const tieneMovimientos = movimientosCount > 0
  return (
    <div
      className="fixed inset-0 z-[310] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eliminar-categoria-title"
      onClick={e => { if (e.target === e.currentTarget && !pending) onClose() }}
    >
      <div className="relative w-full max-w-sm rounded-3xl border border-white/10 p-6 shadow-2xl text-center animate-in zoom-in-95 duration-150 overflow-hidden" style={{ background: 'linear-gradient(180deg, #0f1f38 0%, #0a1628 100%)' }}>
        <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4 text-red-400">
          <Trash2 size={22} />
        </div>
        <h3 id="eliminar-categoria-title" className="text-base font-black text-white">
          {tieneMovimientos ? `¿Archivar la categoría "${nombre}"?` : `¿Eliminar la categoría "${nombre}"?`}
        </h3>
        <p className="mt-2 text-xs text-slate-300 leading-relaxed">
          {tieneMovimientos ? (
            <>
              Esta categoría tiene <strong className="text-amber-300 font-bold">{movimientosCount} movimiento(s)</strong> registrados. Al archivarla, <strong className="text-white">no se perderá ningún dato</strong>: tus movimientos pasados y reportes contables se conservarán 100% intactos. Solo dejará de ofrecerse para nuevos registros.
            </>
          ) : (
            <>
              Los movimientos que la usan <strong className="text-white">no se pierden</strong>: conservan el nombre en el historial y el PDF. Solo deja de ofrecerse al registrar movimientos nuevos.
            </>
          )}
        </p>
        <p className="mt-3 text-[11px] text-emerald-300/90">Podrás restaurarla en cualquier momento desde "Gestionar categorías".</p>
        <div className="mt-5 flex gap-2 justify-center">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="px-4 py-2.5 rounded-xl border border-white/15 text-xs font-bold text-slate-200 hover:bg-white/5 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="px-4 py-2.5 rounded-xl bg-red-600 text-xs font-black text-white hover:bg-red-700 disabled:opacity-50 active:scale-95 transition-all inline-flex items-center gap-2 cursor-pointer"
          >
            {pending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {tieneMovimientos ? 'Archivando...' : 'Eliminando...'}
              </>
            ) : (
              tieneMovimientos ? 'Sí, archivar' : 'Sí, eliminar'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Field({ label, children }) {
  return (
    <label className="block min-w-0">
      <span className="block mb-1 text-xs font-bold text-slate-700">{label}</span>
      {children}
    </label>
  )
}

