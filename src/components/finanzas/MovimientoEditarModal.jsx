// src/components/finanzas/MovimientoEditarModal.jsx
// Modal de edición rápida de categoría y concepto de movimientos (exclusivo jefe).
import { useState, useMemo } from 'react'
import { Save } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import { formatUsd } from './formatos.js'

export default function MovimientoEditarModal({
  open,
  movimiento,
  categorias = [],
  onClose,
  onGuardar,
  pending = false,
}) {
  const [categoria, setCategoria] = useState(movimiento?.categoria || '')
  const [concepto, setConcepto] = useState(movimiento?.concepto || '')
  const [referencia, setReferencia] = useState(movimiento?.referencia || '')

  const opcionesCategoria = useMemo(() => {
    const list = categorias.map(c => typeof c === 'string' ? { value: c, label: c } : { value: c.nombre, label: c.nombre })
    // Asegurar que la categoría actual aparezca aunque no esté en la lista activa
    if (categoria && !list.some(o => o.value === categoria)) {
      list.unshift({ value: categoria, label: categoria })
    }
    return list
  }, [categorias, categoria])

  if (!open || !movimiento) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!concepto.trim() || !categoria.trim() || pending) return
    await onGuardar?.({
      id: movimiento.id,
      categoria: categoria.trim(),
      concepto: concepto.trim(),
      referencia: referencia.trim() || undefined,
    })
  }

  const footer = (
    <div className="flex flex-wrap items-center justify-end gap-2 w-full">
      <button
        type="button"
        onClick={onClose}
        disabled={pending}
        className="min-h-11 px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
        style={{ touchAction: 'manipulation' }}
      >
        Cancelar
      </button>
      <button
        type="submit"
        form="form-editar-movimiento"
        disabled={pending || !concepto.trim() || !categoria.trim()}
        className="min-h-11 px-4 py-2 rounded-xl bg-primary text-white text-sm font-black inline-flex items-center gap-2 hover:bg-primary/95 disabled:opacity-50 transition-all shadow-xs cursor-pointer"
        style={{ touchAction: 'manipulation' }}
      >
        <Save size={16} aria-hidden="true" />
        <span>{pending ? 'Guardando...' : 'Guardar cambios'}</span>
      </button>
    </div>
  )

  const montoTxt = movimiento.moneda === 'USD'
    ? formatUsd(movimiento.monto)
    : `${Number(movimiento.monto || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${movimiento.moneda}`

  return (
    <Modal isOpen={open} onClose={onClose} busy={pending} title="Editar Movimiento" className="sm:max-w-lg" footer={footer}>
      <form id="form-editar-movimiento" onSubmit={handleSubmit} className="space-y-4">
        {/* Ficha informativa fija del movimiento (datos inmutables) */}
        <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs space-y-1">
          <div className="flex items-center justify-between text-slate-700 font-bold">
            <span className={movimiento.tipo === 'ingreso' ? 'text-emerald-700' : 'text-rose-700'}>
              {movimiento.tipo === 'ingreso' ? 'INGRESO' : 'EGRESO'}
            </span>
            <span className="text-slate-900 font-black">{montoTxt}</span>
          </div>
          <p className="text-slate-500">
            Fecha: {movimiento.fecha} {movimiento.cuenta_origen ? ` · Cuenta: ${movimiento.cuenta_origen}` : ''}
          </p>
          <p className="text-[11px] text-slate-400">
            Los valores contables se conservan intactos para proteger los balances y cierres.
          </p>
        </div>

        {/* Categoría */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Categoría *
          </label>
          <CustomSelect
            value={categoria}
            onChange={setCategoria}
            options={opcionesCategoria}
            disabled={pending}
            className="w-full min-h-11"
          />
        </div>

        {/* Concepto / Motivo */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Concepto / Motivo *
          </label>
          <textarea
            value={concepto}
            onChange={e => setConcepto(e.target.value)}
            disabled={pending}
            maxLength={180}
            rows={2}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all"
            placeholder="Describe el concepto o motivo..."
            required
          />
          <p className="text-right text-[10px] text-slate-400 mt-0.5">
            {concepto.length} / 180 caracteres
          </p>
        </div>

        {/* Referencia opcional */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Referencia (opcional)
          </label>
          <input
            type="text"
            value={referencia}
            onChange={e => setReferencia(e.target.value)}
            disabled={pending}
            maxLength={160}
            className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all"
            placeholder="Nº de comprobante, factura o referencia..."
          />
        </div>
      </form>
    </Modal>
  )
}
