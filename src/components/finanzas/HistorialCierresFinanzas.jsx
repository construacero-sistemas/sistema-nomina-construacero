// src/components/finanzas/HistorialCierresFinanzas.jsx
// Historial de cierres mensuales: cada cierre queda guardado y se puede revisar al
// detalle y volver a descargar el PDF (resumido o detallado) cuando haga falta.
import { useState } from 'react'
import { ChevronDown, FileText, History, LockKeyhole, Undo2 } from 'lucide-react'
import { cargarMovimientosCierre, useHistorialCierres, useReabrirCierre } from '../../hooks/useHistorialCierres.js'
import ReabrirCierreDialog from './ReabrirCierreDialog.jsx'
import { isoToday, mesAnteriorIso } from './fechasRapidas.js'
import { generarFinanzasResumenPDF } from '../../services/pdf/finanzasResumenPDF.js'
import { formatNumber } from './formatos.js'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const nombreMes = mes => {
  const [anio, numero] = String(mes || '').split('-')
  return MESES[Number(numero) - 1] ? `${MESES[Number(numero) - 1]} ${anio}` : String(mes || '—')
}
const money = value => value == null ? '—' : formatNumber(value)
const cerradoEl = fecha => fecha ? new Date(fecha).toLocaleString('es-VE') : '—'

function Dato({ etiqueta, children, className = 'text-slate-900' }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{etiqueta}</dt>
      <dd className={`font-mono font-semibold ${className}`}>{children}</dd>
    </div>
  )
}

function DetalleCierre({ periodo }) {
  return (
    <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
      {(periodo.cuentas || []).map(fila => {
        const diferencia = Number(fila.diferenciaCierre)
        return (
          <article key={fila.cuentaCustodiaId} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-bold text-slate-900">{fila.nombre}</span>
              <span className="font-mono font-bold text-slate-600">{fila.moneda}</span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
              <Dato etiqueta="Apertura">{money(fila.saldoApertura)}</Dato>
              <Dato etiqueta="Saldo del libro">{money(fila.saldoCierreLibro)}</Dato>
              <Dato etiqueta="Saldo de cierre">{money(fila.saldoCierreReal)}</Dato>
              <Dato etiqueta="Cierre en USD" className="text-emerald-700">${money(fila.saldoCierreUsd)}</Dato>
            </dl>
            {Number.isFinite(diferencia) && diferencia !== 0 && (
              <p className="mt-2 font-semibold text-amber-800">Diferencia de {money(diferencia)} {fila.moneda}: {fila.motivoCierre || 'sin motivo registrado'}</p>
            )}
          </article>
        )
      })}
    </div>
  )
}

export default function HistorialCierresFinanzas() {
  const { data: cierres, isLoading, isError, error } = useHistorialCierres()
  const [abierto, setAbierto] = useState(null)
  const [generando, setGenerando] = useState(null)
  const [aviso, setAviso] = useState('')
  const [reabriendo, setReabriendo] = useState(null)
  const reabrir = useReabrirCierre()
  // Solo el mes anterior puede reabrirse (el servidor además exige que el siguiente no esté abierto).
  const mesReabrible = mesAnteriorIso(`${isoToday().slice(0, 7)}-01`)

  // Solo PDF. Resumido = saldos por cuenta; detallado = además todos los movimientos del mes.
  async function descargar(periodo, detallado) {
    const id = `${periodo.mes}:${detallado}`
    setGenerando(id)
    setAviso('')
    try {
      // Ambos reportes usan la estructura del reporte de movimientos: saldo de apertura,
      // qué entró y qué se gastó, desglosado por categoría; el detallado añade cada movimiento.
      const movimientos = await cargarMovimientosCierre(periodo.mes)
      await generarFinanzasResumenPDF({
        movimientos, resumen: { tipoFiltro: '' }, rango: { desde: periodo.mes, hasta: periodo.hasta },
        tipoReporte: detallado ? 'completo' : 'resumido', cierre: periodo, action: 'download',
      })
    } catch (cause) {
      setAviso(cause?.message || 'No se pudo generar la descarga de ese cierre.')
    } finally {
      setGenerando(null)
    }
  }

  return (
    <section aria-label="Historial de cierres" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
      <div className="flex items-center gap-2.5">
        <History size={18} className="shrink-0 text-slate-500" />
        <div>
          <h2 className="text-base font-black tracking-tight text-slate-900">Historial de cierres</h2>
          <p className="text-xs font-medium text-slate-500">Cada cierre queda guardado con todos sus movimientos: descárgalo en PDF resumido (saldos por cuenta) o detallado (más cada movimiento del mes).</p>
        </div>
      </div>

      {isLoading && <p role="status" className="text-sm text-slate-500">Cargando cierres…</p>}
      {isError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">{error?.message || 'No se pudo cargar el historial de cierres.'}</p>}
      {aviso && <p role="status" className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{aviso}</p>}
      {!isLoading && !isError && cierres?.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Todavía no hay meses cerrados.</p>
      )}

      {(cierres || []).map(periodo => {
        const expandido = abierto === periodo.mes
        return (
          <div key={periodo.mes} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => setAbierto(expandido ? null : periodo.mes)}
                aria-expanded={expandido}
                className="flex min-h-11 flex-1 items-center gap-2 text-left"
              >
                <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${expandido ? 'rotate-180' : ''}`} />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-bold text-slate-900"><LockKeyhole size={13} className="text-slate-500" />{nombreMes(periodo.mes)}</span>
                  <span className="block text-xs text-slate-500">Cerrado el {cerradoEl(periodo.cerradoEn)} · {(periodo.cuentas || []).length} cuenta(s)</span>
                </span>
              </button>
              <div className="flex flex-wrap items-center gap-1.5">
                {periodo.mes === mesReabrible && (
                  <button
                    type="button"
                    onClick={() => setReabriendo(periodo)}
                    className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-900 shadow-xs hover:bg-amber-100 sm:flex-initial"
                  >
                    <Undo2 size={14} />
                    Reabrir mes
                  </button>
                )}
                {[[false, 'PDF resumido'], [true, 'PDF detallado']].map(([detallado, etiqueta]) => {
                  const id = `${periodo.mes}:${detallado}`
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => descargar(periodo, detallado)}
                      disabled={generando !== null}
                      aria-label={`Descargar ${etiqueta} de ${nombreMes(periodo.mes)}`}
                      className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-60 sm:flex-initial"
                    >
                      <FileText size={14} className="text-primary" />
                      {generando === id ? 'Generando…' : etiqueta}
                    </button>
                  )
                })}
              </div>
            </div>
            {expandido && <DetalleCierre periodo={periodo} />}
          </div>
        )
      })}
      {reabriendo && (
        <ReabrirCierreDialog
          mes={nombreMes(reabriendo.mes)}
          pending={reabrir.isPending}
          onClose={() => setReabriendo(null)}
          onConfirm={motivo => reabrir.mutate({ mesInicio: reabriendo.mes, motivo }, { onSuccess: () => setReabriendo(null) })}
        />
      )}
    </section>
  )
}
