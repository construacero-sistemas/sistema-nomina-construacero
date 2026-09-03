// src/components/finanzas/CategoriasModal.jsx
// Gestor integral de categorías: creación rápida, baja lógica segura (Opción A) y restauración.
// Todo es reversible: archivar una categoría nunca borra sus movimientos históricos.
import { useState } from 'react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { Trash2, RotateCcw, Tags, Plus, Loader2 } from 'lucide-react'
import { EliminarCategoriaDialog } from './CategoriaAcciones.jsx'
import { capitalizarTexto } from '../../utils/cuentasCustodiaUtils.js'

export default function CategoriasModal({
  categorias = [],
  eliminadas = [],
  pendingId,
  onCrear,
  onDelete,
  onRestore,
  onClose,
}) {
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoTipo, setNuevoTipo] = useState('ambos')
  const [creando, setCreando] = useState(false)
  const [errorCrear, setErrorCrear] = useState('')
  const [catAEliminar, setCatAEliminar] = useState(null)

  async function handleCrear(e) {
    e?.preventDefault()
    const n = nuevoNombre.trim()
    if (n.length < 2) {
      setErrorCrear('El nombre debe tener al menos 2 caracteres.')
      return
    }
    setErrorCrear('')
    setCreando(true)
    try {
      if (onCrear) {
        await onCrear({ nombre: capitalizarTexto(n), tipo: nuevoTipo })
      }
      setNuevoNombre('')
      setNuevoTipo('ambos')
    } catch (err) {
      setErrorCrear(err.message || 'No se pudo crear la categoría.')
    } finally {
      setCreando(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Gestionar categorías" className="sm:max-w-lg">
      <p className="text-xs text-slate-500">
        Crea nuevas categorías o archiva las que no uses. Los movimientos históricos que ya las tengan asignadas se mantendrán 100% intactos.
      </p>

      {/* 1. Panel de Creación Rápida Superior */}
      {onCrear && (
        <form onSubmit={handleCrear} className="mt-4 p-3 rounded-2xl border border-primary/20 bg-primary/5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-primary flex items-center gap-1.5">
              <Plus size={14} /> Nueva categoría
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={nuevoNombre}
              onChange={e => {
                setNuevoNombre(e.target.value)
                if (errorCrear) setErrorCrear('')
              }}
              onBlur={() => setNuevoNombre(prev => capitalizarTexto(prev))}
              maxLength={80}
              placeholder="Nombre (ej. Mantenimiento, Publicidad...)"
              className="flex-1 h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
              disabled={creando}
            />
            <div className="inline-flex h-11 rounded-xl border border-slate-200 bg-white overflow-hidden shrink-0" role="group" aria-label="Tipo de categoría">
              {[
                { v: 'ambos', l: 'Ambos' },
                { v: 'egreso', l: 'Egresos' },
                { v: 'ingreso', l: 'Ingresos' },
              ].map(op => (
                <button
                  key={op.v}
                  type="button"
                  onClick={() => setNuevoTipo(op.v)}
                  disabled={creando}
                  aria-pressed={nuevoTipo === op.v}
                  className={`px-2.5 text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${nuevoTipo === op.v ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {op.l}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={creando || !nuevoNombre.trim()}
              className="h-11 px-4 rounded-xl bg-primary text-xs font-black text-white hover:bg-primary-hover disabled:opacity-50 active:scale-95 transition-all shadow-xs inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              {creando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Añadir
            </button>
          </div>

          {errorCrear && (
            <p className="text-[11px] font-bold text-rose-600 px-1">{errorCrear}</p>
          )}
        </form>
      )}

      {/* 2. Lista de Categorías Activas */}
      <div className="mt-4 max-h-[40vh] overflow-y-auto custom-scrollbar space-y-1.5 pr-1" role="list" aria-label="Categorías activas">
        {categorias.length === 0 && (
          <p className="text-xs text-slate-400 py-3 text-center">No hay categorías activas.</p>
        )}
        {categorias.map(cat => {
          const movsCount = Number(cat.movimientos_count || 0)
          return (
            <div
              key={cat.id || cat.nombre}
              role="listitem"
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-100 bg-slate-50/60"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold text-slate-700 truncate">{cat.nombre}</p>
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                    movsCount > 0 ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-400'
                  }`}>
                    {movsCount > 0 ? `${movsCount} movs` : '0 movs'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400">
                  {cat.tipo === 'ambos' ? 'Ingresos y egresos' : cat.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}
                  {cat.predeterminada ? ' · predeterminada' : ''}
                </p>
              </div>
              {cat.id ? (
                <button
                  type="button"
                  onClick={() => setCatAEliminar(cat)}
                  disabled={pendingId === cat.id}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors cursor-pointer disabled:opacity-50"
                  aria-label={`Eliminar ${cat.nombre}`}
                >
                  <Trash2 size={12} /> {movsCount > 0 ? 'Archivar' : 'Eliminar'}
                </button>
              ) : (
                <span className="text-[10px] text-slate-300 font-semibold">del sistema</span>
              )}
            </div>
          )
        })}
      </div>

      {/* 3. Categorías Archivadas / Recuperables */}
      {eliminadas.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Archivadas — recuperables</p>
          <div className="space-y-1.5" role="list" aria-label="Categorías eliminadas">
            {eliminadas.map(cat => {
              const movsCount = Number(cat.movimientos_count || 0)
              return (
                <div key={cat.id} role="listitem" className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-100">
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-xs text-slate-500 truncate">{cat.nombre}</span>
                    {movsCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-100 text-slate-500 font-semibold">
                        {movsCount} movs
                      </span>
                    )}
                  </div>
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
              )
            })}
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

      {/* Diálogo inteligente de confirmación de Archivado (Opción A) */}
      {catAEliminar && (
        <EliminarCategoriaDialog
          nombre={catAEliminar.nombre}
          movimientosCount={catAEliminar.movimientos_count || 0}
          pending={pendingId === catAEliminar.id}
          onClose={() => setCatAEliminar(null)}
          onConfirm={async () => {
            await onDelete(catAEliminar.id)
            setCatAEliminar(null)
          }}
        />
      )}
    </Modal>
  )
}

export { Tags as CategoriasIcon }
