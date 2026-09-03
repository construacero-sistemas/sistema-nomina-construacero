// src/components/finanzas/CarterasHeader.jsx
// Panel maestro de visualización macro de Carteras Financieras (USD & Bolívares) en tiempo real
import {
  ArrowDownRight,
  ArrowRightLeft,
  ArrowUpRight,
  Building2,
  DollarSign,
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
  onReasignarSinCuenta,
  onSelectCartera,
  onOpenTransferencia,
}) {
  const usd = saldos?.usd
  const ves = saldos?.ves

  return (
    <div className="space-y-3">
      {/* Barra superior de patrimonio y acción de traspaso */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center font-black shadow-xs shrink-0">
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
                className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold hover:bg-amber-100 transition-colors cursor-pointer"
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
          className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-11 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer"
          style={{ touchAction: 'manipulation' }}
        >
          <ArrowRightLeft size={14} className="text-primary" />
          <span>Mover / Cambiar entre carteras</span>
        </button>
      </div>

      {/* Grid de 2 Fichas Maestras de Cartera (Sin redundancias internas) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {/* 1. CARTERA EN DÓLARES */}
        <div
          onClick={() => onSelectCartera(filtroCartera === 'USD' ? '' : 'USD')}
          className={`cursor-pointer rounded-2xl border p-4 transition-all flex flex-col justify-between ${
            filtroCartera === 'USD'
              ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/20 shadow-md'
              : 'border-slate-200 bg-white hover:border-emerald-200 hover:shadow-xs'
          }`}
          title="Clic para filtrar movimientos por Cartera en Dólares"
        >
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-sm shrink-0">
                <DollarSign size={20} />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">
                  Cartera en Dólares
                </span>
                <span className="text-2xl font-black text-slate-900 block truncate">
                  ${formatMoney(usd?.totalUsd)}{' '}
                  <span className="text-xs font-bold text-slate-400">USD</span>
                </span>
              </div>
            </div>

            <div className="text-right text-[11px] text-slate-400 shrink-0">
              <span className="font-semibold">≈ Bs. {formatMoney(usd?.totalEquivVes)}</span>
            </div>
          </div>

          {/* Entradas y Salidas de la Cartera USD */}
          <div className="flex items-center justify-between text-[11px] pt-3 border-t border-slate-100 text-slate-500">
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
          className={`cursor-pointer rounded-2xl border p-4 transition-all flex flex-col justify-between ${
            filtroCartera === 'VES'
              ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20 shadow-md'
              : 'border-slate-200 bg-white hover:border-blue-200 hover:shadow-xs'
          }`}
          title="Clic para filtrar movimientos por Cartera en Bolívares"
        >
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
                <Building2 size={20} />
              </div>
              <div className="min-w-0">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700 block">
                  Cartera en Bolívares
                </span>
                <span className="text-2xl font-black text-slate-900 block truncate">
                  Bs. {formatMoney(ves?.totalVes)}{' '}
                  <span className="text-xs font-bold text-slate-400">VES</span>
                </span>
              </div>
            </div>

            <div className="text-right text-[11px] text-slate-400 font-bold shrink-0">
              <span>≈ ${formatMoney(ves?.totalEquivUsd)} USD</span>
            </div>
          </div>

          {/* Entradas y Salidas de la Cartera VES */}
          <div className="flex items-center justify-between text-[11px] pt-3 border-t border-slate-100 text-slate-500">
            <span className="flex items-center gap-1 text-emerald-700 font-bold">
              <ArrowDownRight size={13} /> Entradas: Bs. {formatMoney(ves?.ingresosVes)}
            </span>
            <span className="flex items-center gap-1 text-rose-700 font-bold">
              <ArrowUpRight size={13} /> Salidas: Bs. {formatMoney(ves?.egresosVes)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
