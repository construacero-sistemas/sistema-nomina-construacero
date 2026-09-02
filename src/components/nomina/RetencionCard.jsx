// src/components/nomina/RetencionCard.jsx
// Almacenamiento y retención: ventana de meses + purga inteligente (simular/ejecutar).
import { useState } from 'react'
import { Database, Trash2, Play, RefreshCw, ShieldCheck, Clock } from 'lucide-react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { getAuthHeaders, apiUrl } from '../../../compat/services/apiBase.js'

async function apiGet(path) {
  const res = await fetch(apiUrl(path), { headers: await getAuthHeaders() })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(payload.error || `Error ${res.status}`)
  return payload
}

async function apiPost(path, body) {
  const res = await fetch(apiUrl(path), { method: 'POST', headers: await getAuthHeaders(), body: JSON.stringify(body) })
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

function totalFromDetalle(detalle) {
  return (detalle || []).reduce((sum, row) => sum + Number(row.eliminadas || 0), 0)
}

export default function RetencionCard() {
  const queryClient = useQueryClient()
  const [meses, setMeses] = useState(3)
  const [detalle, setDetalle] = useState(null)
  const [modo, setModo] = useState('simulacion') // 'simulacion' | 'real'
  const [errores, setErrores] = useState({})

  const estadoQ = useQuery({
    queryKey: ['retencion'],
    queryFn: () => apiGet('/api/retencion'),
    placeholderData: keepPreviousData,
  })

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
              onChange={(e) => setMeses(Number(e.target.value))}
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
