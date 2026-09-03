// src/components/finanzas/AnularDialog.jsx
// Diálogo de confirmación de anulación: requiere motivo y no borra el movimiento.
import { useState } from 'react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'

export default function AnularDialog({ movimiento, pending, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState('')
  return (
    <Modal isOpen onClose={onClose} title="¿Anular este movimiento?" className="sm:max-w-md">
      <p className="text-sm text-slate-500">No se borrará. Quedará fuera del balance vigente y conservará su historial.</p>
      <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><strong>{movimiento.concepto}</strong> · {formatUsd(movimiento.monto)} {movimiento.moneda}</p>
      <label className="block mt-4 text-xs font-bold text-slate-600">¿Por qué quieres anularlo? *<textarea value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={300} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" placeholder="Describe por qué se anula..." /></label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={pending} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50">Cancelar</button>
        <button type="button" onClick={() => onConfirm(motivo.trim())} disabled={pending || motivo.trim().length < 3} className="px-4 py-2 rounded-xl bg-red-600 text-sm font-black text-white disabled:opacity-50">{pending ? 'Guardando...' : 'Sí, anular movimiento'}</button>
      </div>
    </Modal>
  )
}

function formatUsd(value) {
  return `$${Number(value || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
