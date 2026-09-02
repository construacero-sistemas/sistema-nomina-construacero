// src/components/finanzas/ReasignarCuentaModal.jsx
// Acción masiva: asigna los movimientos "sin cuenta asignada" a una cuenta de
// custodia concreta. Solo lista movimientos activos sin cuenta_origen válida.
import { useMemo, useState } from 'react'
import { CheckCircle2, Inbox } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import { asignarMovimientoACuenta } from '../../utils/carterasHelper.js'

function money(mov) {
  const esVes = (mov.moneda || '').toUpperCase() === 'VES'
  const valor = Number(esVes ? mov.monto_ves : mov.monto) || 0
  return `${esVes ? 'Bs. ' : '$'}${valor.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dateLabel(iso) {
  if (!iso) return ''
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })
}

export default function ReasignarCuentaModal({
  open,
  onClose,
  movimientos = [],
  cuentas = [],
  onConfirm,
  confirmando = false,
}) {
  const [cuentaId, setCuentaId] = useState('')
  const [seleccion, setSeleccion] = useState(() => new Set())

  // Movimientos activos SIN cuenta de custodia explícita (misma lógica que los saldos).
  const sinCuenta = useMemo(
    () => movimientos.filter(mov => mov.estado !== 'anulado' && !asignarMovimientoACuenta(mov, cuentas)),
    [movimientos, cuentas],
  )

  const cuentaDestino = cuentas.find(c => c.id === cuentaId) || null
  const puedeConfirmar = cuentaId && seleccion.size > 0 && !confirmando

  const toggle = id => {
    setSeleccion(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const confirmar = () => {
    if (!puedeConfirmar) return
    onConfirm({ ids: [...seleccion], cuentaOrigen: cuentaDestino.nombre })
    setSeleccion(new Set())
    setCuentaId('')
    onClose()
  }

  return (
    <Modal isOpen={open} onClose={onClose} title="Asignar cuenta a movimientos" className="sm:max-w-md">
      {sinCuenta.length === 0 ? (
        <div className="text-center py-8 space-y-2">
          <CheckCircle2 size={36} className="mx-auto text-emerald-500" />
          <p className="text-sm font-bold text-slate-700">Todo clasificado</p>
          <p className="text-xs text-slate-500">
            No hay movimientos pendientes de asignar a una cuenta de custodia.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
          >
            Cerrar
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            {sinCuenta.length} movimiento(s) viven en su subcuenta lógica pero no están
            asignados a una cuenta de custodia concreta. Selecciónalos y asígnalos.
          </p>

          {/* Destino */}
          <div>
            <span className="block text-[11px] font-bold text-slate-600 mb-1.5" id="cuenta-destino-label">
              Cuenta de destino
            </span>
            <CustomSelect
              value={cuentaId}
              onChange={setCuentaId}
              placeholder="Selecciona una cuenta…"
              options={cuentas.map(c => ({ value: c.id, label: c.nombre, sub: c.banco || undefined }))}
            />
          </div>

          {/* Lista de movimientos sin cuenta */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
                <Inbox size={12} /> Movimientos sin cuenta
              </span>
              <button
                type="button"
                onClick={() => setSeleccion(new Set(sinCuenta.map(m => m.id)))}
                className="text-[11px] font-bold text-primary hover:underline"
              >
                Seleccionar todos
              </button>
            </div>
            <ul className="max-h-56 overflow-y-auto custom-scrollbar divide-y divide-slate-100 rounded-xl border border-slate-100">
              {sinCuenta.map(mov => {
                const checked = seleccion.has(mov.id)
                return (
                  <li key={mov.id}>
                    <label
                      className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors ${checked ? 'bg-primary/5' : 'hover:bg-slate-50'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(mov.id)}
                        className="w-4 h-4 accent-[var(--color-primary,oklch(0.55_0.15_250))]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-bold text-slate-800 truncate">{mov.concepto || mov.categoria}</span>
                        <span className="block text-[10px] text-slate-400">
                          {dateLabel(mov.fecha)} · {mov.categoria}
                        </span>
                      </span>
                      <span className={`text-xs font-black shrink-0 ${(mov.tipo === 'ingreso') ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {mov.tipo === 'ingreso' ? '+' : '−'}{money(mov)}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-slate-400 font-bold">
              {seleccion.size} seleccionado(s)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmar}
                disabled={!puedeConfirmar}
                className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold shadow-xs transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {confirmando ? 'Asignando…' : 'Asignar cuenta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
