import { ArrowRightLeft, Building2, DollarSign, Eye, Inbox, Wallet } from 'lucide-react'
const money = n => n == null || !Number.isFinite(Number(n)) ? 'Sin confirmar' : Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CarterasHeader({ saldos, filtroCartera, sinCuenta, onPreviewConciliacion, onSelectCartera, onOpenTransferencia,
  loading = false, error = '', conciliacionPendiente = false, onRetry }) {
  return <section aria-label="Saldos de tesorería" className="space-y-3">
    <div className="flex flex-wrap justify-between items-center gap-3">
      <h2 className="text-base font-black text-slate-800 inline-flex items-center gap-2"><Wallet size={20} aria-hidden="true" />Saldos de Tesorería por Cartera</h2>
      <button type="button" onClick={onOpenTransferencia} disabled={!saldos || loading || !!error || conciliacionPendiente}
        className="min-h-11 px-3 py-2 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white font-bold text-sm disabled:opacity-60"><ArrowRightLeft size={18} />Mover / Cambiar entre carteras</button>
    </div>
    {(loading || error || conciliacionPendiente || !saldos) && <div role={error ? 'alert' : 'status'} className="p-4 rounded-2xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">
      <p>{loading ? 'Consultando saldos del libro completo...' : error || (conciliacionPendiente ? 'Hay partidas históricas pendientes de conciliar. Los importes no se presentan como fondos disponibles.' : 'Los saldos todavía no están confirmados.')}</p>
      {onRetry && !loading && <button type="button" onClick={onRetry} className="min-h-11 mt-2 px-3 py-2 border border-amber-400 rounded-xl font-bold">Actualizar saldos</button>}
    </div>}
    {saldos && !error && !loading && <>
      <p className="text-sm text-slate-700">Valoración contable en USD: <strong>{saldos.patrimonioTotalUsd == null ? 'Pendiente de tasas' : `$${money(saldos.patrimonioTotalUsd)} USD`}</strong>. Tasas guardadas en cada movimiento; independiente del filtro del historial.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[{ id: 'USD', title: 'Cartera en Dólares', icon: DollarSign, principal: saldos.usd?.totalUsd == null ? 'Valoración pendiente' : `$${money(saldos.usd.totalUsd)} USD`, sub: 'Incluye USDT valorado solo con su tasa registrada.' },
          { id: 'VES', title: 'Cartera en Bolívares', icon: Building2, principal: saldos.ves?.totalEquivUsd == null ? 'Equivalencia USD pendiente' : `$${money(saldos.ves.totalEquivUsd)} USD estimados`, sub: `Saldo nativo: Bs. ${money(saldos.ves?.totalVes)}. Equivalencia según tasa de consulta.` }].map(item => <button key={item.id} type="button" onClick={() => onSelectCartera?.(filtroCartera === item.id ? '' : item.id)} aria-pressed={filtroCartera === item.id}
          className={`min-h-11 text-left rounded-2xl border p-4 min-w-0 ${filtroCartera === item.id ? 'border-primary bg-blue-50' : 'border-slate-200 bg-white'}`}>
          <span className="flex items-center gap-2 text-sm font-bold text-slate-700"><item.icon size={20} aria-hidden="true" />{item.title}</span>
          <strong className="block text-xl text-slate-900 mt-2 break-words">{item.principal}</strong>
          <span className="block text-xs text-slate-600 mt-2">{item.sub}</span>
        </button>)}
      </div>
    </>}
    {(sinCuenta?.sinCuenta > 0 || conciliacionPendiente) && <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onPreviewConciliacion} className="min-h-11 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-sm inline-flex gap-2 items-center font-bold"><Eye size={18} />Simular conciliación segura</button>
      {sinCuenta?.sinCuenta > 0 && <span className="min-h-11 px-3 py-2 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-sm inline-flex gap-2 items-center"><Inbox size={18} />{sinCuenta.sinCuenta} sin cuenta en {sinCuenta.total} cargados{sinCuenta.totalServidor != null ? ` · período: ${sinCuenta.totalServidor}` : ''}</span>}
    </div>}
  </section>
}
