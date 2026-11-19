// src/components/nomina/PeriodoDetalleModal.jsx
// Tabla y gestión completa de recibos del período: horas, montos, ajustes y pagos.
// Regla: Moneda principal es SIEMPRE USD ($) y secundaria es Bs (calculada según la tasa activa).
import { useState, useMemo } from 'react'
import { FileText, Pencil, RotateCcw, Wallet, CheckCircle2, DollarSign, Users, Sparkles, ShoppingBag } from 'lucide-react'
import { useNominaLineas, useReabrirPeriodo, useRevertirPagoLinea, useTasasPeriodo } from '../../hooks/useNomina'
import useMonedaNomina, { formatBs, formatUsd } from '../../hooks/useMonedaNomina.js'
import { useConfigNegocio } from '../../../compat/hooks/useConfigNegocio.js'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import HorizontalScroll from '../../../compat/components/ui/HorizontalScroll.jsx'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import RateSelector from './RateSelector.jsx'
import useAuthStore from '../../../compat/store/useAuthStore.js'
import { tieneCapacidad } from '../../config/accesoModulos.js'
import LiquidacionModal from './LiquidacionModal'
import HojaSemanal from './HojaSemanal.jsx'
import PagarNominaModal from './PagarNominaModal'
import ImportarComisionesPosModal from './ImportarComisionesPosModal.jsx'
import { VENDEDORES_EN_NOMINA } from '../../config/comisionesVendedores.js'
import { logClientError } from '../../../compat/utils/errorLogger.js'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'
import useReglasLey from '../../hooks/useReglasLey.js'
import useAutoCalculoPeriodo from '../../hooks/useAutoCalculoPeriodo.js'

import { ResumenDato, ReciboMovilCard, EstadoAutoCalculo } from './PeriodoDetallePartes.jsx'
import { fmt, textoDias, revertible } from './periodoDetalleUtils.js'

// Todo lo que este modal puede hacer sobre la base es escritura, así que no existe un
// gate de lectura propio: cada acción usa la capacidad de su endpoint — `administrarNomina`
// para ajustar bonos/deducciones, importar comisiones, cerrar o reabrir; `operarFinanzas`
// para pagar o revertir un pago. Ver recibos, totales y descargar PDFs no requiere ninguna.
export default function PeriodoDetalleModal({ periodo, puedeGestionarNomina = false, puedePagarNomina = false, onClose }) {
  const { divisorMensual } = useReglasLey()
  const { data: lineas = [], isLoading, isError, refetch } = useNominaLineas(periodo.id)
  const { data: configNegocio } = useConfigNegocio()
  // Regla del usuario (19/11/2026): quien no es jefe (rol nómina) no cambia la tasa
  // general; aquí elige una tasa SOLO PARA SÍ con la que se calculan los recibos y la
  // hoja semanal. El jefe sigue usando la tasa general de Nómina.
  const perfil = useAuthStore(state => state.perfil)
  const tasaPersonal = !tieneCapacidad(perfil, 'administrarSistema')
  const { aBs, fmtBs, tasaActiva, shortLabelTasa, tipoTasa } = useMonedaNomina({ ambito: tasaPersonal ? 'personal' : 'nomina' })
  const revertir = useRevertirPagoLinea()
  const reabrir = useReabrirPeriodo()
  const [confirmandoReabrir, setConfirmandoReabrir] = useState(false)
  const [exportandoTodos, setExportandoTodos] = useState(false)

  const [liquidando, setLiquidando]   = useState(null)
  const [pagando, setPagando]         = useState(null)
  const [confirmandoRev, setConfirmandoRev] = useState(null)
  const [motivoReversion, setMotivoReversion] = useState('')
  const [errorReversion, setErrorReversion] = useState('')
  const [pagina, setPagina] = useState(1)
  const totalPaginas = Math.max(1, Math.ceil(lineas.length / 10))
  const paginaActual = Math.min(pagina, totalPaginas)
  const [exportando, setExportando]   = useState(false)
  const [importandoComisiones, setImportandoComisiones] = useState(false)
  // «Recibos» o «Hoja semanal» (docs/PLAN_HOJA_SEMANAL.md): la planilla de la contadora.
  const [vista, setVista] = useState('recibos')

  const abierto = periodo.estado === 'abierto'
  // Mejora del 19/11/2026: al abrir un período abierto, recibos y hoja se ponen al
  // día solos con la asistencia (solo guarda si algo cambió).
  const autoCalculo = useAutoCalculoPeriodo(periodo, puedeGestionarNomina)

  // Tasa congelada al cierre del período: los montos en Bs históricos se muestran
  // tal como quedaron al cerrar, sin que el mercado actual los reescriba.
  const { data: tasasCierre = [] } = useTasasPeriodo(abierto ? null : periodo.id)
  const tasaCongelada = useMemo(() => {
    if (abierto || !tasasCierre.length) return null
    const monedaOrigen = tipoTasa === 'bcv_eur' ? 'EUR' : tipoTasa === 'usdt' ? 'USDT' : 'USD'
    return tasasCierre.find(t => t.moneda_origen === monedaOrigen)
      || tasasCierre.find(t => t.moneda_origen === 'USD')
      || null
  }, [abierto, tasasCierre, tipoTasa])
  // Los vendedores no van en la nómina: «Comis. POS» solo aparece si se reactiva la
  // bandera o si algún recibo antiguo del período trae comisiones (para que cuadre).
  const mostrarComisiones = VENDEDORES_EN_NOMINA || lineas.some(l => Number(l.comisiones_pos_usd) > 0)
  const fmtBsPeriodo = tasaCongelada
    ? (monto) => formatBs((Number(monto) || 0) * (Number(tasaCongelada.valor) || 0))
    : fmtBs
  // Neto en Bs de una fila de la hoja: el congelado al pagar manda; si no, la tasa
  // congelada al cerrar o la activa (las mismas reglas que los recibos). Convierte el
  // neto SIN redondear del recibo, como la pestaña Recibos, para que el Bs coincida.
  const netoReciboUsd = fila => {
    const linea = lineas.find(l => l.id === fila.lineaId)
    return Number(linea ? linea.total_neto_usd : fila.neto) || 0
  }
  // Tasa del período para mostrar bolívares en la hoja y en el recibo: la congelada
  // al cerrar o, con el período abierto, la activa.
  const tasaPeriodo = tasaCongelada ? Number(tasaCongelada.valor) || 0 : (aBs(1) || 0)
  const origenTasaPeriodo = tasaCongelada ? 'cierre' : 'activa'
  const bsDeFilaHoja = fila => (fila.pagado && Number(fila.tasaPago) > 0 && fila.totalPagadoBs != null
    ? Number(fila.totalPagadoBs)
    : netoReciboUsd(fila) * (tasaCongelada ? Number(tasaCongelada.valor) || 0 : (aBs(1) || 0)))

  const totales = useMemo(() => ({
    empleados: lineas.length,
    bruto:  lineas.reduce((s, l) => s + Number(l.total_bruto_usd || 0), 0),
    neto:   lineas.reduce((s, l) => s + Number(l.total_neto_usd  || 0), 0),
    deduc:  lineas.reduce((s, l) => s + Number(l.deducciones_usd || 0), 0),
    bonos:  lineas.reduce((s, l) => s + Number(l.bonos_usd || 0), 0),
    comisiones: lineas.reduce((s, l) => s + Number(l.comisiones_pos_usd || 0), 0),
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

  // Mejora del 19/11/2026: todos los recibos del período en un solo PDF.
  async function exportarTodos() {
    setExportandoTodos(true)
    try {
      const { generarNominaRecibosPeriodoPDF } = await import('../../services/pdf/nominaReciboPDF')
      await generarNominaRecibosPeriodoPDF({
        periodo, lineas, config: configNegocio ?? {}, action: 'download',
        tasa: tasaPeriodo, tasaOrigen: origenTasaPeriodo,
      })
    } catch (e) {
      logClientError({ mensaje: `Error exportando todos los recibos: ${e?.message || e}`, stack: e?.stack, categoria: 'NOMINA_PDF' })
    } finally {
      setExportandoTodos(false)
    }
  }

  async function exportarRecibo(linea) {
    try {
      const { generarNominaReciboPDF } = await import('../../services/pdf/nominaReciboPDF')
      await generarNominaReciboPDF({
        periodo, linea, config: configNegocio ?? {}, action: 'download',
        tasa: tasaPeriodo, tasaOrigen: origenTasaPeriodo,
      })
    } catch (e) {
      logClientError({ mensaje: `Error exportando recibo: ${e?.message || e}`, stack: e?.stack, categoria: 'NOMINA_PDF' })
    }
  }

  if (isError) return <Modal isOpen onClose={onClose} title={periodo.nombre}><div role="alert" className="space-y-3 text-sm text-rose-800"><p>No se pudieron confirmar los recibos del período. No se muestran totales en cero.</p><button type="button" onClick={() => refetch()} className="min-h-11 px-4 py-2 border rounded-xl">Volver a intentar</button></div></Modal>

  return (
    <>
      <Modal isOpen onClose={onClose} title={periodo.nombre} className="max-w-7xl">
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
              <div className="flex flex-wrap gap-1 text-[10px] mt-0.5">
                <span className="text-emerald-600 font-semibold">+{fmt(totales.bonos)} bonos</span>
                {totales.comisiones > 0 && (
                  <span className="text-amber-800 font-semibold">+{fmt(totales.comisiones)} comisiones</span>
                )}
              </div>
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
                {fmtBsPeriodo(totales.neto)}
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
                {tasaCongelada ? (
                  <span
                    title={`Tasa congelada al cierre el ${tasaCongelada.fecha} (${tasaCongelada.fuente})`}
                    className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-black text-emerald-800"
                  >
                    {Number(tasaCongelada.valor).toLocaleString('es-VE')} Bs/$ · cierre
                  </span>
                ) : (
                  <RateSelector light personal={tasaPersonal} />
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              {VENDEDORES_EN_NOMINA && puedeGestionarNomina && abierto && lineas.length > 0 && (
                <button
                  type="button"
                  onClick={() => setImportandoComisiones(true)}
                  style={{ touchAction: 'manipulation' }}
                  className="flex items-center gap-1.5 px-3.5 py-2 min-h-11 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold shadow-xs transition-all active:scale-95"
                  title="Importar comisiones liberadas de vendedores desde el POS"
                >
                  <ShoppingBag size={14} className="text-amber-700" />
                  <span>Importar Comisiones POS</span>
                </button>
              )}

              <button
                onClick={exportarPlanilla}
                disabled={exportando || lineas.length === 0}
                className="flex items-center gap-1.5 px-3.5 py-2 min-h-11 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold shadow-sm transition-all disabled:opacity-50"
              >
                <FileText size={14} className="text-rose-600" />
                <span>{exportando ? 'Generando...' : 'Descargar Planilla PDF'}</span>
              </button>

              <button
                type="button"
                onClick={exportarTodos}
                disabled={exportandoTodos || lineas.length === 0}
                className="flex items-center gap-1.5 px-3.5 py-2 min-h-11 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold shadow-sm transition-all disabled:opacity-50"
              >
                <FileText size={14} className="text-sky-700" />
                <span>{exportandoTodos ? 'Generando...' : 'Todos los recibos PDF'}</span>
              </button>

              {puedeGestionarNomina && periodo.estado === 'pagado' && (
                <button
                  type="button"
                  onClick={() => setConfirmandoReabrir(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 min-h-11 rounded-xl bg-white hover:bg-amber-50 border border-amber-300 text-amber-900 text-xs font-bold shadow-sm transition-all"
                >
                  <RotateCcw size={14} />
                  <span>Reabrir período</span>
                </button>
              )}

              {puedePagarNomina && !abierto && totales.pendientes.length > 0 && (
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
          {tasaCongelada && (
            <div className="bg-emerald-50 border border-emerald-200/80 rounded-2xl p-3.5 text-xs text-emerald-900 leading-relaxed">
              Los montos en Bs de este período usan la tasa congelada al cierre ({Number(tasaCongelada.valor).toLocaleString('es-VE')} Bs/$ · {tasaCongelada.fuente} · {tasaCongelada.fecha}); no cambian con el mercado actual.
            </div>
          )}

          <EstadoAutoCalculo resultado={autoCalculo} />

          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:inline-grid sm:w-auto" role="tablist" aria-label="Vista del período">
            {[['recibos', 'Recibos'], ['hoja', 'Hoja semanal']].map(([id, etiqueta]) => (
              <button key={id} type="button" role="tab" aria-selected={vista === id} onClick={() => setVista(id)}
                className={`min-h-11 rounded-lg px-4 text-xs font-bold transition-all ${vista === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                style={{ touchAction: 'manipulation' }}>{etiqueta}</button>
            ))}
          </div>

          {/* Tabla de recibos */}
          {vista === 'hoja' ? (
            <HojaSemanal
              periodo={periodo}
              lineas={lineas}
              abierto={abierto}
              puedeGestionarNomina={puedeGestionarNomina}
              bsDe={bsDeFilaHoja}
              tasa={tasaPeriodo}
              tasaOrigen={origenTasaPeriodo}
              onAgregarDescuento={setLiquidando}
            />
          ) : isLoading ? (
            <Skeleton className="h-64 rounded-2xl" />
          ) : lineas.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              Aún no se ha calculado la nómina de este período. Pulsa <strong>Calcular</strong> en la pantalla anterior.
            </div>
          ) : (
            <>
              <div className="space-y-2.5 lg:hidden" aria-label="Recibos del período">
                {lineas.slice((paginaActual - 1) * 10, paginaActual * 10).map(linea => (
                  <ReciboMovilCard
                    key={linea.id}
                    linea={linea}
                    abierto={abierto}
                    puedeGestionarNomina={puedeGestionarNomina}
                    puedePagarNomina={puedePagarNomina}
                    fmtBs={fmtBsPeriodo}
                    onDescargar={exportarRecibo}
                    onAjustar={setLiquidando}
                    onPagar={linea => setPagando({ lineas: [linea] })}
                    onRevertir={lineaId => { setConfirmandoRev(lineaId); setMotivoReversion(''); setErrorReversion('') }}
                  />
                ))}
              </div>

              <div className="lg:hidden rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <h3 className="mb-2 text-xs font-black text-slate-700">Total del período</h3>
                <div className="grid grid-cols-3 gap-2">
                  <ResumenDato label="Bruto" value={`$${fmt(totales.bruto)}`} />
                  <ResumenDato label="Deducciones" value={`$${fmt(totales.deduc)}`} />
                  <div className="min-w-0 rounded-lg border border-primary/20 bg-white px-2.5 py-2">
                    <span className="block text-[10px] font-semibold text-primary/75">Neto</span>
                    <span className="block truncate text-xs font-black tabular-nums text-primary">${fmt(totales.neto)}</span>
                    <span className="block truncate text-[10px] font-semibold tabular-nums text-slate-600">{fmtBsPeriodo(totales.neto)}</span>
                  </div>
                </div>
              </div>

              <div className="hidden lg:block">
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
                    {mostrarComisiones && <th className="text-right px-2.5 py-3 font-bold">Comis. POS</th>}
                    <th className="text-right px-2.5 py-3 font-bold">Deduc.</th>
                    <th className="text-right px-3 py-3 font-black">Neto (USD / Bs)</th>
                    <th className="text-right px-3 py-3 font-bold">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lineas.slice((paginaActual - 1) * 10, paginaActual * 10).map(l => {
                    const recargos = Number(l.monto_extra_usd || 0)
                                   + Number(l.monto_sabado_usd || 0)
                                   + Number(l.monto_feriado_usd || 0)
                    return (
                      <tr key={l.id} className={`transition-colors ${l.pagado ? 'bg-emerald-50/20 hover:bg-emerald-50/30' : 'hover:bg-slate-50/60'}`}>
                        <td className="px-3.5 py-2.5">
                          <div className="font-bold text-slate-800 flex items-center gap-1.5">
                            <span>{capitalizarPalabras(l.empleado?.nombre) || '—'}</span>
                            {l.pagado && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[9px] font-black">
                                <CheckCircle2 size={10} className="text-emerald-700" />
                                Pagado
                              </span>
                            )}
                          </div>
                          {l.cargo_snap && <div className="text-[10px] text-slate-400 font-medium">{l.cargo_snap}</div>}
                          <div className="text-[10px] text-slate-400 font-medium">Sueldo mensual: ${fmt(Number(l.salario_dia_usd_snap || 0) * divisorMensual)}</div>
                          {l.dias_ausencia > 0 && (
                            <div className="text-[10px] text-red-500 font-bold">{l.dias_ausencia} falta(s)</div>
                          )}
                        </td>
                        <td className="text-right px-2.5 py-2.5 text-slate-700 font-semibold whitespace-nowrap" title="Días trabajados + días de descanso y feriados pagados (LOTTT art. 119)">{textoDias(l)}</td>
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
                        {mostrarComisiones && <td className="text-right px-2.5 py-2.5 font-bold">
                          {Number(l.comisiones_pos_usd) > 0 ? (
                            <span className="text-amber-800 font-mono" title={`${(l.comisiones_despachos_ids || []).length} despachos liquidados`}>
                              +${fmt(l.comisiones_pos_usd)}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>}
                        <td className="text-right px-2.5 py-2.5 font-bold">
                          {Number(l.deducciones_usd) > 0 ? (
                            <span className="text-red-500">-${fmt(l.deducciones_usd)}</span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="text-right px-3 py-2.5 font-black text-slate-900 text-xs">
                          <div>${fmt(l.total_neto_usd)}</div>
                          {l.pagado && Number(l.tasa_pago_usd_ves) > 0 ? (
                            <div className="text-[10px] text-emerald-700 font-mono font-semibold" title={`Tasa congelada al pagar: ${Number(l.tasa_pago_usd_ves)} Bs/$`}>
                              {Number(l.total_pagado_bs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
                            </div>
                          ) : (
                            <div className="text-[10px] text-slate-400 font-mono font-normal">
                              {fmtBsPeriodo(l.total_neto_usd)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => exportarRecibo(l)}
                              title="Descargar Recibo PDF"
                              aria-label={`Descargar recibo PDF de ${capitalizarPalabras(l.empleado?.nombre) || 'empleado'}`}
                              className="min-h-11 min-w-11 rounded-lg p-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            >
                              <FileText size={15} />
                            </button>

                            {puedeGestionarNomina && abierto && !l.pagado && (
                              <button
                                onClick={() => setLiquidando(l)}
                                title="Ajustar Bonos y Deducciones"
                                className="p-1.5 rounded-lg text-slate-500 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                              >
                                <Pencil size={15} />
                              </button>
                            )}

                            {puedePagarNomina && !abierto && !l.pagado && (
                              <button
                                onClick={() => setPagando({ lineas: [l] })}
                                className="px-2.5 py-1 rounded-lg bg-primary hover:bg-primary-hover text-white text-[11px] font-bold shadow-sm transition-all active:scale-95"
                              >
                                Pagar
                              </button>
                            )}

                            {puedePagarNomina && revertible(l) && <button type="button"
                              onClick={() => { setConfirmandoRev(l.id); setMotivoReversion(''); setErrorReversion('') }}
                              title="Revertir Pago" aria-label="Revertir pago del recibo"
                              className="min-h-11 min-w-11 p-2 rounded-xl text-rose-700 hover:bg-rose-50">
                              <RotateCcw size={18} aria-hidden="true" />
                            </button>}
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
                    {mostrarComisiones && <td className="text-right px-2.5 py-3 font-black text-amber-800">
                      {totales.comisiones > 0 ? `+$${fmt(totales.comisiones)}` : '—'}
                    </td>}
                    <td className="text-right px-2.5 py-3 font-black text-red-600">
                      -${fmt(totales.deduc)}
                    </td>
                    <td className="text-right px-3 py-3 font-black text-emerald-800 text-sm">
                      <div>${fmt(totales.neto)}</div>
                      <div className="text-[10px] text-emerald-700 font-mono font-bold">
                        {fmtBsPeriodo(totales.neto)}
                      </div>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </HorizontalScroll>
              </div>
            </>
          )}
        </div>

        {totalPaginas > 1 && <nav aria-label="Páginas de recibos" className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <button type="button" disabled={paginaActual === 1} onClick={() => setPagina(paginaActual - 1)} className="min-h-11 px-4 border border-slate-300 rounded-xl">Anterior</button>
          <span className="text-sm">Página {paginaActual} de {totalPaginas} · {lineas.length} recibos</span>
          <button type="button" disabled={paginaActual === totalPaginas} onClick={() => setPagina(paginaActual + 1)} className="min-h-11 px-4 border border-slate-300 rounded-xl">Siguiente</button>
        </nav>}
        {/* Footer */}
        <div className="flex justify-end pt-3 mt-4 border-t border-slate-100">
          <button
            onClick={onClose}
            type="button"
            style={{ touchAction: 'manipulation' }}
            className="min-h-11 px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </Modal>

      {confirmandoReabrir && (
        <Modal isOpen title="Reabrir período" onClose={() => setConfirmandoReabrir(false)} busy={reabrir.isPending} className="max-w-md"
          footer={<div className="flex w-full flex-col-reverse gap-2 pb-3 sm:flex-row sm:justify-end sm:pb-4">
            <button type="button" disabled={reabrir.isPending} onClick={() => setConfirmandoReabrir(false)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700">Cancelar</button>
            <button type="button" disabled={reabrir.isPending} onClick={() => reabrir.mutate(periodo.id, { onSuccess: () => { setConfirmandoReabrir(false); onClose() } })} className="min-h-11 rounded-xl bg-amber-700 px-4 text-sm font-black text-white hover:bg-amber-800 disabled:opacity-50">{reabrir.isPending ? 'Reabriendo…' : 'Sí, reabrir'}</button>
          </div>}>
          <p className="text-sm leading-relaxed text-slate-700">
            Se quitará la marca de pagado de todos los recibos de <strong>{periodo.nombre}</strong> y el período volverá a quedar abierto para corregirlo. Úsalo solo si se cerró por error.
          </p>
        </Modal>
      )}
      {confirmandoRev && <Modal isOpen title="Revertir pago del recibo" onClose={() => setConfirmandoRev(null)} busy={revertir.isPending}
        footer={<><button type="button" disabled={revertir.isPending} onClick={() => setConfirmandoRev(null)} className="min-h-11 px-4 py-2 border rounded-xl">Cancelar</button>
          <button type="button" disabled={revertir.isPending || motivoReversion.trim().length < 3} className="min-h-11 px-4 py-2 rounded-xl bg-rose-700 text-white font-bold disabled:opacity-50"
            onClick={async () => { try { await revertir.mutateAsync({ lineaId: confirmandoRev, motivo: motivoReversion.trim() }); setConfirmandoRev(null) } catch (e) { setErrorReversion(e.message) } }}>Confirmar reversión</button></>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-700">Solo se revertirá el asiento de este recibo. Esta acción es contable y no afirma que se hayan recuperado físicamente los fondos.</p>
          <label className="block text-sm font-bold">Motivo de la reversión<input value={motivoReversion} maxLength={300} disabled={revertir.isPending} onChange={e => setMotivoReversion(e.target.value)} className="mt-1 w-full min-h-11 rounded-xl border border-slate-300 px-3 text-base" /></label>
          {errorReversion && <p role="alert" className="text-sm text-rose-800">{errorReversion}</p>}
          {revertir.operationId && <button type="button" disabled={revertir.isPending} className="min-h-11 px-3 py-2 border rounded-xl" onClick={async () => { try { const result = await revertir.checkStatus(); if (result?.estado === 'confirmada') setConfirmandoRev(null) } catch (e) { setErrorReversion(e.message) } }}>Comprobar resultado de la reversión</button>}
        </div>
      </Modal>}

      {VENDEDORES_EN_NOMINA && importandoComisiones && (
        <ImportarComisionesPosModal
          periodo={periodo}
          onClose={() => setImportandoComisiones(false)}
        />
      )}

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
