// src/components/nomina/PeriodoDetalleModal.jsx
// Tabla completa de recibos del período: horas, montos, ajustes y estado de pago.
import { useState, useMemo } from 'react'
import { FileText, Pencil, RotateCcw, Wallet, CheckCircle2 } from 'lucide-react'
import { useNominaLineas, useRevertirPagoLinea } from '../../hooks/useNomina'
import { useConfigNegocio } from '../../../compat/hooks/useConfigNegocio.js'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import LiquidacionModal from './LiquidacionModal'
import PagarNominaModal from './PagarNominaModal'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function PeriodoDetalleModal({ periodo, esAdmin, onClose }) {
  const { data: lineas = [], isLoading } = useNominaLineas(periodo.id)
  const { data: configNegocio } = useConfigNegocio()
  const revertir = useRevertirPagoLinea()

  const [liquidando, setLiquidando]   = useState(null)  // línea a ajustar
  const [pagando, setPagando]         = useState(null)  // { lineas: [] }
  const [confirmandoRev, setConfirmandoRev] = useState(null)
  const [exportando, setExportando]   = useState(false)

  const abierto = periodo.estado === 'abierto'

  const totales = useMemo(() => ({
    empleados: lineas.length,
    bruto:  lineas.reduce((s, l) => s + Number(l.total_bruto_usd || 0), 0),
    neto:   lineas.reduce((s, l) => s + Number(l.total_neto_usd  || 0), 0),
    deduc:  lineas.reduce((s, l) => s + Number(l.deducciones_usd || 0), 0),
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
      console.error('[PeriodoDetalle] exportarPlanilla error:', e)
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
      console.error('[PeriodoDetalle] exportarRecibo error:', e)
    }
  }

  return (
    <>
      <Modal isOpen onClose={onClose} title={periodo.nombre} className="max-w-5xl">
        <div className="space-y-4">
          {/* KPIs del período */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {[
              { label: 'Empleados',   value: totales.empleados,          cls: 'text-slate-800' },
              { label: 'Total bruto', value: `$${fmt(totales.bruto)}`,   cls: 'text-slate-800' },
              { label: 'Deducciones', value: `$${fmt(totales.deduc)}`,   cls: 'text-red-500' },
              { label: 'Total neto',  value: `$${fmt(totales.neto)}`,    cls: 'text-amber-600' },
            ].map(k => (
              <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-2.5">
                <div className="text-[10px] text-slate-500 font-medium">{k.label}</div>
                <div className={`text-sm font-black mt-0.5 ${k.cls}`}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Acciones del período */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-500">
              {totales.pagados} de {totales.empleados} recibo(s) pagados
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button onClick={exportarPlanilla} disabled={exportando || lineas.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold">
                <FileText size={12} />
                {exportando ? 'Generando...' : 'Planilla PDF'}
              </button>

              {esAdmin && !abierto && totales.pendientes.length > 0 && (
                <button onClick={() => setPagando({ lineas: totales.pendientes })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-bold">
                  <Wallet size={12} />
                  Pagar todo ({totales.pendientes.length})
                </button>
              )}
            </div>
          </div>

          {abierto && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
              El período está <strong>abierto</strong>. Cierra el período para habilitar el pago de recibos.
            </div>
          )}

          {/* Tabla de recibos */}
          {isLoading ? (
            <Skeleton className="h-64 rounded-xl" />
          ) : lineas.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              Aún no se ha calculado la nómina de este período.
            </div>
          ) : (
            <>
              <p className="sm:hidden text-[11px] text-slate-400 px-1">
                Desliza horizontalmente para consultar todos los conceptos del recibo.
              </p>
              <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
              <table className="w-full min-w-[900px] text-xs" aria-label="Detalle de recibos del período">
                <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Empleado</th>
                    <th className="text-right px-2 py-2 font-semibold">Días</th>
                    <th className="text-right px-2 py-2 font-semibold">H. Norm</th>
                    <th className="text-right px-2 py-2 font-semibold">H. Extra</th>
                    <th className="text-right px-2 py-2 font-semibold">Base</th>
                    <th className="text-right px-2 py-2 font-semibold">Recargos</th>
                    <th className="text-right px-2 py-2 font-semibold">Bonos</th>
                    <th className="text-right px-2 py-2 font-semibold">Deduc.</th>
                    <th className="text-right px-3 py-2 font-semibold">Neto</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map(l => {
                    const recargos = Number(l.monto_extra_usd || 0)
                                   + Number(l.monto_sabado_usd || 0)
                                   + Number(l.monto_feriado_usd || 0)
                    return (
                      <tr key={l.id} className={`border-t border-slate-100 ${l.pagado ? 'bg-green-50/40' : 'hover:bg-slate-50/50'}`}>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                            {l.empleado?.nombre || '—'}
                            {l.pagado && <CheckCircle2 size={11} className="text-green-600 shrink-0" />}
                          </div>
                          {l.cargo_snap && <div className="text-[10px] text-slate-400">{l.cargo_snap}</div>}
                          {l.dias_ausencia > 0 && (
                            <div className="text-[10px] text-red-500 font-medium">{l.dias_ausencia} falta(s)</div>
                          )}
                        </td>
                        <td className="text-right px-2 py-2 text-slate-600">{Number(l.dias_trabajados)}</td>
                        <td className="text-right px-2 py-2 text-slate-500">{Number(l.horas_normales).toFixed(1)}</td>
                        <td className="text-right px-2 py-2 text-amber-600 font-semibold">
                          {Number(l.horas_extra) > 0 ? Number(l.horas_extra).toFixed(1) : '—'}
                        </td>
                        <td className="text-right px-2 py-2 text-slate-600">${fmt(l.monto_normal_usd)}</td>
                        <td className="text-right px-2 py-2 text-slate-600">
                          {recargos > 0 ? `$${fmt(recargos)}` : '—'}
                        </td>
                        <td className="text-right px-2 py-2 text-green-600">
                          {Number(l.bonos_usd) > 0 ? `$${fmt(l.bonos_usd)}` : '—'}
                        </td>
                        <td className="text-right px-2 py-2 text-red-500">
                          {Number(l.deducciones_usd) > 0 ? `$${fmt(l.deducciones_usd)}` : '—'}
                        </td>
                        <td className="text-right px-3 py-2 font-black text-slate-800">${fmt(l.total_neto_usd)}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center justify-end gap-0.5">
                            <button onClick={() => exportarRecibo(l)} title="Recibo PDF"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                              <FileText size={12} />
                            </button>

                            {esAdmin && abierto && !l.pagado && (
                              <button onClick={() => setLiquidando(l)} title="Ajustar bonos/deducciones"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors">
                                <Pencil size={12} />
                              </button>
                            )}

                            {esAdmin && !abierto && !l.pagado && (
                              <button onClick={() => setPagando({ lineas: [l] })} title="Pagar este recibo"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors">
                                <Wallet size={12} />
                              </button>
                            )}

                            {esAdmin && l.pagado && (
                              confirmandoRev === l.id ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={async () => { await revertir.mutateAsync(l.id); setConfirmandoRev(null) }}
                                    disabled={revertir.isPending}
                                    className="px-1.5 py-0.5 rounded bg-red-500 hover:bg-red-600 text-white text-[9px] font-bold disabled:opacity-50">
                                    ¿Sí?
                                  </button>
                                  <button onClick={() => setConfirmandoRev(null)}
                                    className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[9px] font-bold">
                                    No
                                  </button>
                                </div>
                              ) : (
                                <button onClick={() => setConfirmandoRev(l.id)} title="Revertir pago"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                                  <RotateCcw size={12} />
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}

                  {/* Totales */}
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td className="px-3 py-2 font-black text-slate-700">Total</td>
                    <td colSpan={5} />
                    <td className="text-right px-2 py-2 font-bold text-green-700">
                      ${fmt(lineas.reduce((s, l) => s + Number(l.bonos_usd || 0), 0))}
                    </td>
                    <td className="text-right px-2 py-2 font-bold text-red-600">${fmt(totales.deduc)}</td>
                    <td className="text-right px-3 py-2 font-black text-amber-700">${fmt(totales.neto)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end pt-3 mt-3 border-t border-slate-100">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50">
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
