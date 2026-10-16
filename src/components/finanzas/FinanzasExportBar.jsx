// src/components/finanzas/FinanzasExportBar.jsx
// Reporte PDF del rango/filtros activos (resumen + detalle línea por línea).
// Extraído de FinanzasView.jsx para mantener el archivo bajo el guardrail de 600 líneas.
import { useEffect, useRef, useState } from 'react'
import { FileText, Printer } from 'lucide-react'
import { InlineError } from './FinanzasFiltrosUI.jsx'
import { fechaCorta } from './formatos.js'
import { logClientError } from '../../../compat/utils/errorLogger.js'
import { loadFinanceExport } from './exportData.js'

export default function FinanzasExportBar({ filtros, fechaValida, movimientosCount, totalServidor, tasaActiva, nombreTasa }) {
  const [exportandoPdf, setExportandoPdf] = useState(false)
  const [tipoReportePdf, setTipoReportePdf] = useState('resumido')
  const [exportProgress, setExportProgress] = useState(null)
  const [exportError, setExportError] = useState('')
  const exportController = useRef(null)
  useEffect(() => () => exportController.current?.abort(), [])

  const handleExportarPdf = async (action = 'download') => {
    if (exportController.current) return
    // Reservar ventana dentro del gesto; no después de imports/red asíncronos.
    const printWindow = action === 'print' ? window.open('', '_blank') : null
    if (printWindow) { printWindow.opener = null; printWindow.document.title = 'Preparando reporte financiero' }
    if (action === 'print' && !printWindow) {
      setExportError('El navegador bloqueó la ventana. Usa Descargar PDF y ábrelo desde Archivos para imprimir.')
      return
    }
    const controller = new AbortController()
    exportController.current = controller
    setExportandoPdf(action); setExportError(''); setExportProgress(null)
    try {
      const dataset = await loadFinanceExport(filtros, { signal: controller.signal, onProgress: setExportProgress })
      controller.signal.throwIfAborted()
      if (dataset.summary.movimientos_sin_usd) throw new Error('Hay movimientos sin tasa histórica. Confirma esas tasas antes de emitir un reporte consolidado en USD.')
      const { generarFinanzasResumenPDF } = await import('../../services/pdf/finanzasResumenPDF.js')
      controller.signal.throwIfAborted()
      await generarFinanzasResumenPDF({ movimientos: dataset.rows, resumen: { ...dataset.summary, tipoFiltro: filtros.tipo || '' }, rango: { desde: filtros.desde, hasta: filtros.hasta }, tasaActiva, nombreTasa, action, printWindow, tipoReporte: tipoReportePdf })
    } catch (error) {
      printWindow?.close()
      if (error.name !== 'AbortError') {
        setExportError(error.message || 'No se pudo generar el reporte completo.')
        logClientError({ mensaje: `Error exportando reporte financiero: ${error?.message || error}`, categoria: 'FINANZAS_PDF' })
      }
    } finally {
      exportController.current = null
      setExportandoPdf(null); setExportProgress(null)
    }
  }

  return (
    <>
      {/* Exportación del reporte del período filtrado */}
      <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-600 font-semibold">
          El PDF recupera todos los registros de los filtros activos: {fechaCorta(filtros.desde)} – {fechaCorta(filtros.hasta)}{filtros.tipo ? ` · ${filtros.tipo === 'ingreso' ? 'ingresos' : 'egresos'}` : ''} · {totalServidor ?? 'total pendiente'} movimiento(s)
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setTipoReportePdf('resumido')}
              className={`min-h-11 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${tipoReportePdf === 'resumido' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
              style={{ touchAction: 'manipulation' }}
              aria-pressed={tipoReportePdf === 'resumido'}
            >
              Resumido
            </button>
            <button
              type="button"
              onClick={() => setTipoReportePdf('completo')}
              className={`min-h-11 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${tipoReportePdf === 'completo' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
              style={{ touchAction: 'manipulation' }}
              aria-pressed={tipoReportePdf === 'completo'}
            >
              Completo
            </button>
          </div>
          <button
            type="button"
            onClick={() => handleExportarPdf('print')}
            disabled={!fechaValida || !!exportandoPdf || movimientosCount === 0}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-11 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-black text-slate-700 disabled:opacity-40 active:scale-95 transition-all cursor-pointer"
            style={{ touchAction: 'manipulation' }}
          >
            <Printer size={14} />
            <span>{exportandoPdf === 'print' ? 'Preparando...' : 'Imprimir'}</span>
          </button>
          <button
            type="button"
            onClick={() => handleExportarPdf('download')}
            disabled={!fechaValida || !!exportandoPdf || movimientosCount === 0}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 min-h-11 rounded-xl bg-primary/10 border border-primary/20 text-xs font-black text-primary hover:bg-primary/20 disabled:opacity-40 active:scale-95 transition-all shadow-xs cursor-pointer"
            style={{ touchAction: 'manipulation' }}
          >
            <FileText size={14} />
            <span>{exportandoPdf === 'download' ? 'Generando PDF...' : 'Descargar PDF'}</span>
          </button>
        </div>
      </div>

      {exportError && <InlineError message={exportError} onRetry={() => handleExportarPdf('download')} />}
      {exportandoPdf && <div role="status" className="flex flex-wrap gap-3 items-center text-sm text-slate-700"><span>{exportProgress ? `${exportProgress.loaded} de ${exportProgress.total} registros recuperados` : 'Preparando datos completos...'}</span><button type="button" onClick={() => exportController.current?.abort()} className="min-h-11 px-3 py-2 rounded-xl border border-slate-300">Cancelar preparación</button></div>}
      {!fechaValida && <p className="mt-2 text-xs font-semibold text-red-600" role="alert">El rango de fechas no es válido.</p>}
    </>
  )
}
