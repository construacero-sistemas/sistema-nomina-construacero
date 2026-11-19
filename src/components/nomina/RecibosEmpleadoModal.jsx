// src/components/nomina/RecibosEmpleadoModal.jsx
// Mejora del 19/11/2026: historial de recibos de un trabajador desde su ficha, con
// descarga del PDF de cada semana. Paginado (10 por página, regla de modales).
import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { useConfigNegocio } from '../../../compat/hooks/useConfigNegocio.js'
import { logClientError } from '../../../compat/utils/errorLogger.js'
import useRecibosEmpleado from '../../hooks/useRecibosEmpleado.js'
import { formatBs, formatUsd } from '../../hooks/useMonedaNomina.js'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'

function fmtFecha(f) {
  return f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}

const ESTADOS = {
  pagado: ['Pagado', 'border-emerald-200 bg-emerald-50 text-emerald-800'],
  pendiente: ['Por pagar', 'border-amber-200 bg-amber-50 text-amber-900'],
}

export default function RecibosEmpleadoModal({ config, onClose }) {
  const [pagina, setPagina] = useState(1)
  const [descargando, setDescargando] = useState(null)
  const { data, isLoading, isError, refetch } = useRecibosEmpleado(config.empleado_id, pagina)
  const { data: configNegocio } = useConfigNegocio()
  const recibos = data?.recibos || []
  const nombre = capitalizarPalabras(config.empleado?.nombre) || 'Trabajador'

  async function descargar(recibo) {
    setDescargando(recibo.id)
    try {
      const { generarNominaReciboPDF } = await import('../../services/pdf/nominaReciboPDF')
      // Un recibo pagado usa la tasa que quedó guardada al pagar (o al cerrar).
      await generarNominaReciboPDF({ periodo: recibo.periodo || {}, linea: recibo, config: configNegocio ?? {}, action: 'download' })
    } catch (e) {
      logClientError({ mensaje: `Error descargando recibo del trabajador: ${e?.message || e}`, stack: e?.stack, categoria: 'NOMINA_PDF' })
    } finally {
      setDescargando(null)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Recibos de ${nombre}`} className="max-w-lg">
      <div className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-slate-500">Cargando recibos…</p>
        ) : isError ? (
          <div role="alert" className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <p>No se pudieron cargar los recibos.</p>
            <button type="button" onClick={() => refetch()} className="min-h-11 rounded-xl border border-rose-300 bg-white px-4 text-xs font-bold">Volver a intentar</button>
          </div>
        ) : recibos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            {pagina === 1 ? 'Todavía no tiene recibos.' : 'No hay más recibos.'}
          </p>
        ) : (
          <ul className="space-y-2" aria-label={`Recibos de ${nombre}`}>
            {recibos.map(recibo => {
              const [etiqueta, clases] = recibo.pagado ? ESTADOS.pagado : ESTADOS.pendiente
              const bs = recibo.pagado && recibo.total_pagado_bs != null ? Number(recibo.total_pagado_bs) : null
              return (
                <li key={recibo.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-slate-800">{recibo.periodo?.nombre || 'Período'}</p>
                    <p className="text-[11px] text-slate-500">{fmtFecha(recibo.periodo?.desde)} – {fmtFecha(recibo.periodo?.hasta)}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <strong className="tabular-nums text-slate-800">{formatUsd(recibo.total_neto_usd)}</strong>
                      {bs != null && <span className="tabular-nums text-slate-500">{formatBs(bs)}</span>}
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${clases}`}>{etiqueta}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => descargar(recibo)}
                    disabled={descargando === recibo.id}
                    aria-label={`Descargar recibo de ${recibo.periodo?.nombre || 'este período'}`}
                    className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    style={{ touchAction: 'manipulation' }}
                  >
                    <Download size={15} aria-hidden="true" />
                    <span className="hidden sm:inline">{descargando === recibo.id ? 'Generando…' : 'PDF'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {(pagina > 1 || data?.hayMas) && (
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina === 1 || isLoading}
              className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-40">
              <ChevronLeft size={15} aria-hidden="true" /> Anterior
            </button>
            <span className="text-xs font-semibold text-slate-500">Página {pagina}</span>
            <button type="button" onClick={() => setPagina(p => p + 1)} disabled={!data?.hayMas || isLoading}
              className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-40">
              Siguiente <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
