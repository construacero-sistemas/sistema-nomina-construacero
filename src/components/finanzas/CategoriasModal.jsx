// src/components/finanzas/CategoriasModal.jsx
// Gestor de categorías: elimina (baja lógica) y restaura las eliminadas.
// Todo es reversible: la eliminación nunca borra la fila, solo la oculta.
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { Trash2, RotateCcw, Tags } from 'lucide-react'

export default function CategoriasModal({ categorias = [], eliminadas = [], pendingId, onDelete, onRestore, onClose }) {
  return (
    <Modal isOpen onClose={onClose} title="Gestionar categorías" className="sm:max-w-lg">
      <p className="text-xs text-slate-500">
        Al eliminar una categoría deja de ofrecerse en nuevos movimientos, pero su historial se conserva y puedes restaurarla cuando quieras.
      </p>

      <div className="mt-4 max-h-[50vh] overflow-y-auto custom-scrollbar space-y-1.5 pr-1" role="list" aria-label="Categorías activas">
        {categorias.length === 0 && (
          <p className="text-xs text-slate-400 py-3 text-center">No hay categorías activas.</p>
        )}
        {categorias.map(cat => (
          <div
            key={cat.id || cat.nombre}
            role="listitem"
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-100 bg-slate-50/60"
          >
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-700 truncate">{cat.nombre}</p>
              <p className="text-[10px] text-slate-400">{cat.tipo === 'ambos' ? 'Ingresos y egresos' : cat.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}{cat.predeterminada ? ' · predeterminada' : ''}</p>
            </div>
            {cat.id ? (
              <button
                type="button"
                onClick={() => onDelete(cat.id)}
                disabled={pendingId === cat.id}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors cursor-pointer disabled:opacity-50"
                aria-label={`Eliminar ${cat.nombre}`}
              >
                <Trash2 size={12} /> Eliminar
              </button>
            ) : (
              <span className="text-[10px] text-slate-300 font-semibold">del sistema</span>
            )}
          </div>
        ))}
      </div>

      {eliminadas.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Eliminadas recientemente — recuperables</p>
          <div className="space-y-1.5" role="list" aria-label="Categorías eliminadas">
            {eliminadas.map(cat => (
              <div key={cat.id} role="listitem" className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-100">
                <span className="text-xs text-slate-500 truncate">{cat.nombre}</span>
                <button
                  type="button"
                  onClick={() => onRestore(cat.id)}
                  disabled={pendingId === cat.id}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 border border-transparent hover:border-emerald-200 transition-colors cursor-pointer disabled:opacity-50"
                  aria-label={`Restaurar ${cat.nombre}`}
                >
                  <RotateCcw size={12} /> Restaurar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 min-h-11 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
        >
          Listo
        </button>
      </div>
    </Modal>
  )
}

export { Tags as CategoriasIcon }
