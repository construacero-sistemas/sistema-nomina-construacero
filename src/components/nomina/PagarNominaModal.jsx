// src/components/nomina/PagarNominaModal.jsx
// Registro del pago de uno o varios recibos de nómina con conversión en tiempo real a Bolívares.
// Regla: La moneda principal es SIEMPRE USD ($), y la secundaria es Bs, calculada con la tasa seleccionada.
import { useState, useMemo } from 'react'
import {
  Wallet, DollarSign, ArrowRight, Check, RefreshCw, Landmark,
  Building2, Smartphone, Banknote, Globe, CreditCard
} from 'lucide-react'
import { usePagarLineas } from '../../hooks/useNomina'
import useMonedaNomina, { formatBs, formatUsd } from '../../hooks/useMonedaNomina.js'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'

export default function PagarNominaModal({ lineas = [], periodo, onClose }) {
  const pagar = usePagarLineas()
  const {
    tipoTasa,
    setTipoTasa,
    tasaManual,
    setTasaManual,
    tasaActiva,
    nombreTasa,
    opcionesTasa,
    tasasMercado,
    aBs,
    fmtBs,
    loading: loadingTasas,
    refresh: refreshTasas,
  } = useMonedaNomina()

  const [referencia, setReferencia] = useState('')
  const [metodoPago, setMetodoPago] = useState('transferencia_bs')
  const [error, setError] = useState('')
  const [manualInput, setManualInput] = useState(tasaManual > 0 ? String(tasaManual) : '')

  const totalUsd = useMemo(
    () => lineas.reduce((s, l) => s + Number(l.total_neto_usd || 0), 0),
    [lineas]
  )

  const totalBs = useMemo(() => aBs(totalUsd), [aBs, totalUsd])

  const individual = lineas.length === 1
  const cargando = pagar.isPending

  function handleSelectTasa(id) {
    setTipoTasa(id)
  }

  function handleManualChange(val) {
    setManualInput(val)
    const num = parseFloat(val.replace(',', '.'))
    if (num > 0) {
      setTasaManual(num)
    }
  }

  async function confirmar(e) {
    if (e) e.preventDefault()
    setError('')
    try {
      const refFinal = [
        referencia.trim(),
        `Tasa: ${tasaActiva.toFixed(2)} Bs/$ (${nombreTasa})`,
        `Bs: ${formatBs(totalBs)}`,
      ].filter(Boolean).join(' · ')

      let fuente = 'BCV'
      if (tipoTasa === 'bcv_eur') fuente = 'EURO'
      if (tipoTasa === 'usdt') fuente = 'USDT'
      if (tipoTasa === 'manual') fuente = 'MANUAL'

      await pagar.mutateAsync({
        lineaIds: lineas.map(l => l.id),
        referencia: refFinal || undefined,
        tasaBcv: tasaActiva,
        fuenteTasa: fuente,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Error al registrar el pago')
    }
  }

  return (
    <Modal
      isOpen onClose={onClose}
      title={individual ? `Registrar pago de ${lineas[0].empleado?.nombre ?? 'empleado'}` : 'Registrar pagos de nómina'}
      className="max-w-lg">
      <div className="space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ═══ TARJETA DE RESUMEN PRINCIPAL (USD) Y SECUNDARIO (BS) ═══ */}
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white rounded-2xl p-4 shadow-lg border border-slate-700/60">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>{individual ? 'Monto a liquidar' : `${lineas.length} recibo(s) incluidos`}</span>
            {periodo && <span className="text-amber-400 font-semibold">{periodo.nombre}</span>}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 pt-1">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                Moneda Principal (USD)
              </span>
              <span className="text-2xl font-black text-white tracking-tight">
                {formatUsd(totalUsd)}
              </span>
            </div>

            <div className="sm:text-right mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-700/80">
              <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400 block">
                Equivalente en Bolívares (Bs)
              </span>
              <span className="text-lg font-black text-amber-300 font-mono">
                {formatBs(totalBs)}
              </span>
            </div>
          </div>
        </div>

        {/* ═══ SELECTOR DE TASA DE CAMBIO ═══ */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-black text-slate-700 uppercase tracking-wider">
              Tasa de Conversión para el Pago
            </label>
            <button
              type="button"
              onClick={() => refreshTasas()}
              className="text-[11px] text-primary hover:underline flex items-center gap-1 font-bold"
              title="Recargar tasas del día"
            >
              <RefreshCw size={11} className={loadingTasas ? 'animate-spin' : ''} />
              Actualizar
            </button>
          </div>

          {/* Botones de selección rápida */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {opcionesTasa.map(opt => {
              const isSelected = tipoTasa === opt.id
              let valor = 0
              if (opt.id === 'bcv_usd') valor = tasasMercado.bcv_usd
              if (opt.id === 'bcv_eur') valor = tasasMercado.bcv_eur
              if (opt.id === 'usdt') valor = tasasMercado.usdt
              if (opt.id === 'manual') valor = tasaManual

              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectTasa(opt.id)}
                  className={`p-2 rounded-xl text-left border transition-all ${
                    isSelected
                      ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <span className={`text-[10px] font-black block uppercase truncate ${isSelected ? 'text-white' : 'text-slate-500'}`}>
                    {opt.shortLabel}
                  </span>
                  <span className="text-xs font-bold font-mono block mt-0.5">
                    {valor > 0 ? `${valor.toFixed(2)}` : (opt.id === 'manual' ? 'Definir' : '—')}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Campo de edición de tasa manual si está seleccionada */}
          {tipoTasa === 'manual' && (
            <div className="pt-2 border-t border-slate-200/80 animate-in fade-in">
              <label className="block text-[11px] font-bold text-slate-600 mb-1">
                Ingresa la tasa acordada (Bs por cada $1 USD):
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="Ej: 42.50"
                  value={manualInput}
                  onChange={e => handleManualChange(e.target.value)}
                  className={inputCls}
                  autoFocus
                />
              </div>
            </div>
          )}
        </div>

        {/* Detalle de recibos incluidos (si son varios) */}
        {!individual && (
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Recibos incluidos ({lineas.length})
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
              {lineas.map(l => (
                <div key={l.id} className="flex justify-between items-center text-xs py-0.5">
                  <span className="text-slate-700 font-medium truncate pr-2">{l.empleado?.nombre || '—'}</span>
                  <span className="font-bold text-slate-800 shrink-0 font-mono">
                    {formatUsd(l.total_neto_usd)}
                    <span className="text-[10px] text-slate-400 font-normal ml-1">
                      ({formatBs(aBs(l.total_neto_usd))})
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={confirmar} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Método de pago</label>
            <CustomSelect
              value={metodoPago}
              onChange={setMetodoPago}
              options={[
                { value: 'Transf. / Pago Móvil', label: 'Transferencia / Pago Móvil (Bs)', icon: Building2 },
                { value: 'Efectivo $',          label: 'Efectivo en Dólares ($)',         icon: DollarSign },
                { value: 'Efectivo Bs',         label: 'Efectivo en Bolívares (Bs)',        icon: Banknote },
                { value: 'Zelle',               label: 'Zelle (USD)',                     icon: Globe },
                { value: 'Punto de Venta',      label: 'Punto de Venta (Bs)',             icon: CreditCard },
                { value: 'USDT',                label: 'USDT (Binance / Cripto)',          icon: Globe },
                { value: 'Otro',                label: 'Otro método de pago',                icon: CreditCard },
              ]}
              disabled={cargando}
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-700">Referencia o comprobante (opcional)</label>
            <input
              type="text"
              value={referencia}
              onChange={e => setReferencia(e.target.value)}
              placeholder="Ej: BNC 987654 / Banesco / Pago Móvil"
              className={inputCls}
              disabled={cargando}
            />
          </div>
        </form>

        <div className="space-y-1.5">
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-2.5 text-[11px] text-emerald-800 leading-relaxed flex items-center gap-2">
            <Check size={14} className="text-emerald-600 shrink-0" />
            <span>
              Se registrará el pago a tasa <strong>{tasaActiva.toFixed(2)} Bs/$</strong> ({nombreTasa}).
            </span>
          </div>

          <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-2.5 text-[11px] text-blue-900 leading-relaxed flex items-center gap-2">
            <Landmark size={14} className="text-blue-600 shrink-0" />
            <span>
              Se creará automáticamente un registro de <strong>Egreso en Finanzas</strong> bajo la categoría <strong>Nómina</strong>.
            </span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-slate-100">
        <button
          onClick={onClose}
          type="button"
          disabled={cargando}
          className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={confirmar}
          disabled={cargando || lineas.length === 0 || !(tasaActiva > 0)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-black shadow-md shadow-primary/20"
        >
          <Wallet size={14} />
          {cargando ? 'Guardando pago...' : `Confirmar Pago (${formatUsd(totalUsd)})`}
        </button>
      </div>
    </Modal>
  )
}
