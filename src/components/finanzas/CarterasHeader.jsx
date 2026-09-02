// src/components/finanzas/CarterasHeader.jsx
// Panel maestro de visualización de Carteras Financieras (USD & Bolívares) en tiempo real
import { useMemo } from 'react'
import {
  ArrowDownRight,
  ArrowRightLeft,
  ArrowUpRight,
  Banknote,
  Building2,
  DollarSign,
  Eye,
  Globe,
  Inbox,
  Wallet,
} from 'lucide-react'

function formatMoney(amount) {
  return Number(amount || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function CarterasHeader({
  saldos,
  filtroCartera,
  sinCuenta,
  desglosePorCuenta = [],
  onReasignarSinCuenta,
  onSelectCartera,
  onOpenTransferencia,
  onSelectSubcuenta,
}) {
  const usd = saldos?.usd
  const ves = saldos?.ves

  const handleSubcuentaClick = (e, subcuentaData, carteraId) => {
    e.stopPropagation()
    if (onSelectSubcuenta) {
      onSelectSubcuenta({
        ...subcuentaData,
        carteraId,
      })
    }
  }

  return (
    <div className="space-y-3">
      {/* Barra superior de patrimonio y acción de traspaso */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center font-black shadow-xs">
            <Wallet size={16} />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <span>Saldos de Tesorería por Cartera</span>
              {filtroCartera && (
                <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-bold">
                  Filtrando: {filtroCartera === 'USD' ? 'Cartera USD' : 'Cartera Bs'}
                </span>
              )}
            </h2>
            <p className="text-[11px] text-slate-400">
              Patrimonio total estimado: <strong className="text-slate-700 font-bold">${formatMoney(saldos?.patrimonioTotalUsd)} USD</strong>
            </p>
            {sinCuenta && sinCuenta.sinCuenta > 0 && (
              <button
                type="button"
                onClick={onReasignarSinCuenta}
                className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold hover:bg-amber-100 transition-colors"
                title="Asignar estas cuentas"
              >
                <Inbox size={10} />
                {sinCuenta.sinCuenta}/{sinCuenta.total} movimientos sin cuenta asignada
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenTransferencia}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer"
          style={{ touchAction: 'manipulation' }}
        >
          <ArrowRightLeft size={14} className="text-primary" />
          <span>Mover / Cambiar entre carteras</span>
        </button>
      </div>

      {/* Grid de 2 Carteras Maestras */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {/* 1. CARTERA EN DÓLARES */}
        <div
          onClick={() => onSelectCartera(filtroCartera === 'USD' ? '' : 'USD')}
          className={`cursor-pointer rounded-2xl border p-4 transition-all ${
            filtroCartera === 'USD'
              ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/20 shadow-md'
              : 'border-slate-200 bg-white hover:border-emerald-200 hover:shadow-xs'
          }`}
        >
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-sm">
                <DollarSign size={20} />
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">
                  Cartera en Dólares
                </span>
                <span className="text-2xl font-black text-slate-900">
                  ${formatMoney(usd?.totalUsd)}{' '}
                  <span className="text-xs font-bold text-slate-400">USD</span>
                </span>
              </div>
            </div>

            <div className="text-right text-[11px] text-slate-400">
              <span>≈ Bs. {formatMoney(usd?.totalEquivVes)}</span>
            </div>
          </div>

          {/* Subcuentas de Cartera USD (Clicables para ver detalle) */}
          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100">
            {/* Efectivo $ */}
            <div
              onClick={e => handleSubcuentaClick(e, usd?.subcuentas['Efectivo $'], 'USD')}
              className="p-2 rounded-xl bg-slate-50 border border-slate-100 hover:border-emerald-300 hover:bg-emerald-50/50 transition-all cursor-pointer group"
              title="Clic para ver detalle de Efectivo $"
            >
              <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-slate-500 truncate mb-0.5">
                <span className="flex items-center gap-1 truncate">
                  <DollarSign size={11} className="text-emerald-600 shrink-0" />
                  <span>Efectivo $</span>
                </span>
                <Eye size={10} className="text-slate-300 group-hover:text-emerald-600 shrink-0 transition-colors" />
              </div>
              <span className="text-xs font-black text-slate-800 block truncate">
                ${formatMoney(usd?.subcuentas['Efectivo $']?.saldo)}
              </span>
            </div>

            {/* Zelle */}
            <div
              onClick={e => handleSubcuentaClick(e, usd?.subcuentas['Zelle'], 'USD')}
              className="p-2 rounded-xl bg-slate-50 border border-slate-100 hover:border-purple-300 hover:bg-purple-50/50 transition-all cursor-pointer group"
              title="Clic para ver detalle de Zelle"
            >
              <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-slate-500 truncate mb-0.5">
                <span className="flex items-center gap-1 truncate">
                  <Globe size={11} className="text-purple-600 shrink-0" />
                  <span>Zelle</span>
                </span>
                <Eye size={10} className="text-slate-300 group-hover:text-purple-600 shrink-0 transition-colors" />
              </div>
              <span className="text-xs font-black text-slate-800 block truncate">
                ${formatMoney(usd?.subcuentas['Zelle']?.saldo)}
              </span>
            </div>

            {/* USDT */}
            <div
              onClick={e => handleSubcuentaClick(e, usd?.subcuentas['USDT'], 'USD')}
              className="p-2 rounded-xl bg-slate-50 border border-slate-100 hover:border-cyan-300 hover:bg-cyan-50/50 transition-all cursor-pointer group"
              title="Clic para ver detalle de USDT (Binance)"
            >
              <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-slate-500 truncate mb-0.5">
                <span className="flex items-center gap-1 truncate">
                  <Globe size={11} className="text-cyan-600 shrink-0" />
                  <span>USDT</span>
                </span>
                <Eye size={10} className="text-slate-300 group-hover:text-cyan-600 shrink-0 transition-colors" />
              </div>
              <span className="text-xs font-black text-slate-800 block truncate">
                ${formatMoney(usd?.subcuentas['USDT']?.saldo)}
              </span>
            </div>
          </div>

          {/* Entradas y Salidas */}
          <div className="flex items-center justify-between text-[11px] pt-2.5 mt-2 text-slate-500">
            <span className="flex items-center gap-1 text-emerald-700 font-bold">
              <ArrowDownRight size={13} /> Entradas: ${formatMoney(usd?.ingresosUsd)}
            </span>
            <span className="flex items-center gap-1 text-rose-700 font-bold">
              <ArrowUpRight size={13} /> Salidas: ${formatMoney(usd?.egresosUsd)}
            </span>
          </div>
        </div>

        {/* 2. CARTERA EN BOLÍVARES */}
        <div
          onClick={() => onSelectCartera(filtroCartera === 'VES' ? '' : 'VES')}
          className={`cursor-pointer rounded-2xl border p-4 transition-all ${
            filtroCartera === 'VES'
              ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20 shadow-md'
              : 'border-slate-200 bg-white hover:border-blue-200 hover:shadow-xs'
          }`}
        >
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
                <Building2 size={20} />
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 block">
                  Cartera en Bolívares
                </span>
                <span className="text-2xl font-black text-slate-900">
                  Bs. {formatMoney(ves?.totalVes)}{' '}
                  <span className="text-xs font-bold text-slate-400">VES</span>
                </span>
              </div>
            </div>

            <div className="text-right text-[11px] text-slate-400 font-bold">
              <span>≈ ${formatMoney(ves?.totalEquivUsd)} USD</span>
            </div>
          </div>

          {/* Cuentas Reales de Custodia de Cartera Bolívares (Clicables para ver detalle) */}
          <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-slate-100">
            {/* Efectivo Bs */}
            <div
              onClick={e => handleSubcuentaClick(e, ves?.subcuentas['Efectivo Bs'], 'VES')}
              className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 hover:border-emerald-300 hover:bg-emerald-50/50 transition-all cursor-pointer group"
              title="Clic para ver detalle de Caja Efectivo Bs"
            >
              <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-slate-500 truncate mb-0.5">
                <span className="flex items-center gap-1 truncate">
                  <Banknote size={12} className="text-emerald-600 shrink-0" />
                  <span>Caja Efectivo Bs</span>
                </span>
                <Eye size={11} className="text-slate-300 group-hover:text-emerald-600 shrink-0 transition-colors" />
              </div>
              <span className="text-sm font-black text-slate-800 block truncate">
                Bs. {formatMoney(ves?.subcuentas['Efectivo Bs']?.saldo)}
              </span>
            </div>

            {/* Banco en Bolívares (Cuentas Bancarias Disponibles) */}
            <div
              onClick={e => handleSubcuentaClick(e, ves?.subcuentas['Banco en Bolívares'], 'VES')}
              className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 hover:border-blue-300 hover:bg-blue-50/50 transition-all cursor-pointer group"
              title="Clic para ver desglose de Banco en Bolívares (Punto de Venta, Pago Móvil, etc.)"
            >
              <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-slate-500 truncate mb-0.5">
                <span className="flex items-center gap-1 truncate">
                  <Building2 size={12} className="text-blue-600 shrink-0" />
                  <span>Banco en Bolívares</span>
                </span>
                <Eye size={11} className="text-slate-300 group-hover:text-blue-600 shrink-0 transition-colors" />
              </div>
              <span className="text-sm font-black text-slate-800 block truncate">
                Bs. {formatMoney(ves?.subcuentas['Banco en Bolívares']?.saldo)}
              </span>
            </div>
          </div>

          {/* Entradas y Salidas */}
          <div className="flex items-center justify-between text-[11px] pt-2.5 mt-2 text-slate-500">
            <span className="flex items-center gap-1 text-emerald-700 font-bold">
              <ArrowDownRight size={13} /> Entradas: Bs. {formatMoney(ves?.ingresosVes)}
            </span>
            <span className="flex items-center gap-1 text-rose-700 font-bold">
              <ArrowUpRight size={13} /> Salidas: Bs. {formatMoney(ves?.egresosVes)}
            </span>
          </div>
        </div>
      </div>

      {/* Desglose por cuenta de custodia (asignación explícita, sin doble conteo) */}
      {desglosePorCuenta.length > 0 && (
        <section aria-label="Desglose por cuenta" className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-xs font-black text-slate-700 mb-0.5">Desglose por cuenta</h3>
          <p className="text-[11px] text-slate-400 mb-2.5">
            Suma de entradas, salidas y saldo de cada cuenta de custodia registrada.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {desglosePorCuenta.map(cuenta => {
              const esVes = (cuenta.moneda || '').toUpperCase() === 'VES'
              const tieneSaldo = Number(cuenta.saldo) !== 0
              return (
                <button
                  key={cuenta.id}
                  type="button"
                  onClick={() => onSelectSubcuenta(cuenta)}
                  className="text-left p-2.5 rounded-xl bg-slate-50 border border-slate-100 hover:border-primary/40 hover:bg-primary/5 transition-all group min-w-0"
                >
                  <div className="flex items-center justify-between gap-1.5 mb-1">
                    <span className="text-[11px] font-bold text-slate-600 truncate">
                      {cuenta.nombre}{cuenta.banco ? ` · ${cuenta.banco}` : ''}
                    </span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-black ${esVes ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {esVes ? 'Bs' : 'USD'}
                    </span>
                  </div>
                  <span className="block text-sm font-black text-slate-800 truncate">
                    {esVes ? 'Bs. ' : '$'}{formatMoney(cuenta.saldo)}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2.5 text-[10px] font-bold">
                    <span className="text-emerald-600 flex items-center gap-0.5">
                      <ArrowDownRight size={10} /> {formatMoney(cuenta.entradas)}
                    </span>
                    <span className="text-rose-600 flex items-center gap-0.5">
                      <ArrowUpRight size={10} /> {formatMoney(cuenta.salidas)}
                    </span>
                    {!tieneSaldo && <span className="text-slate-300">sin movimientos</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
