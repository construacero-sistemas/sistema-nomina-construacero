import { useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import DatePicker from '../../../compat/components/ui/DatePicker.jsx'
import useFinancialOperation from '../../hooks/useFinancialOperation.js'
import useTasaCambioNomina from '../../hooks/useTasaCambioNomina.js'
import { normalizarMontoInput } from './formatos.js'
import { isoToday } from './fechasRapidas.js'

const input = 'w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-800'
const format = value => Number(value).toLocaleString('es-VE', { maximumFractionDigits: 6 })
export default function TransferenciaCarterasModal({ open, onClose, cuentas = [], cuentaInicial = null }) {
  const operation = useFinancialOperation('traspaso', '/api/finanzas/transferencias/crear')
  const rates = useTasaCambioNomina()
  const [origenId, setOrigenId] = useState(cuentaInicial?.id || '')
  const [destinoId, setDestinoId] = useState('')
  const [monto, setMonto] = useState('')
  const [tasa, setTasa] = useState('')
  const [fecha, setFecha] = useState(isoToday)
  const [referencia, setReferencia] = useState('')
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')
  const activas = cuentas.filter(c => c.activo !== false)
  const origen = activas.find(c => c.id === origenId) || activas.find(c => c.saldoConfirmado && c.saldo > 0)
  const destino = activas.find(c => c.id === destinoId && c.id !== origen?.id)
  const confirmado = origen?.saldoConfirmado === true && origen?.disponible === true
  const sinSaldo = !activas.some(c => c.saldoConfirmado && c.disponible && c.saldo > 0)
  const factor = moneda => moneda === 'VES' ? 1 : moneda === 'USDT' ? rates.usdt : rates.usd
  const misma = origen?.moneda === destino?.moneda
  const sugerida = origen && destino && factor(destino.moneda) > 0 ? factor(origen.moneda) / factor(destino.moneda) : 0
  const ratio = misma ? 1 : tasa ? Number(tasa) : sugerida
  const tasaCambio = Number(ratio.toFixed(8))
  const montoNum = Number(monto)
  const montoDestino = montoNum * tasaCambio
  const excede = confirmado && montoNum > origen.saldo
  let usdValuation = rates.usd
  if (origen?.moneda === 'USD' && destino?.moneda === 'VES') usdValuation = tasaCambio
  if (origen?.moneda === 'VES' && destino?.moneda === 'USD' && tasaCambio > 0) usdValuation = Number((1 / tasaCambio).toFixed(8))
  const disabled = operation.isPending || !origen || !destino || !confirmado || sinSaldo || excede || !(montoNum > 0) || !(tasaCambio > 0) || !(usdValuation > 0)
  async function submit(e) {
    e.preventDefault()
    if (disabled) return
    setError('')
    try {
      await operation.mutateAsync({
        origenCuentaId: origen.id, destinoCuentaId: destino.id, montoOrigen: monto,
        tasaCambio: String(tasaCambio), tasaUsdVes: String(usdValuation),
        ...(misma && origen.moneda === 'USDT' ? { tasaUsdtVes: String(rates.usdt) } : {}),
        fecha, referencia: referencia.trim() || null,
        observaciones: nota.trim() || `Traspaso de ${origen.nombre} a ${destino.nombre} a ${tasaCambio} ${destino.moneda}/${origen.moneda}`,
      })
      onClose()
    } catch (e) { setError(e.message) }
  }
  const footer = <>
    <button type="button" onClick={onClose} disabled={operation.isPending} className="min-h-11 px-4 py-2 rounded-xl border border-slate-300 font-bold">Volver</button>
    <button type="submit" form="transferencia-form" disabled={disabled} className="min-h-11 px-4 py-2 flex-1 sm:flex-none rounded-xl bg-primary text-white font-bold disabled:opacity-50 inline-flex gap-2 items-center justify-center"><ArrowRightLeft size={18} />{operation.isPending ? 'Confirmando...' : 'Confirmar traspaso'}</button>
  </>
  return <Modal isOpen={open} onClose={onClose} title="Mover o Cambiar entre Carteras" className="sm:max-w-lg" busy={operation.isPending} footer={footer}>
    <form id="transferencia-form" onSubmit={submit} className="space-y-4" aria-busy={operation.isPending}>
      {(error || operation.error) && <p role="alert" className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm">{error || operation.error?.message}</p>}
      {sinSaldo && <p role="status" className="p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm">Sin saldo disponible para transferir. Es necesario confirmar los saldos y conciliar movimientos pendientes antes de continuar.</p>}
      <div><label id="transfer-source-label" className="block text-sm font-bold mb-1">Desde</label>
        <CustomSelect aria-labelledby="transfer-source-label" placeholder="Cuenta de origen" value={origen?.id || ''} onChange={v => { setOrigenId(v); setDestinoId(''); setTasa(''); setMonto('') }} disabled={operation.isPending}
          options={activas.map(c => ({ value: c.id, label: c.nombre, sub: c.saldoConfirmado ? `${format(c.saldo)} ${c.moneda}` : 'Saldo pendiente de confirmar' }))} />
        <p className="mt-1 text-sm text-slate-600">Disponible: {confirmado ? `${format(origen.saldo)} ${origen.moneda}` : 'Sin confirmar'}</p>
      </div>
      <div><label id="transfer-target-label" className="block text-sm font-bold mb-1">Hacia</label>
        <CustomSelect aria-labelledby="transfer-target-label" placeholder="Cuenta de destino" value={destino?.id || ''} onChange={v => { setDestinoId(v); setTasa('') }} disabled={operation.isPending}
          options={activas.filter(c => c.id !== origen?.id).map(c => ({ value: c.id, label: c.nombre, sub: c.moneda }))} />
      </div>
      <label className="block text-sm font-bold">Monto a transferir {origen?.moneda || ''}<input className={input} type="text" inputMode="decimal" value={monto} disabled={operation.isPending} placeholder="0.00"
        onChange={e => { const value = normalizarMontoInput(e.target.value); if (value !== null) setMonto(value) }} /></label>
      {excede && <p role="alert" className="text-sm text-rose-800">El monto excede el saldo disponible. Máximo: {format(origen.saldo)} {origen.moneda}.</p>}
      {confirmado && <button type="button" onClick={() => setMonto(String(origen.saldo))} disabled={operation.isPending} className="min-h-11 px-3 py-2 rounded-xl border border-slate-300 text-sm font-bold">Usar máximo confirmado</button>}
      {origen && destino && !misma && <label className="block text-sm font-bold">Tasa: {destino.moneda} por cada 1 {origen.moneda}<input className={input} type="text" inputMode="decimal" value={tasa} disabled={operation.isPending} placeholder={sugerida > 0 ? String(Number(sugerida.toFixed(8))) : 'Indica la tasa acordada'}
        onChange={e => { const value = normalizarMontoInput(e.target.value); if (value !== null) setTasa(value) }} /></label>}
      {destino && montoNum > 0 && tasaCambio > 0 && <p className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-900">Recibes en {destino.nombre}: <strong>{format(montoDestino)} {destino.moneda}</strong>.</p>}
      <div><label id="transfer-date-label" className="block text-sm font-bold mb-1">Fecha del traspaso</label><DatePicker aria-labelledby="transfer-date-label" value={fecha} onChange={setFecha} disabled={operation.isPending} clearable={false} /></div>
      <label className="block text-sm font-bold">Referencia (opcional)<input className={input} value={referencia} maxLength={160} onChange={e => setReferencia(e.target.value)} disabled={operation.isPending} /></label>
      <label className="block text-sm font-bold">Motivo (opcional)<input className={input} value={nota} maxLength={300} onChange={e => setNota(e.target.value)} disabled={operation.isPending} /></label>
      {operation.operationId && <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-sm text-amber-900"><p className="break-all">Operación: {operation.operationId}</p><button type="button" disabled={operation.isPending} className="min-h-11 px-3 py-2 border rounded-xl mt-2 font-bold" onClick={async () => { try { const r = await operation.checkStatus(); if (r?.estado === 'confirmada') onClose() } catch (e) { setError(e.message) } }}>Comprobar resultado</button></div>}
      <p className="text-xs text-slate-600">El débito y el crédito se guardan juntos. Un traspaso interno no se considera ingreso o gasto operativo. El servidor vuelve a comprobar los fondos.</p>
    </form>
  </Modal>
}
