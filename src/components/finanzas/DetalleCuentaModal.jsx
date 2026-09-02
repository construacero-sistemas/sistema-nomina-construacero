// src/components/finanzas/DetalleCuentaModal.jsx
// Modal de inspección detallada de cuentas de custodia financiera
import { useMemo } from 'react'
import {
  ArrowDownRight,
  ArrowRightLeft,
  ArrowUpRight,
  Banknote,
  Building2,
  CreditCard,
  DollarSign,
  Smartphone,
  Sparkles,
} from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { asignarMovimientoACuenta, clasificarMovimientoEnCartera } from '../../utils/carterasHelper.js'

function formatMoney(amount) {
  return Number(amount || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function DetalleCuentaModal({
  open,
  onClose,
  cuenta,
  movimientos = [],
  cuentas = [],
  tasaBcv = 1,
  onOpenTransferencia,
}) {
  const esVes = cuenta?.moneda === 'VES' || cuenta?.carteraId === 'VES'
  const tasa = Number(tasaBcv) > 0 ? Number(tasaBcv) : 1

  // Filtrar los movimientos que corresponden a esta vista del detalle.
  // - Si es una cuenta de custodia concreta (id real), se filtran por ASIGNACIÓN EXPLÍCITA
  //   (cuenta_origen coincide con esta cuenta), sin doble conteo.
  // - Si es una subcuenta lógica (ej. 'Banco en Bolívares'), se agrupan por subcuentaId,
  //   que es el nivel que contabiliza todo el dinero.
  const movimientosCuenta = useMemo(() => {
    if (!cuenta) return []
    // Una cuenta de custodia real tiene un id que no es el de una subcuenta lógica.
    const esSubcuentaLogica = ['Efectivo $', 'Zelle', 'USDT', 'Efectivo Bs', 'Banco en Bolívares'].includes(cuenta.id)
    return movimientos.filter(mov => {
      if (mov.estado === 'anulado') return false
      const { subcuentaId } = clasificarMovimientoEnCartera(mov)
      if (esSubcuentaLogica) {
        return subcuentaId === cuenta.id
      }
      // Cuenta de custodia real: asignación explícita contra las cuentas registradas.
      return subcuentaId === cuenta.subcuentaId || Boolean(asignarMovimientoACuenta(mov, cuentas))
    })
  }, [movimientos, cuenta, cuentas])

  // Desglose por canales/orígenes de fondos (útil para Banco en Bolívares)
  const desgloseCanales = useMemo(() => {
    if (!cuenta || (cuenta.id !== 'Banco en Bolívares' && cuenta.nombre !== 'Banco en Bolívares')) return null

    const canales = {
      'Punto de Venta': { nombre: 'Punto de Venta', icon: CreditCard, color: 'text-teal-600', bg: 'bg-teal-50', entradas: 0, salidas: 0 },
      'Pago Móvil':     { nombre: 'Pago Móvil',     icon: Smartphone, color: 'text-indigo-600', bg: 'bg-indigo-50', entradas: 0, salidas: 0 },
      'Transferencia':  { nombre: 'Transferencias', icon: Building2,  color: 'text-blue-600', bg: 'bg-blue-50', entradas: 0, salidas: 0 },
    }

    for (const mov of movimientosCuenta) {
      const ref = String(mov.referencia || '').toLowerCase()
      const concepto = String(mov.concepto || '').toLowerCase()
      const monto = Number(mov.monto_ves) || Number(mov.monto) || 0
      const esIngreso = mov.tipo === 'ingreso'

      let canalKey = 'Transferencia'
      if (ref.includes('punto') || concepto.includes('punto')) {
        canalKey = 'Punto de Venta'
      } else if (ref.includes('móvil') || ref.includes('movil') || concepto.includes('móvil') || concepto.includes('movil')) {
        canalKey = 'Pago Móvil'
      }

      if (esIngreso) {
        canales[canalKey].entradas += monto
      } else {
        canales[canalKey].salidas += monto
      }
    }

    return Object.values(canales).map(c => ({
      ...c,
      neto: c.entradas - c.salidas,
    }))
  }, [movimientosCuenta, cuenta])

  // Equivalencia en la otra divisa
  const saldoEquivalente = useMemo(() => {
    if (!cuenta) return 0
    const s = Number(cuenta.saldo) || 0
    if (esVes) {
      return (s / tasa)
    }
    return (s * tasa)
  }, [cuenta, esVes, tasa])

  if (!cuenta) return null

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Detalle de Cuenta de Custodia"
      className="sm:max-w-xl"
    >
      <div className="space-y-4">
        {/* Encabezado Hero de la Cuenta */}
        <div className={`p-4 rounded-2xl border ${
          esVes ? 'bg-blue-50/50 border-blue-200' : 'bg-emerald-50/50 border-emerald-200'
        }`}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2.5">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-sm ${
                esVes ? 'bg-blue-600' : 'bg-emerald-600'
              }`}>
                {esVes ? <Building2 size={20} /> : <DollarSign size={20} />}
              </div>
              <div>
                <span className={`text-[10px] font-black uppercase tracking-wider block ${
                  esVes ? 'text-blue-700' : 'text-emerald-700'
                }`}>
                  {esVes ? 'Cartera en Bolívares (VES)' : 'Cartera en Dólares (USD)'}
                </span>
                <h3 className="text-base font-black text-slate-900">
                  {cuenta.nombre || cuenta.id}
                </h3>
              </div>
            </div>

            <span className={`px-2.5 py-1 rounded-xl text-xs font-black shadow-xs ${
              esVes ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'
            }`}>
              {cuenta.moneda}
            </span>
          </div>

          {/* Saldo Principal */}
          <div className="flex flex-wrap items-baseline justify-between gap-2 pt-2 border-t border-slate-200/80">
            <div>
              <span className="text-[11px] font-bold text-slate-500 block">Saldo disponible actual</span>
              <span className="text-2xl font-black text-slate-900">
                {esVes ? 'Bs. ' : '$'}{formatMoney(cuenta.saldo)}{' '}
                <span className="text-xs font-bold text-slate-400">{cuenta.moneda}</span>
              </span>
            </div>

            <div className="text-right text-xs font-bold text-slate-500">
              <span className="flex items-center gap-1 text-slate-600 font-bold">
                <Sparkles size={13} className="text-amber-500" />
                ≈ {esVes ? `$${formatMoney(saldoEquivalente)} USD` : `Bs. ${formatMoney(saldoEquivalente)} VES`}
              </span>
              <span className="text-[10px] text-slate-400 font-normal">Tasa oficial: {formatMoney(tasa)} Bs/$</span>
            </div>
          </div>
        </div>

        {/* Desglose por Canales (si aplica, p.ej. Banco en Bolívares) */}
        {desgloseCanales && (
          <div className="space-y-2">
            <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider px-1">
              Desglose de Fondos por Canal de Ingreso
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {desgloseCanales.map(canal => {
                const Icon = canal.icon
                return (
                  <div key={canal.nombre} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600 mb-1">
                      <div className={`p-1 rounded-lg ${canal.bg} ${canal.color}`}>
                        <Icon size={13} />
                      </div>
                      <span className="truncate">{canal.nombre}</span>
                    </div>
                    <span className="text-sm font-black text-slate-800 block truncate">
                      Bs. {formatMoney(canal.neto)}
                    </span>
                    <span className="text-[10px] text-emerald-600 font-bold block truncate">
                      +{formatMoney(canal.entradas)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Resumen de Flujo de la Cuenta */}
        <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shrink-0">
              <ArrowDownRight size={15} />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] text-slate-400 font-bold block uppercase">Entradas</span>
              <strong className="text-emerald-700 font-black break-words">
                {esVes ? 'Bs. ' : '$'}{formatMoney(cuenta.ingresos)}
              </strong>
            </div>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center font-bold shrink-0">
              <ArrowUpRight size={15} />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] text-slate-400 font-bold block uppercase">Salidas</span>
              <strong className="text-rose-700 font-black break-words">
                {esVes ? 'Bs. ' : '$'}{formatMoney(cuenta.egresos)}
              </strong>
            </div>
          </div>
        </div>

        {/* Últimos Movimientos Registrados en esta Cuenta */}
        <div className="space-y-2">
          <h4 className="text-xs font-black text-slate-700 uppercase tracking-wider px-1 flex items-center justify-between">
            <span>Últimos Movimientos de esta Cuenta</span>
            <span className="text-[10px] text-slate-400 font-bold font-mono">
              {movimientosCuenta.length} registros
            </span>
          </h4>

          <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
            {movimientosCuenta.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400 font-medium">
                No hay movimientos registrados para esta cuenta en el período consultado.
              </div>
            ) : (
              movimientosCuenta.slice(0, 10).map(mov => {
                const esIngreso = mov.tipo === 'ingreso'
                return (
                  <div key={mov.id} className="p-2.5 flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{mov.concepto}</p>
                      <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
                        <span>{mov.fecha}</span>
                        {mov.referencia && <span>· {mov.referencia}</span>}
                      </p>
                    </div>

                    <span className={`text-xs font-black shrink-0 ${
                      esIngreso ? 'text-emerald-700' : 'text-rose-700'
                    }`}>
                      {esIngreso ? '+' : '-'}{esVes ? 'Bs. ' : '$'}{formatMoney(mov.monto)}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Acciones del Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onOpenTransferencia}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95"
            style={{ touchAction: 'manipulation' }}
          >
            <ArrowRightLeft size={14} className="text-primary" />
            <span>Mover fondos desde esta cuenta</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-900 text-xs font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  )
}
