// src/components/nomina/PeriodoDetalleModal.jsx
// Tabla y gestión completa de recibos del período: horas, montos, ajustes y pagos.
// Regla: Moneda principal es SIEMPRE USD ($) y secundaria es Bs (calculada según la tasa activa).
import { useState, useMemo } from 'react'
import { FileText, Pencil, RotateCcw, Wallet, CheckCircle2, DollarSign, Users, Sparkles } from 'lucide-react'
import { useNominaLineas, useRevertirPagoLinea } from '../../hooks/useNomina'
import useMonedaNomina, { formatBs, formatUsd } from '../../hooks/useMonedaNomina.js'
import { useConfigNegocio } from '../../../compat/hooks/useConfigNegocio.js'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import HorizontalScroll from '../../../compat/components/ui/HorizontalScroll.jsx'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import RateSelector from './RateSelector.jsx'
import LiquidacionModal from './LiquidacionModal'
import PagarNominaModal from './PagarNominaModal'
import { logClientError } from '../../../compat/utils/errorLogger.js'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function PeriodoDetalleModal({ periodo, esAdmin, onClose }) {
  const { data: lineas = [], isLoading } = useNominaLineas(periodo.id)
  const { data: configNegocio } = useConfigNegocio()
  const { aBs, fmtBs, tasaActiva, shortLabelTasa } = useMonedaNomina()
  const revertir = useRevertirPagoLinea()

  const [liquidando, setLiquidando]   = useState(null)
  const [pagando, setPagando]         = useState(null)
  const [confirmandoRev, setConfirmandoRev] = useState(null)
  const [exportando, setExportando]   = useState(false)

  const abierto = periodo.estado === 'abierto'

  const totales = useMemo(() => ({
    empleados: lineas.length,
    bruto:  lineas.reduce((s, l) => s + Number(l.total_bruto_usd || 0), 0),
    neto:   lineas.reduce((s, l) => s + Number(l.total_neto_usd  || 0), 0),
    deduc:  lineas.reduce((s, l) => s + Number(l.deducciones_usd || 0), 0),
    bonos:  lineas.reduce((s, l) => s + Number(l.bonos_usd || 0), 0),
    pagados: lineas.filter(l => l.pagado).length,
    pendientes: lineas.filter(l => !l.pagado),
  }), [lineas])

  async function exportarPlanilla() {
    setExportando(true)
    try {
      const { generarNominaResumenPDF } = await import('../../services/pdf/nominaResumenPDF')
      await generarNominaResumenPDF({
        periodo, lineas, config: configNegocio ?? {}, action: 'download',
      })
    } catch (e) {
      logClientError({ mensaje: `Error exportando planilla: ${e?.message || e}`, stack: e?.stack, categoria: 'NOMINA_PDF' })
    } finally {
      setExportando(false)
    }
  }

  async function exportarRecibo(linea) {
    try {
      const { generarNominaReciboPDF } = await import('../../services/pdf/nominaReciboPDF')
      await generarNominaReciboPDF({
        periodo, linea, config: configNegocio ?? {}, action: 'download',
      })
    } catch (e) {
      logClientError({ mensaje: `Error exportando recibo: ${e?.message || e}`, stack: e?.stack, categoria: 'NOMINA_PDF' })
    }
  }

  return (
    <>
      <Modal isOpen onClose={onClose} title={periodo.nombre} className="max-w-5xl">
        <div className="space-y-4">
          {/* KPIs del período (Dual USD + Bs) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3">
              <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Personal</span>
              <span className="text-sm font-black text-slate-800 mt-0.5 block">{totales.empleados} empleados</span>
              <span className="text-[10px] text-slate-500">{totales.pagados} pagado(s) · {totales.pendientes.length} pendiente(s)</span>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3">
              <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Total Bruto (USD)</span>
              <span className="text-sm font-black text-slate-800 mt-0.5 block">${fmt(totales.bruto)}</span>
              <span className="text-[10px] text-emerald-600 font-semibold">+${fmt(totales.bonos)} bonos</span>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3">
              <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">Deducciones (USD)</span>
              <span className="text-sm font-black text-red-600 mt-0.5 block">${fmt(totales.deduc)}</span>
              <span className="text-[10px] text-slate-400">Anticipos y préstamos</span>
            </div>

            <div className="bg-emerald-50/60 border border-emerald-200 rounded-2xl p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-emerald-700 font-bold block uppercase tracking-wider">Neto a Liquidar</span>
                <span className="text-[9px] font-bold text-emerald-600 uppercase">Principal: USD</span>
              </div>
              <span className="text-sm font-black text-emerald-800 mt-0.5 block">${fmt(totales.neto)}</span>
              <span className="text-[11px] text-emerald-700 font-mono font-bold block">
                {fmtBs(totales.neto)}
              </span>
            </div>
          </div>

          {/* Acciones de cabecera */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">
                Progreso: <strong>{totales.pagados}</strong> de {totales.empleados} recibos
              </span>
              <span className="text-slate-300">·</span>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-500 font-medium">Tasa:</span>
                <RateSelector />
              </div>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={exportarPlanilla}
                disabled={exportando || lineas.length === 0}
                className="flex items-center gap-1.5 px-3.5 py-2 min-h-11 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold shadow-sm transition-all disabled:opacity-50"
              >
                <FileText size={14} className="text-rose-600" />
                <span>{exportando ? 'Generando...' : 'Descargar Planilla PDF'}</span>
              </button>

              {esAdmin && !abierto && totales.pendientes.length > 0 && (
                <button
                  onClick={() => setPagando({ lineas: totales.pendientes })}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white text-xs font-bold shadow-md shadow-emerald-950/20 transition-all active:scale-95"
                >
                  <Wallet size={14} />
                  <span>Pagar Recibos Pendientes ({totales.pendientes.length})</span>
                </button>
              )}
            </div>
          </div>

          {abierto && (
            <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-3.5 text-xs text-amber-900 leading-relaxed">
              El período está <strong>abierto</strong>. Puedes ajustar bonos y deducciones; para registrar pagos oficiales cierra el período.
            </div>
          )}

          {/* Tabla de recibos */}
          {isLoading ? (
            <Skeleton className="h-64 rounded-2xl" />
          ) : lineas.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              Aún no se ha calculado la nómina de este período. Pulsa <strong>Calcular</strong> en la pantalla anterior.
            </div>
          ) : (
            <HorizontalScroll contentClassName="bg-white border border-slate-200 rounded-2xl shadow-sm">
              <table className="w-full min-w-[920px] text-xs" aria-label="Detalle de recibos del período">
                <thead className="bg-slate-50/80 text-slate-500 text-[10px] uppercase tracking-wider border-b border-slate-100">
                  <tr>
                    <th className="text-left px-3.5 py-3 font-black">Empleado</th>
                    <th className="text-right px-2.5 py-3 font-bold">Días</th>
                    <th className="text-right px-2.5 py-3 font-bold">Horas</th>
                    <th className="text-right px-2.5 py-3 font-bold">H. Extra</th>
                    <th className="text-right px-2.5 py-3 font-bold">Base ($)</th>
                    <th className="text-right px-2.5 py-3 font-bold">Recargos</th>
                    <th className="text-right px-2.5 py-3 font-bold">Bonos</th>
                    <th className="text-right px-2.5 py-3 font-bold">Deduc.</th>
                    <th className="text-right px-3 py-3 font-black">Neto (USD / Bs)</th>
                    <th className="text-right px-3 py-3 font-bold">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lineas.map(l => {
                    const recargos = Number(l.monto_extra_usd || 0)
                                   + Number(l.monto_sabado_usd || 0)
                                   + Number(l.monto_feriado_usd || 0)
                    return (
                      <tr key={l.id} className={`transition-colors ${l.pagado ? 'bg-emerald-50/20 hover:bg-emerald-50/30' : 'hover:bg-slate-50/60'}`}>
                        <td className="px-3.5 py-2.5">
                          <div className="font-bold text-slate-800 flex items-center gap-1.5">
                            <span>{l.empleado?.nombre || '—'}</span>
                            {l.pagado && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[9px] font-black">
                                <CheckCircle2 size={10} className="text-emerald-700" />
                                Pagado
                              </span>
                            )}
                          </div>
                          {l.cargo_snap && <div className="text-[10px] text-slate-400 font-medium">{l.cargo_snap}</div>}
                          {l.dias_ausencia > 0 && (
                            <div className="text-[10px] text-red-500 font-bold">{l.dias_ausencia} falta(s)</div>
                          )}
                        </td>
                        <td className="text-right px-2.5 py-2.5 text-slate-700 font-semibold">{Number(l.dias_trabajados)}</td>
                        <td className="text-right px-2.5 py-2.5 text-slate-500">{Number(l.horas_normales).toFixed(1)}h</td>
                        <td className="text-right px-2.5 py-2.5 font-bold">
                          {Number(l.horas_extra) > 0 ? (
                            <span className="text-amber-700">+{Number(l.horas_extra).toFixed(1)}h</span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="text-right px-2.5 py-2.5 text-slate-700 font-medium">${fmt(l.monto_normal_usd)}</td>
                        <td className="text-right px-2.5 py-2.5 text-slate-700 font-medium">
                          {recargos > 0 ? `$${fmt(recargos)}` : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="text-right px-2.5 py-2.5 font-bold">
                          {Number(l.bonos_usd) > 0 ? (
                            <span className="text-emerald-600">+${fmt(l.bonos_usd)}</span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="text-right px-2.5 py-2.5 font-bold">
                          {Number(l.deducciones_usd) > 0 ? (
                            <span className="text-red-500">-${fmt(l.deducciones_usd)}</span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="text-right px-3 py-2.5 font-black text-slate-900 text-xs">
                          <div>${fmt(l.total_neto_usd)}</div>
                          <div className="text-[10px] text-slate-400 font-mono font-normal">
                            {fmtBs(l.total_neto_usd)}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => exportarRecibo(l)}
                              title="Descargar Recibo PDF"
                              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            >
                              <FileText size={15} />
                            </button>

                            {esAdmin && abierto && !l.pagado && (
                              <button
                                onClick={() => setLiquidando(l)}
                                title="Ajustar Bonos y Deducciones"
                                className="p-1.5 rounded-lg text-slate-500 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                              >
                                <Pencil size={15} />
                              </button>
                            )}

                            {esAdmin && !abierto && !l.pagado && (
                              <button
                                onClick={() => setPagando({ lineas: [l] })}
                                className="px-2.5 py-1 rounded-lg bg-primary hover:bg-primary-hover text-white text-[11px] font-bold shadow-sm transition-all active:scale-95"
                              >
                                Pagar
                              </button>
                            )}

                            {esAdmin && l.pagado && (
                              confirmandoRev === l.id ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={async () => { await revertir.mutateAsync(l.id); setConfirmandoRev(null) }}
                                    disabled={revertir.isPending}
                                    className="px-2 py-0.5 rounded-lg bg-red-600 text-white text-[10px] font-bold disabled:opacity-50"
                                  >
                                    ¿Confirmar?
                                  </button>
                                  <button
                                    onClick={() => setConfirmandoRev(null)}
                                    className="px-1.5 py-0.5 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-bold"
                                  >
                                    No
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmandoRev(l.id)}
                                  title="Revertir Pago"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                >
                                  <RotateCcw size={14} />
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {/* Fila consolidada de totales */}
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-3.5 py-3 font-black text-slate-800">Total Período</td>
                    <td colSpan={5} />
                    <td className="text-right px-2.5 py-3 font-black text-emerald-700">
                      +${fmt(totales.bonos)}
                    </td>
                    <td className="text-right px-2.5 py-3 font-black text-red-600">
                      -${fmt(totales.deduc)}
                    </td>
                    <td className="text-right px-3 py-3 font-black text-emerald-800 text-sm">
                      <div>${fmt(totales.neto)}</div>
                      <div className="text-[10px] text-emerald-700 font-mono font-bold">
                        {fmtBs(totales.neto)}
                      </div>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </HorizontalScroll>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-3 mt-4 border-t border-slate-100">
          <button onClick={onClose}
            className="px-5 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors">
            Cerrar
          </button>
        </div>
      </Modal>

      {liquidando && (
        <LiquidacionModal
          linea={liquidando}
          onClose={() => setLiquidando(null)}
        />
      )}

      {pagando && (
        <PagarNominaModal
          lineas={pagando.lineas}
          periodo={periodo}
          onClose={() => setPagando(null)}
        />
      )}
    </>
  )
}
