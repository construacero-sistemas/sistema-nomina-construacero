// src/components/finanzas/TransferenciaCarterasModal.jsx
// Modal para traspaso y conversión de fondos entre carteras y cuentas de custodia
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowRight,
  ArrowRightLeft,
  Banknote,
  Building2,
  DollarSign,
  Globe,
  Loader2,
  RefreshCw,
  Smartphone,
  Sparkles,
  Wallet,
} from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'
import { useCrearMovimiento } from '../../hooks/useFinanzas.js'
import useTasaCambioNomina from '../../hooks/useTasaCambioNomina.js'
import { FORMAS_PAGO_TRANSFERENCIA_OPCIONES, getCarteraDeMetodo } from '../../constants/formasPago.js'

function formatMoney(amount) {
  return Number(amount || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function getLocalIsoDate(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export default function TransferenciaCarterasModal({ open, onClose, saldos }) {
  const crear = useCrearMovimiento()
  const { usd, eur, usdt } = useTasaCambioNomina()

  const [fecha, setFecha] = useState(() => getLocalIsoDate())
  const [origen, setOrigen] = useState('Banco en Bolívares')
  const [destino, setDestino] = useState('USDT')
  const [montoOrigen, setMontoOrigen] = useState('')
  const [tasaPersonalizada, setTasaPersonalizada] = useState('')
  const [referencia, setReferencia] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [error, setError] = useState('')

  const carteraOrigen = getCarteraDeMetodo(origen)
  const carteraDestino = getCarteraDeMetodo(destino)
  const esCrossCurrency = carteraOrigen !== carteraDestino

  // Tasa sugerida según tipo de destino
  const tasaSugerida = useMemo(() => {
    if (destino === 'USDT' || origen === 'USDT') return (usdt > 0 ? usdt : (usd > 0 ? usd : 1))
    if (destino === 'EUR' || origen === 'EUR') return (eur > 0 ? eur : 1)
    return usd > 0 ? usd : 1
  }, [destino, origen, usdt, usd, eur])

  const tasaEfectiva = Number(tasaPersonalizada) > 0 ? Number(tasaPersonalizada) : tasaSugerida
  const montoNumOrigen = Number(montoOrigen) || 0

  // Saldo disponible de la subcuenta de origen
  const saldoDisponibleOrigen = useMemo(() => {
    if (!saldos) return null
    if (carteraOrigen === 'USD') {
      return saldos.usd?.subcuentas[origen]?.saldo ?? 0
    }
    return saldos.ves?.subcuentas[origen]?.saldo ?? 0
  }, [saldos, carteraOrigen, origen])

  // Cálculo del monto recibido en destino
  const montoCalculadoDestino = useMemo(() => {
    if (!(montoNumOrigen > 0)) return 0
    if (!esCrossCurrency) return montoNumOrigen

    if (carteraOrigen === 'USD' && carteraDestino === 'VES') {
      return montoNumOrigen * tasaEfectiva
    }
    if (carteraOrigen === 'VES' && carteraDestino === 'USD') {
      return tasaEfectiva > 0 ? (montoNumOrigen / tasaEfectiva) : 0
    }
    return montoNumOrigen
  }, [montoNumOrigen, esCrossCurrency, carteraOrigen, carteraDestino, tasaEfectiva])

  const isLoading = crear.isPending

  const handleSwap = () => {
    if (isLoading) return
    const prevOrigen = origen
    const prevDestino = destino
    setOrigen(prevDestino)
    setDestino(prevOrigen)
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (origen === destino) {
      setError('La cuenta de origen y destino deben ser distintas.')
      return
    }
    if (!(montoNumOrigen > 0)) {
      setError('Ingresa un monto válido a transferir.')
      return
    }

    try {
      const ts = Date.now()
      const rand = Math.random().toString(36).slice(2, 8)

      // 1. Egreso de la Cartera Origen
      const monedaOrigen = carteraOrigen === 'USD' ? (origen === 'USDT' ? 'USDT' : 'USD') : 'VES'
      const refBase = referencia.trim() ? ` · Ref: ${referencia.trim()}` : ''
      const obsBase = observaciones.trim() || `Traspaso interno entre carteras (${origen} → ${destino})`

      await crear.mutateAsync({
        fecha,
        tipo: 'egreso',
        categoria: 'Transferencia entre carteras',
        concepto: `Traspaso a ${destino} (${carteraDestino === 'USD' ? '$' : 'Bs.'})`,
        monto: Number(montoNumOrigen.toFixed(2)),
        moneda: monedaOrigen,
        tasaVes: monedaOrigen === 'VES' ? 1 : tasaEfectiva,
        tasaUsdVes: tasaSugerida,
        fuenteTasa: monedaOrigen === 'VES' ? 'BCV' : (origen === 'USDT' ? 'USDT' : 'BCV'),
        observacionTasa: `Traspaso de fondos hacia ${destino} a tasa ${tasaEfectiva.toFixed(2)}`,
        referencia: `${origen}${refBase}`,
        observaciones: obsBase,
        idempotencyKey: `traspaso-egreso-${ts}-${rand}`,
      })

      // 2. Ingreso en la Cartera Destino
      const monedaDestino = carteraDestino === 'USD' ? (destino === 'USDT' ? 'USDT' : 'USD') : 'VES'

      await crear.mutateAsync({
        fecha,
        tipo: 'ingreso',
        categoria: 'Transferencia entre carteras',
        concepto: `Traspaso recibido desde ${origen} (${carteraOrigen === 'USD' ? '$' : 'Bs.'})`,
        monto: Number(montoCalculadoDestino.toFixed(2)),
        moneda: monedaDestino,
        tasaVes: monedaDestino === 'VES' ? 1 : tasaEfectiva,
        tasaUsdVes: tasaSugerida,
        fuenteTasa: monedaDestino === 'VES' ? 'BCV' : (destino === 'USDT' ? 'USDT' : 'BCV'),
        observacionTasa: `Traspaso recibido desde ${origen} a tasa ${tasaEfectiva.toFixed(2)}`,
        referencia: `${destino}${refBase}`,
        observaciones: obsBase,
        idempotencyKey: `traspaso-ingreso-${ts}-${rand}`,
      })

      onClose()
    } catch (err) {
      setError(err.message || 'Error al procesar el traspaso entre carteras.')
    }
  }

  return (
    <Modal
      isOpen={open}
      onClose={isLoading ? undefined : onClose}
      title="Mover o Cambiar entre Carteras"
      className="sm:max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-700">
            {error}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600">Fecha del traspaso *</label>
          <DatePicker value={fecha} onChange={setFecha} disabled={isLoading} />
        </div>

        {/* Selector Visual de Cuentas con Botón Swap (Estilo Binance / Wise) */}
        <div className="relative space-y-2.5">
          {/* Tarjeta Origen (Desde) */}
          <div className={`p-3 rounded-2xl border transition-all ${
            carteraOrigen === 'USD' ? 'bg-emerald-50/40 border-emerald-200/80' : 'bg-blue-50/40 border-blue-200/80'
          }`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                Desde (Cuenta Origen)
              </span>
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-black tracking-wide ${
                carteraOrigen === 'USD' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
              }`}>
                {carteraOrigen === 'USD' ? 'Cartera Dólares ($)' : 'Cartera Bolívares (Bs)'}
              </span>
            </div>
            <CustomSelect
              value={origen}
              onChange={setOrigen}
              options={FORMAS_PAGO_TRANSFERENCIA_OPCIONES}
              disabled={isLoading}
              showSubInTrigger={false}
            />
            {saldoDisponibleOrigen !== null && (
              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1.5 px-0.5">
                <span>
                  Saldo disponible: <strong className="text-slate-800 font-bold">{carteraOrigen === 'USD' ? '$' : 'Bs.'} {formatMoney(saldoDisponibleOrigen)}</strong>
                </span>
                {saldoDisponibleOrigen > 0 && (
                  <button
                    type="button"
                    onClick={() => setMontoOrigen(String(saldoDisponibleOrigen))}
                    className="text-[11px] font-black text-primary hover:underline cursor-pointer"
                  >
                    [Usar Máx]
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Botón Central de Inversión / Swap */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            <button
              type="button"
              onClick={handleSwap}
              disabled={isLoading}
              title="Invertir origen y destino"
              className="w-9 h-9 rounded-full bg-white border-2 border-slate-200 shadow-md flex items-center justify-center text-slate-600 hover:text-primary hover:border-primary hover:scale-110 active:scale-95 transition-all cursor-pointer"
              style={{ touchAction: 'manipulation' }}
            >
              <ArrowDownUp size={16} className="transition-transform active:rotate-180" />
            </button>
          </div>

          {/* Tarjeta Destino (Hacia) */}
          <div className={`p-3 rounded-2xl border transition-all ${
            carteraDestino === 'USD' ? 'bg-emerald-50/40 border-emerald-200/80' : 'bg-blue-50/40 border-blue-200/80'
          }`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                Hacia (Cuenta Destino)
              </span>
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-black tracking-wide ${
                carteraDestino === 'USD' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
              }`}>
                {carteraDestino === 'USD' ? 'Cartera Dólares ($)' : 'Cartera Bolívares (Bs)'}
              </span>
            </div>
            <CustomSelect
              value={destino}
              onChange={setDestino}
              options={FORMAS_PAGO_TRANSFERENCIA_OPCIONES}
              disabled={isLoading}
              showSubInTrigger={false}
            />
          </div>
        </div>

        {/* Monto y Tasa */}
        <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">
              Monto a transferir desde {origen} ({carteraOrigen === 'USD' ? '$ USD' : 'Bs. VES'}) *
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={montoOrigen}
              onChange={e => setMontoOrigen(e.target.value)}
              placeholder="0.00"
              className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-base font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
              disabled={isLoading}
              required
            />
            {saldoDisponibleOrigen !== null && montoNumOrigen > saldoDisponibleOrigen && (
              <p className="text-[11px] text-amber-600 font-bold flex items-center gap-1 mt-1">
                <AlertTriangle size={13} />
                El monto ingresado ({formatMoney(montoNumOrigen)}) supera el saldo disponible de esta cuenta ({formatMoney(saldoDisponibleOrigen)}).
              </p>
            )}
          </div>

          {/* Si es cambio de divisa, mostrar cálculo y tasa */}
          {esCrossCurrency && (
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 font-bold">Tasa aplicada (Bs/$):</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={tasaPersonalizada}
                  onChange={e => setTasaPersonalizada(e.target.value)}
                  placeholder={`Oficial: ${tasaSugerida.toFixed(2)}`}
                  className="w-32 h-8 px-2 text-right rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800"
                  disabled={isLoading}
                />
              </div>

              {montoNumOrigen > 0 && (
                <div className="flex items-center justify-between p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs">
                  <span className="text-emerald-900 font-bold flex items-center gap-1">
                    <Sparkles size={14} className="text-emerald-600" />
                    Se acreditará en {destino}:
                  </span>
                  <strong className="text-emerald-800 font-black text-sm">
                    {carteraDestino === 'USD' ? '$' : 'Bs.'} {formatMoney(montoCalculadoDestino)}
                  </strong>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Referencia y Observaciones */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600">Referencia (Opcional)</label>
            <input
              type="text"
              value={referencia}
              onChange={e => setReferencia(e.target.value)}
              placeholder="Ej: Transf. #987654"
              className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm"
              disabled={isLoading}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600">Observaciones (Opcional)</label>
            <input
              type="text"
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              placeholder="Motivo del traspaso..."
              className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm"
              disabled={isLoading}
            />
          </div>
        </div>

        {/* Botones de acción */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            Cancelar
          </button>

          <button
            type="submit"
            disabled={isLoading}
            className="px-5 py-2.5 rounded-xl bg-primary text-xs font-black text-white hover:bg-primary-hover disabled:opacity-50 inline-flex items-center gap-2 shadow-md cursor-pointer active:scale-95"
          >
            {isLoading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Procesando traspaso...
              </>
            ) : (
              <>
                <ArrowRightLeft size={14} />
                Confirmar traspaso
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}
