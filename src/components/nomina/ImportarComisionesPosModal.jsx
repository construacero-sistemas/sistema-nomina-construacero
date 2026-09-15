// src/components/nomina/ImportarComisionesPosModal.jsx
// Importación automática de comisiones de vendedores desde el sistema POS a la nómina del período.
import { useState, useMemo } from 'react'
import {
  ShoppingBag,
  DollarSign,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  RefreshCw,
  FileSpreadsheet,
  CheckSquare,
  Square,
  ArrowRight,
  Info,
} from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { usePreviewComisionesPos, useAplicarComisionesPos } from '../../hooks/useNomina.js'
import useMonedaNomina, { formatUsd } from '../../hooks/useMonedaNomina.js'

function fmt(n) {
  return (Number(n) || 0).toLocaleString('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function ImportarComisionesPosModal({ periodo, onClose, onSuccess }) {
  const { data, isLoading, isError, error, refetch } = usePreviewComisionesPos(periodo?.id)
  const aplicarMut = useAplicarComisionesPos()
  const { fmtBs, shortLabelTasa } = useMonedaNomina()

  const empleados = data?.empleados || []

  // Mapa de modificaciones de selecciones de despachos por empleado: { [empleadoId]: Set(despachoId) }
  const [seleccionadosPorEmpleado, setSeleccionadosPorEmpleado] = useState({})
  const [desplegados, setDesplegados] = useState(new Set())
  const [errorLocal, setErrorLocal] = useState('')

  // Helper para obtener el Set de despachos seleccionados para un empleado
  function getSelectedSet(emp) {
    if (seleccionadosPorEmpleado[emp.empleado_id] !== undefined) {
      return seleccionadosPorEmpleado[emp.empleado_id]
    }
    if (emp.tiene_linea_nomina && !emp.pagado && Array.isArray(emp.despachos)) {
      return new Set(emp.despachos.map(d => d.id))
    }
    return new Set()
  }

  // Toggle expansión de detalles de despachos
  function toggleDesplegado(empId) {
    setDesplegados(prev => {
      const next = new Set(prev)
      if (next.has(empId)) next.delete(empId)
      else next.add(empId)
      return next
    })
  }

  // Toggle selección de un despacho específico
  function toggleDespacho(emp, despachoId) {
    const current = new Set(getSelectedSet(emp))
    if (current.has(despachoId)) {
      current.delete(despachoId)
    } else {
      current.add(despachoId)
    }
    setSeleccionadosPorEmpleado(prev => ({ ...prev, [emp.empleado_id]: current }))
  }

  // Toggle todos los despachos de un empleado
  function toggleTodosEmpleado(emp) {
    const current = getSelectedSet(emp)
    const allIds = (emp.despachos || []).map(d => d.id)
    const allSelected = allIds.length > 0 && allIds.every(id => current.has(id))

    setSeleccionadosPorEmpleado(prev => ({
      ...prev,
      [emp.empleado_id]: allSelected ? new Set() : new Set(allIds),
    }))
  }

  // Cálculos de totales seleccionados
  const { totalSeleccionadoUsd, resumenAplicaciones, totalDespachosSeleccionados } = useMemo(() => {
    let totalUsd = 0
    let countDespachos = 0
    const apps = []

    for (const emp of empleados) {
      if (!emp.tiene_linea_nomina || emp.pagado) continue
      const selectedIds = seleccionadosPorEmpleado[emp.empleado_id] !== undefined
        ? seleccionadosPorEmpleado[emp.empleado_id]
        : (Array.isArray(emp.despachos) ? new Set(emp.despachos.map(d => d.id)) : new Set())
      const despachosElegidos = (emp.despachos || []).filter(d => selectedIds.has(d.id))
      const subtotal = despachosElegidos.reduce((sum, d) => sum + (Number(d.monto_usd) || 0), 0)

      if (despachosElegidos.length > 0 || emp.comisiones_actuales_usd > 0) {
        apps.push({
          empleadoId: emp.empleado_id,
          comisionesUsd: Math.round(subtotal * 10000) / 10000,
          despachosIds: despachosElegidos.map(d => d.id),
        })
      }

      totalUsd += subtotal
      countDespachos += despachosElegidos.length
    }

    return {
      totalSeleccionadoUsd: Math.round(totalUsd * 100) / 100,
      totalDespachosSeleccionados: countDespachos,
      resumenAplicaciones: apps,
    }
  }, [empleados, seleccionadosPorEmpleado])

  async function handleConfirmar(e) {
    if (e) e.preventDefault()
    setErrorLocal('')

    if (!resumenAplicaciones.length && totalSeleccionadoUsd === 0) {
      setErrorLocal('No has seleccionado ningún despacho para aplicar.')
      return
    }

    try {
      await aplicarMut.mutateAsync({
        periodoId: periodo.id,
        aplicaciones: resumenAplicaciones,
      })
      if (onSuccess) onSuccess()
      onClose()
    } catch (err) {
      setErrorLocal(err.message || 'Error al aplicar comisiones a la nómina')
    }
  }

  const cargando = aplicarMut.isPending

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Importar Comisiones de Vendedores (POS)"
      className="max-w-3xl"
    >
      <div className="space-y-4">
        {/* Cabecera institucional con información del período */}
        <div
          className="rounded-2xl p-4 text-white relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #1B365D 0%, #2a4d7a 100%)',
          }}
        >
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
              backgroundSize: '12px 12px',
            }}
          />
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-white/15 border border-white/20">
                  <ShoppingBag size={18} className="text-amber-300" />
                </span>
                <div>
                  <h3 className="text-sm font-black tracking-wide">
                    {periodo?.nombre || 'Período en curso'}
                  </h3>
                  <p className="text-[11px] text-slate-200 flex items-center gap-1 mt-0.5">
                    <Calendar size={12} />
                    {periodo?.desde} al {periodo?.hasta}
                  </p>
                </div>
              </div>
            </div>

            <div className="text-left sm:text-right bg-white/10 rounded-xl px-3.5 py-2 border border-white/15">
              <span className="text-[10px] text-slate-200 font-bold block uppercase tracking-wider">
                Total Seleccionado
              </span>
              <strong className="text-lg font-black text-white block leading-tight">
                ${fmt(totalSeleccionadoUsd)} USD
              </strong>
              <span className="text-[11px] text-amber-200 font-mono block">
                ~ {fmtBs(totalSeleccionadoUsd)} ({shortLabelTasa})
              </span>
            </div>
          </div>
        </div>

        {/* Mensajes de error */}
        {(errorLocal || isError) && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 text-xs text-red-800 flex items-start gap-2">
            <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold">Error de sincronización</p>
              <p className="mt-0.5">{errorLocal || error?.message || 'Error consultando comisiones del POS'}</p>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="text-red-700 font-bold underline hover:text-red-900 shrink-0"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Explicación de la fuente de comisiones */}
        <div className="rounded-xl border border-sky-200/80 bg-sky-50/60 p-3 text-xs text-sky-900 flex items-start gap-2.5">
          <Info size={16} className="text-sky-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <p className="font-bold">Comisiones liberadas por ventas y cobranzas</p>
            <p className="text-sky-800 text-[11px] mt-0.5">
              Se muestran los despachos pagados de contado o mediante cobro de facturas/abonos registrados en el POS durante las fechas del período. Al confirmar, se incorporarán directamente en el recibo de cada vendedor.
            </p>
          </div>
        </div>

        {/* Contenido principal */}
        {isLoading ? (
          <div className="py-12 text-center text-slate-400 space-y-3">
            <RefreshCw size={24} className="animate-spin mx-auto text-primary" />
            <p className="text-xs font-semibold">Consultando liberaciones en el POS...</p>
          </div>
        ) : empleados.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center space-y-2">
            <ShoppingBag size={32} className="mx-auto text-slate-300" />
            <h4 className="text-sm font-bold text-slate-700">No hay vendedores del POS vinculados</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Para importar comisiones automáticamente, primero vincula a los empleados en el catálogo de personal con su usuario vendedor correspondiente en el POS.
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {empleados.map(emp => {
              const selectedSet = getSelectedSet(emp)
              const countSelected = selectedSet.size
              const countTotal = emp.despachos_count || 0
              const isExpanded = desplegados.has(emp.empleado_id)
              const subtotalEmp = (emp.despachos || [])
                .filter(d => selectedSet.has(d.id))
                .reduce((s, d) => s + (Number(d.monto_usd) || 0), 0)

              return (
                <div
                  key={emp.empleado_id}
                  className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs transition-all"
                >
                  {/* Fila principal del empleado */}
                  <div className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70 border-b border-slate-100">
                    <div className="flex items-center gap-3 min-w-0">
                      {emp.tiene_linea_nomina && !emp.pagado ? (
                        <button
                          type="button"
                          onClick={() => toggleTodosEmpleado(emp)}
                          style={{ touchAction: 'manipulation' }}
                          className="min-h-11 min-w-11 flex items-center justify-center text-primary hover:text-primary-hover transition-colors shrink-0"
                          title={countSelected === countTotal ? 'Desmarcar todos' : 'Seleccionar todos'}
                        >
                          {countSelected === countTotal && countTotal > 0 ? (
                            <CheckSquare size={20} className="text-primary" />
                          ) : countSelected > 0 ? (
                            <div className="w-5 h-5 rounded-md bg-primary/20 border-2 border-primary flex items-center justify-center">
                              <div className="w-2.5 h-2.5 bg-primary rounded-xs" />
                            </div>
                          ) : (
                            <Square size={20} className="text-slate-400" />
                          )}
                        </button>
                      ) : (
                        <div className="w-8 h-8 flex items-center justify-center text-slate-300 shrink-0">
                          <Square size={20} />
                        </div>
                      )}

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-black text-slate-800 truncate" title={emp.nombre}>
                            {emp.nombre}
                          </p>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700 shrink-0">
                            {emp.cargo || 'Vendedor'}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                          <span>{countTotal} ticket{countTotal !== 1 ? 's' : ''} en POS</span>
                          {emp.comisiones_actuales_usd > 0 && (
                            <span className="text-emerald-700 font-bold">
                              (Ya aplicado: ${fmt(emp.comisiones_actuales_usd)})
                            </span>
                          )}
                          {!emp.tiene_linea_nomina && (
                            <span className="text-amber-700 font-bold bg-amber-100 px-1.5 py-0.5 rounded-sm">
                              Sin calcular en nómina
                            </span>
                          )}
                          {emp.pagado && (
                            <span className="text-slate-600 font-bold bg-slate-200 px-1.5 py-0.5 rounded-sm">
                              Recibo ya pagado
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pl-11 sm:pl-0">
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 font-bold block uppercase">
                          A Importar
                        </span>
                        <span className="text-sm font-black text-emerald-700 font-mono">
                          ${fmt(subtotalEmp)} USD
                        </span>
                      </div>

                      {countTotal > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleDesplegado(emp.empleado_id)}
                          style={{ touchAction: 'manipulation' }}
                          className="min-h-11 min-w-11 flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors shrink-0"
                          title={isExpanded ? 'Ocultar despachos' : 'Ver despachos'}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Detalle desplegable de despachos */}
                  {isExpanded && countTotal > 0 && (
                    <div className="p-3 bg-white space-y-2">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-1">
                        Desglose de notas de despacho liberadas:
                      </div>
                      <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden text-xs">
                        {emp.despachos.map(desp => {
                          const isChecked = selectedSet.has(desp.id)
                          return (
                            <label
                              key={desp.id}
                              className={`min-h-11 flex items-center justify-between p-2.5 cursor-pointer hover:bg-slate-50 transition-colors ${
                                isChecked ? 'bg-sky-50/40' : ''
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleDespacho(emp, desp.id)}
                                  disabled={!emp.tiene_linea_nomina || emp.pagado || cargando}
                                  className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary shrink-0"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <strong className="text-slate-800 font-bold">
                                      {desp.despacho_numero}
                                    </strong>
                                    <span className="text-[10px] font-semibold text-slate-500 truncate">
                                      {desp.cliente_nombre}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                                    <span>Fecha: {desp.fecha || desp.creado_en?.slice(0, 10)}</span>
                                    <span className="capitalize">Tipo: {desp.tipo}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="text-right shrink-0 pl-2">
                                <span className="font-black text-slate-800 font-mono text-xs">
                                  ${fmt(desp.monto_usd)}
                                </span>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Footer del Modal */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-100">
          <div className="text-xs text-slate-500 text-center sm:text-left">
            <span>{totalDespachosSeleccionados} despacho(s) seleccionado(s)</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={cargando}
              style={{ touchAction: 'manipulation' }}
              className="min-h-11 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-50 transition-colors w-full sm:w-auto"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmar}
              disabled={cargando || (totalSeleccionadoUsd === 0 && !resumenAplicaciones.length)}
              style={{ touchAction: 'manipulation' }}
              className="min-h-11 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all active:scale-95 flex items-center justify-center gap-2 w-full sm:w-auto"
            >
              {cargando ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Aplicando...</span>
                </>
              ) : (
                <>
                  <Check size={14} />
                  <span>Aplicar a Nómina (${fmt(totalSeleccionadoUsd)} USD)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
