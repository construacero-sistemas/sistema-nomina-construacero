// src/components/nomina/RetencionCard.jsx
// Almacenamiento y retención: ventana de meses + purga inteligente (simular/ejecutar)
// + medidor de uso de la base de datos (MB/filas por tabla, límite 500 MB).
import { useState } from 'react'
import { Database, Trash2, Play, RefreshCw, ShieldCheck, Clock, HardDrive } from 'lucide-react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { authFetch } from '../../../compat/services/authFetch.js'

// authFetch: mismo camino que el resto de hooks — timeout, header de operador
// y refresh automático del token en 401.
async function apiGet(path) {
  const res = await authFetch(path)
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(payload.error || `Error ${res.status}`)
  return payload
}

async function apiPost(path, body) {
  const res = await authFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(payload.error || `Error ${res.status}`)
  return payload
}

const inputClass = 'w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50'

function formatoFecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-VE')
}

function formatoMB(bytes) {
  const mb = Number(bytes || 0) / (1024 * 1024)
  if (mb < 0.01) return `${Number(bytes || 0).toLocaleString('es-VE')} B`
  if (mb < 1) return `${(mb * 1024).toFixed(0)} kB`
  return `${mb.toLocaleString('es-VE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`
}

function formatoFilas(n) {
  return Number(n || 0).toLocaleString('es-VE')
}

const NOMBRES_TABLAS = {
  finanzas_movimientos: 'Movimientos financieros',
  finanzas_categorias: 'Categorías',
  cuentas_custodia: 'Cuentas de custodia',
  nomina_empleados: 'Empleados',
  nomina_config_empleado: 'Config. de empleados',
  registro_asistencia: 'Asistencia diaria',
  nomina_periodos: 'Períodos de nómina',
  nomina_lineas: 'Líneas de nómina',
  nomina_linea_conceptos: 'Conceptos de nómina',
  nomina_tasas_snapshot: 'Snapshots de tasa',
  auditoria: 'Logs de auditoría',
  purga_log: 'Historial de purgas',
}

function totalFromDetalle(detalle) {
  return (detalle || []).reduce((sum, row) => sum + Number(row.eliminadas || 0), 0)
}

export default function RetencionCard() {
  const queryClient = useQueryClient()
  const [mesesDraft, setMesesDraft] = useState(null)
  const [detalle, setDetalle] = useState(null)
  const [modo, setModo] = useState('simulacion') // 'simulacion' | 'real'
  const [errores, setErrores] = useState({})

  const estadoQ = useQuery({
    queryKey: ['retencion'],
    queryFn: () => apiGet('/api/retencion'),
    placeholderData: keepPreviousData,
  })

  const usoQ = useQuery({
    queryKey: ['retencion', 'uso'],
    queryFn: () => apiGet('/api/retencion/uso'),
    staleTime: 60 * 1000,
    retry: 1,
  })
  const uso = usoQ.data
  const pct = Math.min(Number(uso?.pct || 0), 100)
  const nivelPct = pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-500' : 'bg-emerald-500'
  const nivelTexto = pct >= 80 ? 'text-red-600' : pct >= 50 ? 'text-amber-600' : 'text-emerald-600'

  const configurarM = useMutation({
    mutationFn: (m) => apiPost('/api/retencion/configurar', { meses: m }),
    onSuccess: (data) => {
      queryClient.setQueryData(['retencion'], (old) => ({ ...(old || {}), retencion_meses: data.retencion_meses }))
      setErrores({})
    },
    onError: (e) => setErrores({ configurar: e.message }),
  })

  const purgarM = useMutation({
    mutationFn: ({ m, dry }) => apiPost('/api/retencion/purgar', { meses: m, dry_run: dry }),
    onSuccess: (data) => {
      setDetalle(data)
      queryClient.invalidateQueries({ queryKey: ['retencion'] })
      setErrores({})
    },
    onError: (e) => setErrores({ purgar: e.message }),
  })

  const data = estadoQ.data
  // La ventana mostrada SIEMPRE refleja lo guardado en el servidor; el input
  // es un borrador local para editar. Sin esto, tras recargar se vería el
  // default (3) aunque el usuario haya guardado otro valor.
  const mesesGuardados = Number(data?.retencion_meses) > 0 ? Number(data.retencion_meses) : 3
  const meses = mesesDraft ?? mesesGuardados
  const detalleResumen = detalle?.detalle || []
  const confirmado = detalle && !detalle.dry_run
  const ejecutando = purgarM.isPending || configurarM.isPending

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-5 shadow-sm">
      {/* Encabezado */}
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Database size={18} />
        </div>
        <div>
          <h2 className="text-sm font-black text-slate-800">Almacenamiento y retención</h2>
          <p className="text-xs text-slate-400">Purga inteligente para el plan gratuito de Supabase</p>
        </div>
      </div>

      {/* Medidor de uso de la base de datos (límite 500 MB tier gratuito) */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3" data-testid="db-usage">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
            <HardDrive size={13} className="text-slate-400" /> Uso de la base de datos
          </h3>
          {uso && (
            <span className={`text-xs font-black ${nivelTexto}`}>
              {uso.pct?.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% de {uso.presupuesto_mb} MB
            </span>
          )}
        </div>

        {usoQ.isError ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            No se pudo medir el uso ({usoQ.error.message}). Vuelve a iniciar sesión o reintenta desde el botón de actualizar.
          </p>
        ) : usoQ.isPending && !uso ? (
          <div className="h-2.5 rounded-full bg-slate-200 animate-pulse" aria-label="Cargando uso" />
        ) : (
          <>
            {/* Barra de progreso (gauge horizontal) */}
            <div
              role="progressbar"
              aria-valuenow={Number(uso?.pct?.toFixed(2))}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Porcentaje de uso de la base de datos"
              className="h-2.5 rounded-full bg-slate-200 overflow-hidden"
            >
              <div className={`h-full rounded-full transition-all ${nivelPct}`} style={{ width: `${Math.max(pct, uso?.total_bytes > 0 ? 1.5 : 0)}%` }} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
              <span>
                Usado: <b className="text-slate-700">{formatoMB(uso?.total_bytes)}</b>
              </span>
              <span>
                Filas: <b className="text-slate-700">{formatoFilas(uso?.total_filas)}</b> en {uso?.n_tablas ?? 0} tabla(s)
              </span>
              {uso?.max_fila > 0 && (
                <span>
                  Mayor fila: <b className="text-slate-700">{formatoMB(uso.max_fila)}</b>
                </span>
              )}
            </div>

            {/* Desglose por tabla (solo las que tienen datos) */}
            {uso?.tablas?.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 bg-white overflow-hidden">
                {uso.tablas.map(t => (
                  <li key={t.tabla} className="flex items-center justify-between gap-2 px-3 py-2 text-xs min-w-0">
                    <span className="min-w-0 truncate text-slate-600" title={t.tabla}>
                      {NOMBRES_TABLAS[t.tabla] || t.tabla}
                    </span>
                    <span className="shrink-0 flex items-center gap-2.5">
                      <span className="text-slate-400">{formatoFilas(t.total_filas)} filas</span>
                      <b className="text-slate-700 tabular-nums">{formatoMB(t.total_bytes)}</b>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {uso?.n_tablas === 0 && (
              <p className="text-xs text-slate-400">Aún no hay datos registrados en este negocio.</p>
            )}
          </>
        )}
      </div>

      {/* Ventana de retención */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block text-xs font-bold text-slate-700">Meses de historial a conservar</label>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              max={36}
              value={meses}
              onChange={(e) => setMesesDraft(Number(e.target.value))}
              className={inputClass}
              disabled={ejecutando}
              aria-label="Meses de retención"
            />
            <button
              type="button"
              onClick={() => configurarM.mutate(meses)}
              disabled={ejecutando || !Number.isInteger(meses) || meses < 1 || meses > 36 || meses === data?.retencion_meses}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-11 rounded-xl bg-primary text-white text-xs font-black hover:bg-primary/90 disabled:opacity-40 whitespace-nowrap"
            >
              <RefreshCw size={14} className={configurarM.isPending ? 'animate-spin' : ''} /> Guardar
            </button>
          </div>
          {errores.configurar && <p className="text-xs text-red-600">{errores.configurar}</p>}
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-500 space-y-1">
          <p className="flex items-center gap-1.5"><Clock size={13} className="text-primary" /> Ventana: <b className="text-slate-700">{meses} meses</b></p>
          <p className="flex items-center gap-1.5"><ShieldCheck size={13} className="text-emerald-500" /> Nunca borra movimientos ni nómina (contabilidad)</p>
        </div>
      </div>

      {/* Modo + ejecutar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex rounded-xl border border-slate-200 overflow-hidden" role="group" aria-label="Modo de purga">
          <button
            type="button"
            onClick={() => setModo('simulacion')}
            className={`px-3 py-2.5 text-xs font-black whitespace-nowrap ${modo === 'simulacion' ? 'bg-primary text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
          >
            Simular
          </button>
          <button
            type="button"
            onClick={() => { setModo('real'); setDetalle(null) }}
            className={`px-3 py-2.5 text-xs font-black whitespace-nowrap ${modo === 'real' ? 'bg-red-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
          >
            Ejecutar
          </button>
        </div>

        <button
          type="button"
          onClick={() => purgarM.mutate({ m: meses, dry: modo === 'simulacion' })}
          disabled={ejecutando}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-11 rounded-xl text-xs font-black text-white shadow-sm active:scale-[.98] disabled:opacity-40 flex-1 sm:flex-none ${modo === 'real' ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary/90'}`}
        >
          {modo === 'real' ? <Trash2 size={15} /> : <Play size={15} />}
          {modo === 'real' ? 'Ejecutar purga ahora' : 'Simular purga'}
          {purgarM.isPending && <span className="animate-spin">·</span>}
        </button>
      </div>
      {errores.purgar && <p className="text-xs text-red-600">{errores.purgar}</p>}

      {/* Resultado */}
      {detalle && (
        <div className={`rounded-xl border p-4 space-y-2 ${detalle.dry_run ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-black ${detalle.dry_run ? 'text-amber-700' : 'text-emerald-700'}`}>
              {detalle.dry_run ? 'Simulación (no borró nada)' : 'Purga ejecutada'}
            </span>
            <span className={`text-lg font-black ${detalle.dry_run ? 'text-amber-700' : 'text-emerald-700'}`}>{detalle.total_eliminadas ?? totalFromDetalle(detalleResumen)}</span>
          </div>
          <ul className="text-xs text-slate-600 space-y-0.5">
            <li className="flex justify-between"><span>Registros de asistencia</span><b>{detalle.detalle?.find(r => r.tabla === 'registro_asistencia')?.eliminadas ?? 0}</b></li>
            <li className="flex justify-between"><span>Snapshots de tasa</span><b>{detalle.detalle?.find(r => r.tabla === 'nomina_tasas_snapshot')?.eliminadas ?? 0}</b></li>
            <li className="flex justify-between"><span>Logs de auditoría</span><b>{detalle.detalle?.find(r => r.tabla === 'auditoria')?.eliminadas ?? 0}</b></li>
          </ul>
        </div>
      )}

      {/* Últimos logs */}
      {data?.ultimos_logs?.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-bold text-slate-600">Últimas ejecuciones</h3>
          <div className="space-y-1.5">
            {data.ultimos_logs.map((log, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className="text-slate-500">{formatoFecha(log.creado_en)} · {log.disparador}</span>
                <span className="font-bold text-slate-700">{log.dry_run ? 'Simulación' : `${log.total_eliminadas} filas`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
