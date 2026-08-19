// src/components/finanzas/FinanzasView.jsx
// Libro financiero administrativo: ingresos, egresos y reportes por rango.
import { useMemo, useState } from 'react'
import { BarChart3, Download, Landmark, Plus, RefreshCw, Wallet } from 'lucide-react'
import PageHeader from '../../../compat/components/ui/PageHeader.jsx'
import EmptyState from '../../../compat/components/ui/EmptyState.jsx'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import useAuthStore from '../../../compat/store/useAuthStore.js'
import {
  useAnularMovimiento,
  useFinanzasCategorias,
  useFinanzasMovimientos,
  useFinanzasResumen,
  usePuedeFinanzas,
} from '../../hooks/useFinanzas.js'
import MovimientoForm from './MovimientoForm.jsx'
import MovimientoTable from './MovimientoTable.jsx'

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}

function monthStart() {
  const date = new Date()
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

export default function FinanzasView() {
  const perfil = useAuthStore(state => state.perfil)
  const puede = usePuedeFinanzas()
  const [desde, setDesde] = useState(monthStart)
  const [hasta, setHasta] = useState(isoToday)
  const [tipo, setTipo] = useState('')
  const [categoria, setCategoria] = useState('')
  const [moneda, setMoneda] = useState('')
  const [mostrarAnulados, setMostrarAnulados] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [anular, setAnular] = useState(null)

  const categorias = useFinanzasCategorias()
  const movimientos = useFinanzasMovimientos({ desde, hasta, tipo, categoria, moneda, mostrarAnulados })
  const resumen = useFinanzasResumen({ desde, hasta, tipo, categoria, moneda })
  const anularMutation = useAnularMovimiento()

  const categoriasVisibles = categorias.data?.categorias || []
  const summary = resumen.data?.resumen
  const fechaValida = desde && hasta && desde <= hasta
  const titulo = perfil?.nombre ? `Control financiero · ${perfil.nombre}` : 'Control financiero'

  const resetFiltros = () => {
    setTipo('')
    setCategoria('')
    setMoneda('')
    setMostrarAnulados(false)
  }

  const categoriasResumen = useMemo(() => summary?.categorias?.slice(0, 8) || [], [summary])

  if (!puede) {
    return (
      <div className="p-4 md:p-6">
        <PageHeader icon={Landmark} title="Finanzas" subtitle="Acceso exclusivo para administración" />
        <div className="mt-5 bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-900">
          Este módulo está disponible únicamente para el operador con rol <strong>administracion</strong>.
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-4 md:space-y-5 min-w-0">
      <PageHeader
        icon={Landmark}
        title="Finanzas"
        subtitle={`${titulo} · ingresos, egresos y reportes`}
        action={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => exportarCsv(movimientos.data?.movimientos || [])}
              disabled={!movimientos.data?.movimientos?.length}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <Download size={15} /> CSV actual
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black text-white shadow-lg active:scale-[.98]"
              style={{ background: 'linear-gradient(135deg, #1B365D, #B8860B)' }}
            >
              <Plus size={16} /> Nuevo movimiento
            </button>
          </div>
        )}
      />

      <section aria-label="Filtros y rango del reporte" className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <FilterField label="Desde"><input type="date" value={desde} onChange={e => setDesde(e.target.value)} /></FilterField>
          <FilterField label="Hasta"><input type="date" value={hasta} onChange={e => setHasta(e.target.value)} /></FilterField>
          <FilterField label="Tipo">
            <select value={tipo} onChange={e => setTipo(e.target.value)}><option value="">Todos</option><option value="ingreso">Ingresos</option><option value="egreso">Egresos</option></select>
          </FilterField>
          <FilterField label="Categoría">
            <select value={categoria} onChange={e => setCategoria(e.target.value)}><option value="">Todas</option>{categoriasVisibles.map(item => <option key={item.id || item.nombre} value={item.nombre}>{item.nombre}</option>)}</select>
          </FilterField>
          <FilterField label="Moneda">
            <select value={moneda} onChange={e => setMoneda(e.target.value)}><option value="">Todas</option><option value="USD">USD</option><option value="VES">VES</option><option value="EUR">EUR</option><option value="USDT">USDT</option></select>
          </FilterField>
          <div className="flex items-end gap-2">
            <button type="button" onClick={resetFiltros} className="flex-1 h-10 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">Limpiar</button>
            <button type="button" onClick={() => { movimientos.refetch(); resumen.refetch() }} className="h-10 w-10 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center justify-center" title="Actualizar reportes" aria-label="Actualizar reportes"><RefreshCw size={15} /></button>
          </div>
        </div>
        <label className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 cursor-pointer">
          <input type="checkbox" checked={mostrarAnulados} onChange={e => setMostrarAnulados(e.target.checked)} className="rounded border-slate-300 text-primary focus:ring-primary" />
          Mostrar movimientos anulados
        </label>
        {!fechaValida && <p className="mt-2 text-xs font-semibold text-red-600" role="alert">El rango de fechas no es válido.</p>}
      </section>

      <section aria-label="Resumen financiero" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard icon={BarChart3} label="Ingresos" value={summary?.ingresos_ves} tone="green" loading={resumen.isLoading} />
        <SummaryCard icon={Wallet} label="Egresos" value={summary?.egresos_ves} tone="red" loading={resumen.isLoading} />
        <SummaryCard icon={Landmark} label="Balance" value={summary?.balance_ves} tone={Number(summary?.balance_ves) >= 0 ? 'blue' : 'red'} loading={resumen.isLoading} />
      </section>

      {resumen.isError && <InlineError message="No se pudo cargar el resumen." onRetry={() => resumen.refetch()} />}

      {categoriasResumen.length > 0 && (
        <section aria-label="Totales por categoría" className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3 mb-3"><h2 className="text-sm font-black text-slate-800">Totales por categoría</h2><span className="text-[11px] text-slate-400">En VES</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {categoriasResumen.map(item => <div key={`${item.tipo}-${item.categoria}`} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2"><span className="min-w-0 truncate text-xs font-semibold text-slate-600">{item.categoria}</span><span className={`shrink-0 text-xs font-black ${item.tipo === 'ingreso' ? 'text-green-600' : 'text-red-600'}`}>{formatMoney(item.total_ves)} </span></div>)}
          </div>
        </section>
      )}

      <section aria-label="Movimientos financieros" className="min-w-0">
        {movimientos.isLoading ? <Skeleton className="h-56 rounded-2xl" /> : movimientos.isError ? <InlineError message="No se pudieron cargar los movimientos." onRetry={() => movimientos.refetch()} /> : movimientos.data?.movimientos?.length ? (
          <MovimientoTable movimientos={movimientos.data.movimientos} onAnular={setAnular} />
        ) : (
          <EmptyState icon={Landmark} title="Sin movimientos en este rango" description="Registra un ingreso o egreso para comenzar el reporte financiero." actionLabel="Nuevo movimiento" onAction={() => setFormOpen(true)} />
        )}
      </section>

      {formOpen && <MovimientoForm categorias={categoriasVisibles} onClose={() => setFormOpen(false)} />}
      {anular && <AnularDialog movimiento={anular} pending={anularMutation.isPending} onClose={() => setAnular(null)} onConfirm={motivo => { anularMutation.mutate({ id: anular.id, motivo }, { onSuccess: () => setAnular(null) }) }} />}
    </div>
  )
}

function FilterField({ label, children }) {
  return <label className="space-y-1 min-w-0"><span className="block text-[11px] font-bold text-slate-500">{label}</span><span className="block [&>input]:w-full [&>input]:h-10 [&>input]:rounded-xl [&>input]:border [&>input]:border-slate-200 [&>input]:bg-slate-50 [&>input]:px-2.5 [&>input]:text-xs [&>input]:text-slate-700 [&>select]:w-full [&>select]:h-10 [&>select]:rounded-xl [&>select]:border [&>select]:border-slate-200 [&>select]:bg-slate-50 [&>select]:px-2.5 [&>select]:text-xs [&>select]:text-slate-700">{children}</span></label>
}

function SummaryCard({ icon: Icon, label, value, tone, loading }) {
  const colors = { green: 'bg-green-50 text-green-700', red: 'bg-red-50 text-red-700', blue: 'bg-blue-50 text-blue-700' }
  return <div className="bg-white border border-slate-200 rounded-2xl p-4"><div className="flex items-center gap-2"><span className={`w-9 h-9 rounded-xl flex items-center justify-center ${colors[tone]}`}><Icon size={17} /></span><span className="text-xs font-bold text-slate-500">{label} (VES)</span></div>{loading ? <div className="h-7 w-28 mt-3 rounded bg-slate-100 animate-pulse" /> : <p className={`mt-3 text-xl font-black ${tone === 'red' ? 'text-red-700' : tone === 'green' ? 'text-green-700' : 'text-slate-800'}`}>{formatMoney(value)}</p>}</div>
}

function InlineError({ message, onRetry }) {
  return <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700" role="alert">{message} <button type="button" onClick={onRetry} className="underline font-black">Reintentar</button></div>
}

function AnularDialog({ movimiento, pending, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState('')
  return <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="anular-title"><div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-5"><h2 id="anular-title" className="text-lg font-black text-slate-800">Anular movimiento</h2><p className="mt-2 text-sm text-slate-500">Esta acción conserva el registro y lo excluye del balance activo.</p><p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><strong>{movimiento.concepto}</strong> · {formatMoney(movimiento.monto)} {movimiento.moneda}</p><label className="block mt-4 text-xs font-bold text-slate-600">Motivo obligatorio<textarea value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={300} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" placeholder="Describe por qué se anula..." /></label><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={pending} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600">Cancelar</button><button type="button" onClick={() => onConfirm(motivo.trim())} disabled={pending || motivo.trim().length < 3} className="px-4 py-2 rounded-xl bg-red-600 text-sm font-black text-white disabled:opacity-50">{pending ? 'Anulando...' : 'Confirmar anulación'}</button></div></div></div>
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs.`
}

function exportarCsv(rows) {
  if (!rows.length || typeof window === 'undefined') return
  const columns = ['fecha', 'tipo', 'categoria', 'concepto', 'monto', 'moneda', 'tasa_ves', 'monto_ves', 'estado']
  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [columns, ...rows.map(row => columns.map(column => row[column]))]
    .map(row => row.map(escape).join(';'))
    .join('\n')
  const blob = new Blob([`\\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `finanzas-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
