// src/components/finanzas/ReabrirCierreDialog.jsx
// Reabrir el último mes cerrado: pide motivo (queda auditado junto con los saldos del cierre anterior).
import { useState } from 'react'
import { Loader2, Undo2 } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'

export default function ReabrirCierreDialog({ mes, pending, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState('')
  const limpio = motivo.trim()
  const listo = limpio.length >= 8
  return (
    <Modal isOpen busy={pending} onClose={onClose} title={`¿Reabrir ${mes}?`}>
      <form className="text-slate-800" onSubmit={event => { event.preventDefault(); if (listo && !pending) onConfirm(limpio) }}>
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4 text-amber-700">
          <Undo2 size={22} />
        </div>
        <p className="text-sm leading-relaxed text-slate-700">
          El mes vuelve a estar abierto: podrás corregir sus movimientos y cerrarlo de nuevo con el conteo correcto.
          Los saldos del cierre actual quedan guardados en la auditoría. Solo es posible mientras sea el mes anterior y el mes siguiente no esté abierto.
        </p>
        <label className="mt-3 block text-xs font-bold text-slate-700">
          Motivo de la reapertura
          <input
            value={motivo}
            onChange={event => setMotivo(event.target.value)}
            maxLength={300}
            disabled={pending}
            placeholder="Ej.: cerré el mes por error antes de contar"
            className="mt-1 w-full min-h-11 rounded-lg border border-slate-300 p-2.5 text-base focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
          />
          <span className={`mt-1 block text-xs ${listo ? 'text-emerald-700' : 'text-slate-500'}`}>{limpio.length}/8 caracteres como mínimo</span>
        </label>
        <div className="mt-5 flex gap-2 justify-center">
          <button type="button" onClick={onClose} disabled={pending}
            className="min-h-11 px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer">
            Cancelar
          </button>
          <button type="submit" disabled={!listo || pending}
            className="min-h-11 px-4 py-2.5 rounded-xl bg-amber-700 text-sm font-black text-white hover:bg-amber-800 disabled:opacity-50 active:scale-95 transition-all inline-flex items-center gap-2 cursor-pointer">
            {pending ? <><Loader2 size={14} className="animate-spin" />Reabriendo...</> : 'Sí, reabrir mes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
