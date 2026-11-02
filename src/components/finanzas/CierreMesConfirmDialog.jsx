// src/components/finanzas/CierreMesConfirmDialog.jsx
// Confirmación antes de cerrar un mes: el cierre deja el libro de ese mes en solo lectura,
// así que se muestra qué se va a guardar y cuándo se puede deshacer.
import { Loader2, LockKeyhole } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { formatNumber } from './formatos.js'

export default function CierreMesConfirmDialog({ mes, cuentas, diferencias, pending, onClose, onConfirm }) {
  return (
    <Modal isOpen busy={pending} onClose={onClose} title={`¿Cerrar ${mes}?`}>
      <div className="text-slate-800">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4 text-amber-700">
          <LockKeyhole size={22} />
        </div>
        <ul className="space-y-2 text-sm leading-relaxed text-slate-700">
          <li>Se guarda el cierre de <strong>{cuentas} cuenta(s)</strong> con el saldo contado de cada una.</li>
          <li>El mes queda de <strong>solo lectura</strong>: no se podrán crear, anular ni editar sus movimientos.</li>
          <li>Si fue un error, el jefe puede reabrirlo desde el historial de cierres, pero solo mientras sea el mes anterior y el siguiente no esté abierto.</li>
        </ul>
        {diferencias.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
            <p className="font-bold">Diferencias contra el saldo calculado:</p>
            <ul className="mt-1 space-y-0.5">
              {diferencias.map(item => (
                <li key={item.id} className="font-mono">{item.nombre}: {item.diferencia > 0 ? '+' : ''}{formatNumber(item.diferencia)} {item.moneda}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-5 flex gap-2 justify-center">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="min-h-11 px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            Revisar de nuevo
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="min-h-11 px-4 py-2.5 rounded-xl bg-amber-700 text-sm font-black text-white hover:bg-amber-800 disabled:opacity-50 active:scale-95 transition-all inline-flex items-center gap-2 cursor-pointer"
          >
            {pending ? <><Loader2 size={14} className="animate-spin" />Cerrando...</> : 'Sí, cerrar mes'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
