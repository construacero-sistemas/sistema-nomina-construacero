import { useMemo, useRef, useState } from 'react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'
import { historicalUsd } from '../../utils/financialValuation.js'
const fmt = n => n == null ? 'Sin confirmar' : Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ReasignarCuentaModal({ open, onClose, movimientos = [], cuentas = [], onConfirm, confirmando = false }) {
  const [cuentaId, setCuentaId] = useState('')
  const [seleccion, setSeleccion] = useState(() => new Set())
  const [pagina, setPagina] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const busy = confirmando || saving
  const cuenta = cuentas.find(c => c.id === cuentaId && c.activo !== false)
  const sinCuenta = useMemo(() => movimientos.filter(m => m.estado !== 'anulado' && !m.cuenta_custodia_id && !m.cuentaCustodiaId && !m.operacion_id), [movimientos])
  const rows = cuenta ? sinCuenta.filter(m => m.moneda === cuenta.moneda) : sinCuenta
  const pages = Math.max(1, Math.ceil(rows.length / 10)), page = Math.min(pagina, pages)
  const selected = rows.filter(m => seleccion.has(m.id) && !(m.partes?.length))
  async function confirmar() {
    if (busy || lock.current || !cuenta || !selected.length || selected.length > 100) return
    lock.current = true; setSaving(true); setError('')
    try {
      const result = await onConfirm({ ids: selected.map(m => m.id), cuentaCustodiaId: cuenta.id })
      if (result?.ok !== true) throw new Error('La asignaci\u00f3n no pudo confirmarse.')
      setSeleccion(new Set()); setCuentaId(''); onClose()
    } catch (cause) { setError(cause.message || 'No se confirm\u00f3 la asignaci\u00f3n. Conserva la selecci\u00f3n y reintenta.') }
    finally { lock.current = false; setSaving(false) }
  }
  const footer = <>
    <button type="button" disabled={busy} onClick={onClose} className="min-h-11 px-4 py-2 border border-slate-300 rounded-xl">Cancelar</button>
    <button type="button" onClick={confirmar} disabled={busy || !cuenta || !selected.length || selected.length > 100} className="min-h-11 px-4 py-2 rounded-xl bg-primary text-white font-bold disabled:opacity-50">{busy ? 'Asignando...' : 'Asignar cuenta'}</button>
  </>
  return <Modal isOpen={open} onClose={onClose} busy={busy} title="Asignar cuenta a movimientos" className="sm:max-w-lg" footer={footer}>
    <div className="space-y-4">
      {error && <p role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm">{error}</p>}
      <p className="text-sm text-slate-700">{sinCuenta.length ? `${sinCuenta.length} registros cargados sin cuenta de custodia confirmada.` : 'Todo clasificado en los registros cargados.'} Puede haber otros registros fuera de esta página o de los filtros activos.</p>
      <p className="text-xs text-slate-600">Selecciona una cuenta real y revisa cada partida. No se modifican importes ni tasas; el nombre histórico por sí solo no confirma la asignación.</p>
      <div><span id="asignar-cuenta-label" className="block text-sm font-bold mb-1">Cuenta de destino</span>
        <CustomSelect aria-labelledby="asignar-cuenta-label" value={cuentaId} onChange={id => { setCuentaId(id); setSeleccion(new Set()); setPagina(1) }} disabled={busy}
          placeholder="Selecciona una cuenta..." options={cuentas.filter(c => c.activo !== false).map(c => ({ value: c.id, label: c.nombre, sub: c.moneda }))} />
      </div>
      <div className="flex flex-wrap justify-between items-center gap-2"><span className="text-sm">{selected.length} seleccionado(s) / m\u00e1ximo 100</span>
        <button type="button" disabled={!cuenta || busy || !rows.length} onClick={() => setSeleccion(new Set(rows.filter(m => !(m.partes?.length)).slice(0,100).map(m => m.id)))} className="min-h-11 px-3 py-2 border rounded-xl text-sm">Seleccionar hasta 100 compatibles</button></div>
      <ul className="divide-y divide-slate-200 border border-slate-200 rounded-xl">
        {rows.slice((page-1)*10,page*10).map(m => <li key={m.id}><label className="min-h-11 flex items-center gap-3 p-3 text-sm cursor-pointer">
          <input type="checkbox" className="w-4 h-4" disabled={busy || !cuenta || !!m.partes?.length || (!seleccion.has(m.id) && selected.length >= 100)} checked={seleccion.has(m.id)} onChange={() => setSeleccion(old => { const next = new Set(old); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); return next })} />
          <span className="min-w-0 flex-1 break-words">{m.concepto || m.categoria}<span className="block text-xs text-slate-600">{m.fecha} · {m.cuenta_origen || 'Sin referencia de cuenta'}{m.partes?.length ? ' · Requiere conciliaci\u00f3n de partes' : ''}</span></span>
          <span className="text-right text-xs"><strong className="block">{historicalUsd(m) == null ? 'USD pendiente' : `$${fmt(historicalUsd(m))} USD`}</strong>{fmt(m.monto)} {m.moneda}</span>
        </label></li>)}
      </ul>
      {rows.length === 0 && cuenta && <p className="text-sm text-slate-600">No hay partidas cargadas compatibles con {cuenta.moneda}.</p>}
      {pages > 1 && <nav aria-label="Paginaci\u00f3n de partidas" className="flex justify-between items-center gap-2 text-sm"><button type="button" disabled={page===1 || busy} onClick={() => setPagina(page-1)} className="min-h-11 px-3 py-2 border rounded-xl">Anterior</button><span>{page} de {pages}</span><button type="button" disabled={page===pages || busy} onClick={() => setPagina(page+1)} className="min-h-11 px-3 py-2 border rounded-xl">Siguiente</button></nav>}
    </div>
  </Modal>
}
