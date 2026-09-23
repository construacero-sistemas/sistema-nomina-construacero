import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, Download, Eye, FileJson, ShieldCheck } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { downloadReconciliationManifest } from './reconciliationManifest.js'

const labels = {
  propuesta: 'Propuesta segura',
  ambiguo: 'Revisión manual',
  incompatible: 'Incompatible',
  bloqueado: 'Mapeo bloqueado',
  asignado: 'Ya asignado',
  omitido: 'Omitido',
  excluir: 'Excluir (POS no listo)',
}

function plural(value, singular, pluralForm = `${singular}s`) {
  return `${value || 0} ${value === 1 ? singular : pluralForm}`
}

function countText(counts) {
  return `${plural(counts?.propuesta, 'propuesta')} · ${plural(counts?.ambiguo, 'ambiguo', 'ambiguos')} · ${plural(counts?.incompatible, 'incompatible', 'incompatibles')}`
}

export default function ConciliacionPreviewModal({ open, onClose, preview, loading = false, error = '' }) {
  const rows = preview?.rows || []
  const reviewRows = useMemo(() => rows.filter(row => !['propuesta', 'asignado', 'omitido'].includes(row.propuesta?.status)), [rows])
  const mappings = preview?.mappings || []
  const proposedByAccount = useMemo(() => rows
    .filter(row => row.propuesta?.status === 'propuesta')
    .reduce((groups, row) => {
      const currentName = row.propuesta.cuentaNombre || row.propuesta.cuentaCustodiaId || 'Cuenta sin nombre'
      const canonicalName = row.propuesta.canonicalName || 'Sin cuenta canónica'
      const key = `${currentName} → ${canonicalName}`
      const current = groups.get(key) || { count: 0, currentName, canonicalName, reasons: new Map() }
      current.count += 1
      current.reasons.set(row.propuesta.reason, (current.reasons.get(row.propuesta.reason) || 0) + 1)
      groups.set(key, current)
      return groups
    }, new Map()), [rows])
  const footer = <div className="flex flex-wrap justify-end gap-2">
    <button type="button" onClick={() => downloadReconciliationManifest(preview, 'csv')} disabled={loading || !preview?.rows?.length} className="min-h-11 px-3 py-2 rounded-xl border border-slate-300 font-bold inline-flex items-center gap-2"><Download size={16} />CSV</button>
    <button type="button" onClick={() => downloadReconciliationManifest(preview, 'json')} disabled={loading || !preview?.rows?.length} className="min-h-11 px-3 py-2 rounded-xl border border-slate-300 font-bold inline-flex items-center gap-2"><FileJson size={16} />JSON</button>
    <button type="button" onClick={onClose} disabled={loading} className="min-h-11 px-4 py-2 rounded-xl border border-slate-300 font-bold">Cerrar simulación</button>
  </div>

  return <Modal isOpen={open} onClose={onClose} title="Simulación de conciliación" className="sm:max-w-3xl" footer={footer}>
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
        <ShieldCheck size={22} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-black">Modo solo lectura</p>
          <p className="mt-1 text-sm">Esta pantalla propone cuentas por reglas deterministas. No asigna cuentas, no cambia importes y no establece un creador histórico.</p>
        </div>
      </div>

      {loading && <p role="status" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">Leyendo todas las páginas del libro y comparando el catálogo de cuentas...</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}

      {preview && !loading && !error && <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {Object.entries(preview.counts || {}).filter(([key]) => key !== 'total').map(([key, value]) => <div key={key} className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{labels[key] || key}</p>
            <p className="mt-1 text-xl font-black text-slate-900">{value}</p>
          </div>)}
        </div>
        <p className="text-sm font-bold text-slate-700">{preview.counts?.total || 0} movimientos revisados · {countText(preview.counts)}.</p>
        <p className="text-xs text-slate-600">Las propuestas se podrán aprobar en una segunda etapa con respaldo, lote limitado y auditoría. Esta simulación no permite aplicar cambios.</p>

        {mappings.length > 0 && <section aria-label="Mapeo de cuentas actuales a cuentas canónicas" className="space-y-2">
          <h3 className="text-sm font-black text-slate-800">Mapeo de cuentas actuales</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {mappings.map(mapping => <li key={mapping.cuentaCustodiaId} className={`rounded-xl border p-3 text-sm ${mapping.status === 'confirmada' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
              <strong className="block text-slate-900">{mapping.cuentaActual}</strong>
              {mapping.status === 'confirmada' ? <span className="text-xs text-emerald-900">→ {mapping.name}</span> : <span className="text-xs text-amber-900">Bloqueada: {mapping.reason}</span>}
            </li>)}
          </ul>
        </section>}

        {proposedByAccount.size > 0 && <section aria-label="Propuestas agrupadas por cuenta" className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-black text-slate-800"><CheckCircle2 size={17} className="text-emerald-600" />Distribución propuesta</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {[...proposedByAccount.entries()].map(([account, group]) => <li key={account} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <strong className="block text-emerald-950">{group.currentName} → {group.canonicalName}: {group.count}</strong>
              {[...group.reasons.entries()].map(([reason, count]) => <span key={reason} className="mt-1 block text-xs text-emerald-900">{count} · {reason}</span>)}
            </li>)}
          </ul>
        </section>}

        {reviewRows.length > 0 && <section aria-label="Partidas que requieren revisión" className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-black text-slate-800"><AlertTriangle size={17} className="text-amber-600" />Partidas que no se asignarán automáticamente</h3>
          <div className="max-h-64 overflow-auto rounded-xl border border-slate-200">
            <ul className="divide-y divide-slate-200">
              {reviewRows.slice(0, 100).map(row => <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
                <span className="min-w-0 flex-1"><strong className="block break-words text-slate-800">{row.concepto || row.categoria || 'Movimiento sin concepto'}</strong><span className="text-xs text-slate-600">{row.fecha} · {row.monto} {row.moneda} · {row.cuenta_origen || 'sin origen'}</span></span>
                <span className="max-w-[16rem] text-right text-xs font-semibold text-amber-800">{labels[row.propuesta?.status] || 'Revisión'}: {row.propuesta?.reason}</span>
              </li>)}
            </ul>
          </div>
          {reviewRows.length > 100 && <p className="text-xs text-slate-600">Se muestran 100 partidas; el total de revisión es {reviewRows.length}.</p>}
        </section>}

        {(preview.counts?.propuesta || 0) > 0 && <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 size={18} />Hay {plural(preview.counts.propuesta, 'propuesta segura', 'propuestas seguras')}. Aún no se ha aplicado ninguna.</p>}
        <p className="flex items-center gap-2 text-xs text-slate-500"><Eye size={15} />Libro: {preview.totalServidor ?? preview.counts?.total ?? 0} registros · versión {preview.versionLibro || 'no informada'}.</p>
      </>}
    </div>
  </Modal>
}
