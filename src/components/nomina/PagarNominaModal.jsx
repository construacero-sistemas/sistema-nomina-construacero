// src/components/nomina/PagarNominaModal.jsx
// Registro del pago de uno o varios recibos de nómina.
import { useState, useMemo } from 'react'
import { Wallet } from 'lucide-react'
import { usePagarLineas } from '../../hooks/useNomina'
import { Modal } from '../../../compat/components/ui/Modal.jsx'

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function PagarNominaModal({ lineas = [], periodo, onClose }) {
  const pagar = usePagarLineas()
  const [referencia, setReferencia] = useState('')
  const [error, setError] = useState('')

  const total = useMemo(
    () => lineas.reduce((s, l) => s + Number(l.total_neto_usd || 0), 0),
    [lineas]
  )

  const individual = lineas.length === 1
  const cargando = pagar.isPending

  async function confirmar(e) {
    if (e) e.preventDefault()
    setError('')
    try {
      await pagar.mutateAsync({
        lineaIds: lineas.map(l => l.id),
        referencia: referencia || undefined,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Error al registrar el pago')
    }
  }

  return (
    <Modal
      isOpen onClose={onClose}
      title={individual ? `Pagar a ${lineas[0].empleado?.nombre ?? 'empleado'}` : 'Pagar nómina'}
      className="max-w-md">
      <div className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Resumen */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-amber-800 font-medium">
              {individual ? 'Monto a pagar' : `${lineas.length} recibo(s) · total`}
            </span>
            <span className="text-xl font-black text-amber-700">${fmt(total)}</span>
          </div>
          {periodo && (
            <p className="text-[11px] text-amber-700/80 mt-1">{periodo.nombre}</p>
          )}
        </div>

        {/* Detalle de recibos (si son varios) */}
        {!individual && (
          <div className="bg-slate-50 rounded-xl p-2.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Recibos incluidos
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1">
              {lineas.map(l => (
                <div key={l.id} className="flex justify-between text-xs">
                  <span className="text-slate-600 truncate pr-2">{l.empleado?.nombre || '—'}</span>
                  <span className="font-bold text-slate-800 shrink-0">${fmt(l.total_neto_usd)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={confirmar} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Referencia de pago (opcional)</label>
            <input
              type="text" value={referencia} onChange={e => setReferencia(e.target.value)}
              placeholder="Ej: Transferencia BNC 12345, efectivo"
              className={inputCls} disabled={cargando}
            />
          </div>
        </form>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Al registrar el pago los recibos quedan marcados como pagados. Si se pagan todos los del
            período, el período pasa a estado <strong>pagado</strong>. Un pago puede revertirse
            individualmente desde el detalle del período.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-slate-100">
        <button onClick={onClose} type="button" disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
          Cancelar
        </button>
        <button onClick={confirmar} disabled={cargando || lineas.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-bold">
          <Wallet size={14} />
          {cargando ? 'Procesando...' : `Confirmar pago`}
        </button>
      </div>
    </Modal>
  )
}
