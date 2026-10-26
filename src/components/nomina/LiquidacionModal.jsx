// src/components/nomina/LiquidacionModal.jsx
// Ajuste manual de bonos y descuentos sobre el recibo calculado de un empleado.
// Regla vigente: cada descuento lleva motivo obligatorio (Anticipo, Préstamo,
// Falta, Multa u Otro) y el neto nunca queda en negativo.
import { useMemo, useState } from 'react'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'
import { useAjustarLinea } from '../../hooks/useNomina'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import DescuentosEditor from './DescuentosEditor.jsx'
import { descuentosIniciales, normalizarDescuentosForm, validarDescuentosForm } from './descuentosUtils.js'

const inputCls = 'w-full min-h-11 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-[16px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function LiquidacionModal({ linea, onClose }) {
  const ajustar = useAjustarLinea()

  const [bonos, setBonos]   = useState(String(linea.bonos_usd ?? 0))
  const [notaBonos, setNotaBonos] = useState(linea.nota_bonos ?? '')
  const [descuentos, setDescuentos] = useState(() => descuentosIniciales(linea))
  const [error, setError]   = useState('')

  const cargando = ajustar.isPending

  // Base = todo lo calculado desde asistencia (sin ajustes manuales)
  const base = useMemo(() => (
    Number(linea.monto_normal_usd  || 0) +
    Number(linea.monto_extra_usd   || 0) +
    Number(linea.monto_sabado_usd  || 0) +
    Number(linea.monto_feriado_usd || 0)
  ), [linea])

  const bonosNum = Number(bonos) || 0
  const bruto = base + (bonosNum > 0 ? bonosNum : 0)
  const validacion = useMemo(() => validarDescuentosForm(descuentos, bruto), [descuentos, bruto])
  const neto  = Math.max(0, bruto - validacion.total)

  async function guardar(e) {
    if (e) e.preventDefault()
    setError('')
    if (bonosNum < 0) {
      setError('El bono no puede ser negativo')
      return
    }
    if (!validacion.ok) {
      setError(validacion.errorGlobal || 'Revisa los descuentos: cada uno exige motivo y monto mayor que 0')
      return
    }
    try {
      await ajustar.mutateAsync({
        lineaId: linea.id,
        bonosUsd: bonosNum,
        notaBonos: notaBonos || undefined,
        descuentos: normalizarDescuentosForm(descuentos),
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Error al ajustar')
    }
  }

  return (
    <Modal
      isOpen onClose={onClose}
      title={`Ajustar pago: ${capitalizarPalabras(linea.empleado?.nombre) || 'empleado'}`}
      className="max-w-md">
      <div className="space-y-4">
        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Desglose calculado (solo lectura) */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
Calculado con la asistencia
          </div>
          {[
            { label: 'Sueldo mensual (referencia)', value: Number(linea.salario_dia_usd_snap || 0) * 30 },
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
              className={`${inputCls} !py-2`} disabled={cargando} />
          </div>

          {/* Descuentos con motivo obligatorio */}
          <DescuentosEditor
            filas={descuentos}
            validacion={validacion}
            onChange={setDescuentos}
            disabled={cargando}
          />
        </form>

        {/* Resultado */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-amber-800">Total bruto</span>
            <span className="font-bold text-amber-900">${fmt(bruto)}</span>
          </div>
          {validacion.total > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-amber-800">Descuentos</span>
              <span className="font-bold text-red-600">−${fmt(validacion.total)}</span>
            </div>
          )}
          <div className="flex justify-between pt-1.5 border-t border-amber-200">
            <span className="text-sm font-bold text-amber-900">Total neto</span>
            <span className="text-lg font-black text-amber-700">${fmt(neto)}</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-wrap justify-end gap-2 pt-3 mt-3 border-t border-slate-100">
        <button onClick={onClose} type="button" disabled={cargando}
          className="min-h-11 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
          Cancelar
        </button>
        <button onClick={guardar} disabled={cargando || !validacion.ok}
          className="min-h-11 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-bold">
          {cargando ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </Modal>
  )
}
