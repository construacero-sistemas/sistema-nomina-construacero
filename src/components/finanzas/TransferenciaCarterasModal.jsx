// src/components/finanzas/TransferenciaCarterasModal.jsx
// Modal inteligente estilo Binance para transferencias, traspasos y conversión entre cuentas registradas con saldo y límites dinámicos
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowRightLeft,
  Banknote,
  Building2,
  DollarSign,
  Globe,
  Loader2,
  Sparkles,
  Wallet,
} from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'
import { useCrearMovimiento } from '../../hooks/useFinanzas.js'
import useTasaCambioNomina from '../../hooks/useTasaCambioNomina.js'

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

function getIconoCuenta(cuenta) {
  if (!cuenta) return Wallet
  if (cuenta.tipo === 'cripto_usdt' || cuenta.moneda === 'USDT') return Globe
  if (cuenta.tipo === 'zelle') return Globe
  if (cuenta.moneda === 'VES' || cuenta.cartera === 'VES') {
    return cuenta.tipo === 'efectivo_ves' ? Banknote : Building2
  }
  return DollarSign
}

export default function TransferenciaCarterasModal({
  open,
  onClose,
  saldos,
  cuentas = [],
  cuentaInicial = null,
}) {
  const crear = useCrearMovimiento()
  const { usd, usdt } = useTasaCambioNomina()

  const [fecha, setFecha] = useState(() => getLocalIsoDate())
  const [referencia, setReferencia] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [montoOrigen, setMontoOrigen] = useState('')
  const [tasaPersonalizada, setTasaPersonalizada] = useState('')
  const [error, setError] = useState('')

  // 1. Cuentas registradas activas
  const cuentasActivas = useMemo(() => {
    return Array.isArray(cuentas) ? cuentas.filter(c => c.activo !== false) : []
  }, [cuentas])

  // 2. Cuentas elegibles para ORIGEN (solo las que tienen saldo > 0, estilo Binance)
  const cuentasConSaldo = useMemo(() => {
    return cuentasActivas.filter(c => Number(c.saldo || 0) > 0)
  }, [cuentasActivas])

  // Estado de selección de cuenta origen
  const [origenId, setOrigenId] = useState(() => {
    if (cuentaInicial?.id && Number(cuentaInicial.saldo || 0) > 0) {
      return cuentaInicial.id
    }
    return cuentasConSaldo[0]?.id || cuentasActivas[0]?.id || ''
  })

  // Cuenta origen resuelta
  const origenCuenta = useMemo(() => {
    return cuentasActivas.find(c => c.id === origenId) || cuentasConSaldo[0] || cuentasActivas[0] || null
  }, [cuentasActivas, cuentasConSaldo, origenId])

  // 3. Cuentas elegibles para DESTINO (todas las activas excepto la cuenta de origen elegida)
  const cuentasDestinoPosibles = useMemo(() => {
    return cuentasActivas.filter(c => c.id !== origenCuenta?.id)
  }, [cuentasActivas, origenCuenta])

  // Estado de selección de cuenta destino
  const [destinoId, setDestinoId] = useState(() => {
    const defaultDestino = cuentasDestinoPosibles[0]?.id || ''
    return defaultDestino
  })

  // Cuenta destino resuelta
  const destinoCuenta = useMemo(() => {
    const found = cuentasDestinoPosibles.find(c => c.id === destinoId)
    return found || cuentasDestinoPosibles[0] || null
  }, [cuentasDestinoPosibles, destinoId])

  // Datos financieros derivados
  const monedaOrigen = origenCuenta?.moneda || 'VES'
  const monedaDestino = destinoCuenta?.moneda || 'USD'
  const carteraOrigen = origenCuenta?.cartera || (monedaOrigen === 'VES' ? 'VES' : 'USD')
  const carteraDestino = destinoCuenta?.cartera || (monedaDestino === 'VES' ? 'VES' : 'USD')

  // Saldo disponible y límite estricto
  const saldoDisponibleOrigen = Number(origenCuenta?.saldo || 0)
  const montoNumOrigen = Number(montoOrigen) || 0
  const excedeLimite = montoNumOrigen > saldoDisponibleOrigen

  // Comprobar si es un intercambio cross-currency (ej. VES <-> USD / USDT)
  const esCrossCurrency = (monedaOrigen === 'VES' && monedaDestino !== 'VES') ||
                          (monedaOrigen !== 'VES' && monedaDestino === 'VES')

  // Tasa sugerida oficial
  const tasaSugerida = useMemo(() => {
    if (monedaDestino === 'USDT' || monedaOrigen === 'USDT') {
      return usdt > 0 ? usdt : (usd > 0 ? usd : 1)
    }
    return usd > 0 ? usd : 1
  }, [monedaDestino, monedaOrigen, usdt, usd])

  const tasaEfectiva = Number(tasaPersonalizada) > 0 ? Number(tasaPersonalizada) : tasaSugerida

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

  // Opciones para el dropdown DESDE (solo cuentas con saldo disponible > 0)
  const opcionesOrigen = useMemo(() => {
    const lista = cuentasConSaldo.length > 0 ? cuentasConSaldo : cuentasActivas
    return lista.map(c => {
      const Icon = getIconoCuenta(c)
      return {
        value: c.id,
        label: `${c.nombre}${c.banco ? ` · ${c.banco}` : ''}`,
        selectedLabel: c.nombre,
        sub: `Disponible: ${c.moneda === 'VES' ? 'Bs. ' : '$'}${formatMoney(c.saldo)} ${c.moneda}`,
        icon: Icon,
      }
    })
  }, [cuentasConSaldo, cuentasActivas])

  // Opciones para el dropdown HACIA (cuentas destino excluyendo origen)
  const opcionesDestino = useMemo(() => {
    return cuentasDestinoPosibles.map(c => {
      const Icon = getIconoCuenta(c)
      return {
        value: c.id,
        label: `${c.nombre}${c.banco ? ` · ${c.banco}` : ''}`,
        selectedLabel: c.nombre,
        sub: `Saldo actual: ${c.moneda === 'VES' ? 'Bs. ' : '$'}${formatMoney(c.saldo)} ${c.moneda}`,
        icon: Icon,
      }
    })
  }, [cuentasDestinoPosibles])

  const isLoading = crear.isPending
  const sinSaldoTotal = cuentasConSaldo.length === 0

  // Swap inteligente estilo Binance: solo si la cuenta destino tiene saldo > 0
  const puedeHacerSwap = Number(destinoCuenta?.saldo || 0) > 0

  const handleSwap = () => {
    if (isLoading || !puedeHacerSwap) return
    const prevOrigenId = origenId
    const prevDestinoId = destinoId
    setOrigenId(prevDestinoId)
    setDestinoId(prevOrigenId)
    setMontoOrigen('')
    setError('')
  }

  const handleUsarMax = () => {
    if (saldoDisponibleOrigen > 0) {
      setMontoOrigen(String(saldoDisponibleOrigen))
      setError('')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!origenCuenta || !destinoCuenta) {
      setError('Selecciona la cuenta de origen y destino.')
      return
    }
    if (origenCuenta.id === destinoCuenta.id) {
      setError('La cuenta de origen y destino deben ser distintas.')
      return
    }
    if (!(montoNumOrigen > 0)) {
      setError('Ingresa un monto válido a transferir.')
      return
    }
    if (excedeLimite) {
      setError(`El monto excede el saldo disponible de ${origenCuenta.nombre} (Máximo: ${formatMoney(saldoDisponibleOrigen)} ${monedaOrigen}).`)
      return
    }

    try {
      const ts = Date.now()
      const rand = Math.random().toString(36).slice(2, 8)
      const refBase = referencia.trim() ? ` · Ref: ${referencia.trim()}` : ''
      const obsBase = observaciones.trim() || `Traspaso interno (${origenCuenta.nombre} → ${destinoCuenta.nombre})`

      // 1. Egreso de la Cuenta Origen
      await crear.mutateAsync({
        fecha,
        tipo: 'egreso',
        categoria: 'Transferencia entre carteras',
        concepto: `Traspaso a ${destinoCuenta.nombre}`,
        monto: Number(montoNumOrigen.toFixed(2)),
        moneda: monedaOrigen,
        tasaVes: monedaOrigen === 'VES' ? 1 : tasaEfectiva,
        tasaUsdVes: tasaSugerida,
        fuenteTasa: monedaOrigen === 'VES' ? 'BCV' : (origenCuenta.tipo === 'cripto_usdt' ? 'USDT' : 'BCV'),
        observacionTasa: `Traspaso hacia ${destinoCuenta.nombre} a tasa ${tasaEfectiva.toFixed(2)}`,
        referencia: `${origenCuenta.nombre}${refBase}`,
        cuentaOrigen: origenCuenta.nombre,
        cuenta_id: origenCuenta.id,
        observaciones: obsBase,
        idempotencyKey: `traspaso-egreso-${ts}-${rand}`,
      })

      // 2. Ingreso en la Cuenta Destino
      await crear.mutateAsync({
        fecha,
        tipo: 'ingreso',
        categoria: 'Transferencia entre carteras',
        concepto: `Traspaso recibido desde ${origenCuenta.nombre}`,
        monto: Number(montoCalculadoDestino.toFixed(2)),
        moneda: monedaDestino,
        tasaVes: monedaDestino === 'VES' ? 1 : tasaEfectiva,
        tasaUsdVes: tasaSugerida,
        fuenteTasa: monedaDestino === 'VES' ? 'BCV' : (destinoCuenta.tipo === 'cripto_usdt' ? 'USDT' : 'BCV'),
        observacionTasa: `Traspaso recibido desde ${origenCuenta.nombre} a tasa ${tasaEfectiva.toFixed(2)}`,
        referencia: `${destinoCuenta.nombre}${refBase}`,
        cuentaOrigen: destinoCuenta.nombre,
        cuenta_id: destinoCuenta.id,
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
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-700" role="alert">
            {error}
          </div>
        )}

        {sinSaldoTotal && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-1">
            <p className="font-black flex items-center gap-1.5">
              <AlertTriangle size={15} className="text-amber-600" />
              Sin saldo disponible para transferir
            </p>
            <p className="text-[11px] text-amber-700">
              Ninguna de tus cuentas registradas tiene fondos actualmente. Para realizar traspasos o conversiones, registra primero un ingreso en alguna de tus cuentas.
            </p>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-600">Fecha del traspaso *</label>
          <DatePicker value={fecha} onChange={setFecha} disabled={isLoading} />
        </div>

        {/* Bloque Inteligente Origen / Destino con Botón Swap (Estilo Binance Convert) */}
        <div className="relative space-y-2.5">
          {/* Tarjeta Origen (Desde) */}
          <div className={`p-3.5 rounded-2xl border transition-all ${
            carteraOrigen === 'USD' ? 'bg-emerald-50/40 border-emerald-200/80' : 'bg-blue-50/40 border-blue-200/80'
          }`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                Desde (Cuenta con saldo)
              </span>
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-black tracking-wide ${
                carteraOrigen === 'USD' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
              }`}>
                {monedaOrigen}
              </span>
            </div>

            <CustomSelect
              value={origenCuenta?.id || ''}
              onChange={val => {
                setOrigenId(val)
                setMontoOrigen('')
                setError('')
              }}
              options={opcionesOrigen}
              disabled={isLoading || sinSaldoTotal}
              showSubInTrigger={false}
            />

            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1.5 px-0.5">
              <span>
                Disponible: <strong className="text-slate-800 font-bold">{monedaOrigen === 'VES' ? 'Bs. ' : '$'}{formatMoney(saldoDisponibleOrigen)} {monedaOrigen}</strong>
              </span>
              {saldoDisponibleOrigen > 0 && (
                <button
                  type="button"
                  onClick={handleUsarMax}
                  className="text-[11px] font-black text-primary hover:underline cursor-pointer"
                  title="Usar todo el saldo disponible"
                >
                  [Usar Máx]
                </button>
              )}
            </div>
          </div>

          {/* Botón Central de Inversión / Swap estilo Binance */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            <button
              type="button"
              onClick={handleSwap}
              disabled={isLoading || !puedeHacerSwap}
              title={puedeHacerSwap ? 'Invertir origen y destino' : 'La cuenta destino no tiene saldo para ser usada como origen'}
              className={`w-9 h-9 rounded-full bg-white border-2 shadow-md flex items-center justify-center transition-all ${
                puedeHacerSwap
                  ? 'border-slate-200 text-slate-600 hover:text-primary hover:border-primary hover:scale-110 active:scale-95 cursor-pointer'
                  : 'border-slate-100 text-slate-300 opacity-60 cursor-not-allowed'
              }`}
              style={{ touchAction: 'manipulation' }}
            >
              <ArrowDownUp size={16} className="transition-transform active:rotate-180" />
            </button>
          </div>

          {/* Tarjeta Destino (Hacia) */}
          <div className={`p-3.5 rounded-2xl border transition-all ${
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
                {monedaDestino}
              </span>
            </div>

            <CustomSelect
              value={destinoCuenta?.id || ''}
              onChange={val => {
                setDestinoId(val)
                setError('')
              }}
              options={opcionesDestino}
              disabled={isLoading || cuentasDestinoPosibles.length === 0}
              showSubInTrigger={false}
            />

            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1.5 px-0.5">
              <span>
                Saldo actual: <strong className="text-slate-600 font-semibold">{monedaDestino === 'VES' ? 'Bs. ' : '$'}{formatMoney(destinoCuenta?.saldo || 0)} {monedaDestino}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Bloque de Monto y Límite Dinámico Estilo Binance */}
        <div className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700">
                Monto a transferir desde {origenCuenta?.nombre || 'origen'} *
              </label>
              <span className="text-[11px] text-slate-400 font-semibold">
                Límite: {formatMoney(saldoDisponibleOrigen)} {monedaOrigen}
              </span>
            </div>

            <div className="relative">
              <input
                type="number"
                min="0.01"
                max={saldoDisponibleOrigen > 0 ? saldoDisponibleOrigen : undefined}
                step="0.01"
                inputMode="decimal"
                value={montoOrigen}
                onChange={e => {
                  setMontoOrigen(e.target.value)
                  setError('')
                }}
                placeholder="0.00"
                className={`w-full h-11 pl-3.5 pr-24 rounded-xl border bg-white text-base font-black text-slate-900 focus:outline-none focus:ring-2 focus:border-primary disabled:opacity-50 ${
                  excedeLimite
                    ? 'border-rose-500 focus:ring-rose-200'
                    : 'border-slate-200 focus:ring-primary/20'
                }`}
                disabled={isLoading || sinSaldoTotal}
                required
              />

              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                <span className="text-xs font-black text-slate-400">
                  {monedaOrigen}
                </span>
                {saldoDisponibleOrigen > 0 && (
                  <button
                    type="button"
                    onClick={handleUsarMax}
                    className="px-2 py-1 rounded-lg bg-primary/10 text-primary text-[10px] font-black hover:bg-primary/20 transition-colors cursor-pointer"
                  >
                    MÁX
                  </button>
                )}
              </div>
            </div>

            {excedeLimite && (
              <p className="text-[11px] text-rose-600 font-bold flex items-center gap-1 mt-1">
                <AlertTriangle size={13} />
                El monto excede el saldo disponible de esta cuenta (Máximo: {formatMoney(saldoDisponibleOrigen)} {monedaOrigen}).
              </p>
            )}
          </div>

          {/* Conversión en tiempo real (Binance Convert Style) */}
          {esCrossCurrency ? (
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

              {montoNumOrigen > 0 && !excedeLimite && (
                <div className="flex items-center justify-between p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs">
                  <span className="text-emerald-900 font-bold flex items-center gap-1">
                    <Sparkles size={14} className="text-emerald-600" />
                    Recibes en {destinoCuenta?.nombre}:
                  </span>
                  <strong className="text-emerald-800 font-black text-sm">
                    {monedaDestino === 'VES' ? 'Bs. ' : '$'}{formatMoney(montoCalculadoDestino)} {monedaDestino}
                  </strong>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 font-medium pt-1">
              Traspaso 1:1 directo entre cuentas de la misma divisa ({monedaOrigen}).
            </div>
          )}
        </div>

        {/* Referencia y Observaciones */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-600">N° Comprobante / Referencia (Opcional)</label>
            <input
              type="text"
              value={referencia}
              onChange={e => setReferencia(e.target.value)}
              placeholder="Ej: Transf. #987654"
              className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium"
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
              className="w-full h-11 px-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium"
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
            className="px-4 py-2.5 min-h-11 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            Cancelar
          </button>

          <button
            type="submit"
            disabled={isLoading || sinSaldoTotal || excedeLimite || montoNumOrigen <= 0}
            className="px-5 py-2.5 min-h-11 rounded-xl bg-primary text-xs font-black text-white hover:bg-primary-hover disabled:opacity-50 inline-flex items-center gap-2 shadow-md cursor-pointer active:scale-95"
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
