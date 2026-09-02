// src/components/nomina/LiquidacionModal.jsx
// Ajuste manual de bonos y deducciones sobre el recibo calculado de un empleado.
import { useState, useMemo } from 'react'
import { useAjustarLinea } from '../../hooks/useNomina'
import { Modal } from '../../../compat/components/ui/Modal.jsx'

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function LiquidacionModal({ linea, onClose }) {
  const ajustar = useAjustarLinea()

  const [bonos, setBonos]   = useState(String(linea.bonos_usd ?? 0))
  const [deduc, setDeduc]   = useState(String(linea.deducciones_usd ?? 0))
  const [notaBonos, setNotaBonos] = useState(linea.nota_bonos ?? '')
  const [notaDeduc, setNotaDeduc] = useState(linea.nota_deducciones ?? '')
  const [error, setError]   = useState('')

  const cargando = ajustar.isPending

  // Base = todo lo calculado desde asistencia (sin ajustes manuales)
  const base = useMemo(() => (
    Number(linea.monto_normal_usd  || 0) +
    Number(linea.monto_extra_usd   || 0) +
    Number(linea.monto_sabado_usd  || 0) +
    Number(linea.monto_feriado_usd || 0)
  ), [linea])

  const bruto = base + (Number(bonos) || 0)
  const neto  = Math.max(0, bruto - (Number(deduc) || 0))

  async function guardar(e) {
    if (e) e.preventDefault()
    setError('')
    if (Number(bonos) < 0 || Number(deduc) < 0) {
      setError('Los montos no pueden ser negativos')
      return
    }
    try {
      await ajustar.mutateAsync({
        lineaId: linea.id,
        bonosUsd: Number(bonos) || 0,
        deduccionesUsd: Number(deduc) || 0,
        notaBonos: notaBonos || undefined,
        notaDeducciones: notaDeduc || undefined,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Error al ajustar')
    }
  }

  return (
    <Modal
      isOpen onClose={onClose}
      title={`Ajustar pago: ${linea.empleado?.nombre ?? 'empleado'}`}
      className="max-w-md">
      <div className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Desglose calculado (solo lectura) */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
Calculado con la asistencia
          </div>
          {[
            { label: `Días trabajados (${Number(linea.dias_trabajados)})`, value: linea.monto_normal_usd },
            { label: `Horas extra (${Number(linea.horas_extra).toFixed(1)}h)`, value: linea.monto_extra_usd },
            { label: `Recargo sábados (${linea.dias_sabado})`, value: linea.monto_sabado_usd },
            { label: `Recargo feriados (${linea.dias_feriado})`, value: linea.monto_feriado_usd },
          ].filter(r => Number(r.value) > 0).map(r => (
            <div key={r.label} className="flex justify-between text-xs">
              <span className="text-slate-500">{r.label}</span>
              <span className="font-semibold text-slate-700">${fmt(r.value)}</span>
            </div>
          ))}
          <div className="flex justify-between text-xs pt-1.5 border-t border-slate-200">
            <span className="font-bold text-slate-600">Subtotal</span>
            <span className="font-black text-slate-800">${fmt(base)}</span>
          </div>
          {linea.dias_ausencia > 0 && (
            <p className="text-[10px] text-red-500 pt-1">
              {linea.dias_ausencia} día(s) de ausencia no remunerados
            </p>
          )}
        </div>

        <form onSubmit={guardar} className="space-y-4">
          {/* Bonos */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Bonos / adicionales (USD)</label>
            <input type="number" min="0" step="0.01" value={bonos}
              onChange={e => setBonos(e.target.value)}
              className={inputCls} disabled={cargando} />
            <input type="text" value={notaBonos} onChange={e => setNotaBonos(e.target.value)}
              placeholder="Concepto del bono (opcional)"
              className={`${inputCls} !py-2 !text-xs`} disabled={cargando} />
          </div>

          {/* Deducciones */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">Deducciones (USD)</label>
            <input type="number" min="0" step="0.01" value={deduc}
              onChange={e => setDeduc(e.target.value)}
              className={inputCls} disabled={cargando} />
            <input type="text" value={notaDeduc} onChange={e => setNotaDeduc(e.target.value)}
              placeholder="Concepto: adelanto, préstamo, etc. (opcional)"
              className={`${inputCls} !py-2 !text-xs`} disabled={cargando} />
          </div>
        </form>

        {/* Resultado */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-amber-800">Total bruto</span>
            <span className="font-bold text-amber-900">${fmt(bruto)}</span>
          </div>
          {Number(deduc) > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-amber-800">Deducciones</span>
              <span className="font-bold text-red-600">−${fmt(deduc)}</span>
            </div>
          )}
          <div className="flex justify-between pt-1.5 border-t border-amber-200">
            <span className="text-sm font-bold text-amber-900">Total neto</span>
            <span className="text-lg font-black text-amber-700">${fmt(neto)}</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-slate-100">
        <button onClick={onClose} type="button" disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
          Cancelar
        </button>
        <button onClick={guardar} disabled={cargando}
          className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-bold">
          {cargando ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </Modal>
  )
}
