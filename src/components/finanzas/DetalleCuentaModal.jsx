import { useMemo, useState } from 'react'
import { ArrowRightLeft, Wallet } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { asignarMovimientoACuenta, clasificarMovimientoEnCartera } from '../../utils/carterasHelper.js'

const valid = value => value != null && Number.isFinite(Number(value))
const money = value => valid(value) ? Number(value).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Sin confirmar'
const LOGICAL = ['Efectivo $', 'Zelle', 'USDT', 'Efectivo Bs', 'Banco en Bolívares']

export default function DetalleCuentaModal({ open, onClose, cuenta, movimientos = [], cuentas = [], tasaBcv = 0,
  onOpenTransferencia, hasMore = false, onLoadMore, isLoadingMore = false, errorCarga = '' }) {
  const [pagina, setPagina] = useState(1)
  const rows = useMemo(() => movimientos.filter(m => {
    if (!cuenta || m.estado === 'anulado') return false
    if (LOGICAL.includes(cuenta.id)) return clasificarMovimientoEnCartera(m).subcuentaId === cuenta.id
    return asignarMovimientoACuenta(m, cuentas)?.id === cuenta.id
  }), [movimientos, cuenta, cuentas])
  const pages = Math.max(1, Math.ceil(rows.length / 10))
  const page = Math.min(pagina, pages)
  const flujo = useMemo(() => {
    const validRows = rows.every(m => valid(m.monto) && m.moneda === cuenta?.moneda)
    if (!validRows || errorCarga) return null
    return rows.reduce((a, m) => { a[m.tipo === 'ingreso' ? 'entradas' : 'salidas'] += Number(m.monto); return a }, { entradas: 0, salidas: 0 })
  }, [rows, cuenta, errorCarga])
  if (!cuenta) return null
  const confirmed = cuenta.saldoConfirmado === true && valid(cuenta.saldo)
  const usdValue = confirmed && cuenta.moneda === 'USD' ? Number(cuenta.saldo)
    : confirmed && cuenta.valoracionCompleta && valid(cuenta.valorUsd) ? Number(cuenta.valorUsd) : null
  const ref = confirmed && cuenta.moneda === 'VES' && Number(tasaBcv) > 0 ? Number(cuenta.saldo) / Number(tasaBcv) : null
  const available = confirmed && cuenta.disponible === true
  return <Modal isOpen={open} onClose={onClose} title="Detalle de Cuenta de Custodia" className="sm:max-w-xl"
    footer={<><button type="button" onClick={onClose} className="min-h-11 px-4 py-2 rounded-xl border border-slate-300">Cerrar</button>
      <button type="button" disabled={!available || !onOpenTransferencia} onClick={onOpenTransferencia} className="min-h-11 px-4 py-2 rounded-xl bg-primary text-white font-bold inline-flex gap-2 items-center disabled:opacity-50"><ArrowRightLeft size={18} />Mover fondos desde esta cuenta</button></>}>
    <div className="space-y-4">
      <section aria-label="Saldo de la cuenta" className="p-4 rounded-2xl border border-slate-200 bg-slate-50 space-y-2">
        <h4 className="font-bold text-slate-900 flex items-center gap-2"><Wallet size={20} />{cuenta.nombre || cuenta.id}</h4>
        <p className="text-sm text-slate-700">{available ? 'Saldo confirmado disponible' : confirmed ? 'Saldo contable; no disponible para transferir' : 'Saldo pendiente de confirmar'}</p>
        <p className="text-xl font-black text-slate-900 break-words">{usdValue == null ? 'Valoración USD pendiente' : `$${money(usdValue)} USD`}</p>
        <p className="text-sm text-slate-700">Saldo nativo: <strong>{confirmed ? `${money(cuenta.saldo)} ${cuenta.moneda}` : 'Sin confirmar'}</strong></p>
        {ref != null && <p className="text-xs text-slate-600">Referencia de consulta: ${money(ref)} USD a {money(tasaBcv)} Bs/USD. No sustituye la valoración contable histórica.</p>}
        {!available && <p role="status" className="text-sm text-amber-900">Confirma el saldo y resuelve las partidas pendientes antes de mover fondos.</p>}
      </section>
      <section aria-label="Flujo de registros cargados" className="p-3 rounded-xl border border-slate-200 text-sm text-slate-700 space-y-1">
        <h4 className="font-bold">Flujo de registros cargados</h4>
        <p>Entradas: {flujo ? `${money(flujo.entradas)} ${cuenta.moneda}` : 'Sin confirmar'} · Salidas: {flujo ? `${money(flujo.salidas)} ${cuenta.moneda}` : 'Sin confirmar'}</p>
        <p className="text-xs">Este subtotal sólo usa el historial cargado y sus filtros. No es el saldo completo de la cuenta.</p>
      </section>
      <section aria-label="Historial cargado de esta cuenta" className="space-y-2">
        <p className="text-sm font-bold">{rows.length} registros de esta cuenta entre el historial cargado{hasMore ? '; puede haber más' : ''}.</p>
        {errorCarga && <p role="alert" className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800">{errorCarga}</p>}
        {rows.length === 0 && !errorCarga && <p className="text-sm text-slate-600">No hay movimientos de esta cuenta entre los registros cargados con estos filtros.</p>}
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
          {rows.slice((page - 1) * 10, page * 10).map(m => <li key={m.id} className="p-3 flex flex-wrap items-start justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 break-words text-slate-800">{m.concepto}<span className="block text-xs text-slate-600">{m.fecha} · {m.categoria}</span></span>
            <strong className="text-slate-900 break-words">{m.tipo === 'ingreso' ? '+' : '-'}{money(m.monto)} {m.moneda}</strong>
          </li>)}
        </ul>
        {pages > 1 && <nav aria-label="Páginas de movimientos de la cuenta" className="flex flex-wrap justify-between items-center gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPagina(page - 1)} className="min-h-11 px-3 py-2 rounded-xl border border-slate-300 disabled:opacity-50">Anterior</button>
          <span className="text-sm">Página {page} de {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPagina(page + 1)} className="min-h-11 px-3 py-2 rounded-xl border border-slate-300 disabled:opacity-50">Siguiente</button>
        </nav>}
        {(hasMore || errorCarga) && onLoadMore && <button type="button" onClick={onLoadMore} disabled={isLoadingMore} className="w-full min-h-11 px-3 py-2 rounded-xl border border-slate-300 font-bold">{isLoadingMore ? 'Cargando...' : 'Cargar más historial'}</button>}
      </section>
    </div>
  </Modal>
}
