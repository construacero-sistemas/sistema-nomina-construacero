// src/components/nomina/TabAsistencia.jsx
// Grilla semanal de asistencia por excepción, separada del panel diario de hoy.
import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, CalendarClock, Users, Clock, LogIn, AlertTriangle } from 'lucide-react'
import { useConfigEmpleados, useAsistencia, useFeriados, useConfigNomina, useNominaPeriodos } from '../../hooks/useNomina'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import EmptyState from '../../../compat/components/ui/EmptyState.jsx'
import KpiCard from '../../../compat/components/ui/KpiCard.jsx'
import HorizontalScroll from '../../../compat/components/ui/HorizontalScroll.jsx'
import AsistenciaModal from './AsistenciaModal'
import MarcajeLogisticaPanel from './MarcajeLogisticaPanel'
import AsistenciaDiariaMovil from './AsistenciaDiariaMovil'
import CerrarPeriodoModal from './CerrarPeriodoModal.jsx'
import PeriodoDetalleModal from './PeriodoDetalleModal.jsx'
import { trabajaEseDia } from '../../utils/diasLaborables.js'
import { fechaOperativaHoy } from '../../utils/fechaOperativa.js'
import { esDiaPresentePresunto, horarioEfectivoDelDia } from '../../../server/lib/asistenciaExcepciones.js'
import { numeroSemanaIso } from '../../../server/lib/nominaSemana.js'

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

// Día en que arranca la semana de nómina si la configuración no lo trae (4 = jueves).
const INICIO_SEMANA_DEFAULT = 4

/** Devuelve el primer día de la semana que contiene `fecha` (0 = domingo … 6 = sábado). */
function inicioSemanaDe(fecha, inicio) {
  const d = new Date(fecha)
  const retroceso = (d.getDay() - inicio + 7) % 7
  d.setDate(d.getDate() - retroceso)
  return d
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtCorto(d) {
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })
}

// `esAdmin` (administrarNomina) controla las vistas de asistencia y el panel diario de hoy,
// que ese rol sí puede operar. Los ajustes y la eliminación de registros exigen
// `administrarNomina` en el servidor y se gatean con `puedeGestionarNomina`.
export default function TabAsistencia({ esAdmin, puedeGestionarNomina = false }) {
  // La fecha operativa sale de un único helper (America/Caracas): el reloj del
  // navegador puede estar en otra zona y pintar «hoy» en el día equivocado (F-13).
  const hoyIso = fechaOperativaHoy()
  const hoy = useMemo(() => new Date(`${hoyIso}T12:00:00`), [hoyIso])
  const { data: configNomina } = useConfigNomina()
  // La semana visible arranca el mismo día que la semana de la nómina (jueves por defecto).
  const diaInicio = Number.isInteger(Number(configNomina?.nomina_semana_inicio)) && configNomina?.nomina_semana_inicio != null
    && Number(configNomina.nomina_semana_inicio) >= 0 && Number(configNomina.nomina_semana_inicio) <= 6
    ? Number(configNomina.nomina_semana_inicio) : INICIO_SEMANA_DEFAULT
  // Se guarda un día cualquiera de la semana visible; el inicio se calcula con la configuración.
  const [diaAncla, setDiaAncla]       = useState(() => new Date(`${fechaOperativaHoy()}T12:00:00`))
  const inicioSemana = useMemo(() => inicioSemanaDe(diaAncla, diaInicio), [diaAncla, diaInicio])
  const [modal, setModal]             = useState(null) // { empleado, fecha, registro }
  const [cerrandoPeriodo, setCerrandoPeriodo] = useState(null)
  const [detallePeriodo, setDetallePeriodo] = useState(null)
  const [modoVistaMovil, setModoVistaMovil] = useState(esAdmin ? 'hoy' : 'semana') // 'hoy' | 'semana'
  const [fechaSeleccionada, setFechaSeleccionada] = useState(() => fechaOperativaHoy())
  const { data: periodos = [] } = useNominaPeriodos()
  const periodoParaCerrar = useMemo(
    () => (periodos || []).find(p => p.estado === 'abierto' && String(p.hasta) <= hoyIso) || null,
    [periodos, hoyIso],
  )

  // 7 días desde el inicio de la semana
  const dias = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(inicioSemana)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [inicioSemana])

  const desde = iso(dias[0])
  const hasta = iso(dias[6])

  const { data: configsEmpleados = [], isLoading: empCargando, isFetching: empActualizando, isError: empError, refetch: retryEmpleados } = useConfigEmpleados()
  // Control de asistencia por empleado: quien está configurado como "sin asistencia"
  // (cobro por comisión o monto fijo) no aparece en esta zona ni suma pendientes.
  const empleados = useMemo(
    () => (configsEmpleados || []).filter(config => config.controla_asistencia !== false),
    [configsEmpleados],
  )
  const empleadosSinControl = useMemo(
    () => (configsEmpleados || []).filter(config => config.controla_asistencia === false),
    [configsEmpleados],
  )
  // La lectura llega paginada desde el servidor (F-11): `registros` es el listado y
  // `truncado` avisa si el rango superó el techo de lectura y falta información.
  const { data: asistencia, isLoading: asisCargando, isError: asisError, refetch: retryAsistencia } = useAsistencia({ desde, hasta })
  const registros = asistencia?.registros ?? []
  const asistenciaTruncada = asistencia?.truncado === true
  // El panel diario muestra HOY aunque la semana visible sea otra: el rango de feriados
  // se ensancha para incluir la fecha operativa (la fija el servidor en America/Caracas)
  // y el panel no quede sin su feriado al navegar a otra semana.
  const feriadosDesde = desde < hoyIso ? desde : hoyIso
  const feriadosHasta = hasta > hoyIso ? hasta : hoyIso
  const { data: feriados = [], isLoading: feriadosCargando, isError: feriadosError, refetch: retryFeriados } = useFeriados(feriadosDesde, feriadosHasta)
  const feriadosPorFecha = useMemo(
    () => new Map(feriados.map(f => [f.fecha, f])),
    [feriados],
  )

  // Índice: `${empleadoId}|${fecha}` → registro
  const indice = useMemo(() => {
    const m = new Map()
    for (const r of registros) m.set(`${r.empleado_id}|${r.fecha}`, r)
    return m
  }, [registros])

  const totales = useMemo(() => {
    let horas = 0, extras = 0, ausencias = 0
    for (const emp of empleados) {
      for (const d of dias) {
        const f = iso(d)
        const r = indice.get(`${emp.empleado_id}|${f}`)
        if (r) {
          horas += Number(r.horas_normales || 0)
          extras += Number(r.horas_extra || 0)
          if (r.es_ausencia) ausencias += 1
        } else if (esDiaPresentePresunto({ empleado: emp, fecha: f, registro: null, feriado: feriadosPorFecha.get(f) })) {
          horas += horarioEfectivoDelDia(emp, f).horasJornada
        }
      }
    }
    return { horas, extras, ausencias }
  }, [empleados, dias, indice, feriadosPorFecha])

  const cargando = empCargando || asisCargando || feriadosCargando

  function irAHoy() {
    setDiaAncla(hoy)
    setFechaSeleccionada(hoyIso)
  }

  function moverSemana(delta) {
    const d = new Date(inicioSemana)
    d.setDate(d.getDate() + delta * 7)
    setDiaAncla(d)

    const nuevoInicio = d
    const nuevoFin = new Date(d)
    nuevoFin.setDate(nuevoFin.getDate() + 6)
    const fSel = new Date(`${fechaSeleccionada}T12:00:00`)
    if (fSel < nuevoInicio || fSel > nuevoFin) {
      setFechaSeleccionada(iso(nuevoInicio))
    }
  }

  const esSemanaActual = iso(inicioSemanaDe(hoy, diaInicio)) === desde

  const marcajeOperativo = esAdmin ? (
    <MarcajeLogisticaPanel
      empleados={empleados}
      feriadosPorFecha={feriadosPorFecha}
      empleadosCargando={empCargando}
      empleadosActualizando={empActualizando}
      empleadosError={empError}
      onReintentarEmpleados={retryEmpleados}
      periodoParaCerrar={periodoParaCerrar}
      onCerrarPeriodo={setCerrandoPeriodo}
    />
  ) : null

  const selectorModoMovil = esAdmin ? (
    <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 md:hidden" role="group" aria-label="Vista de asistencia">
      {[
        { id: 'hoy', label: 'Hoy', Icon: LogIn },
        { id: 'semana', label: 'Semana', Icon: CalendarClock },
      ].map(({ id, label, Icon }) => {
        const seleccionado = modoVistaMovil === id
        return (
          <button key={id} type="button" onClick={() => setModoVistaMovil(id)} aria-pressed={seleccionado}
            style={{ touchAction: 'manipulation' }}
            className={`flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-black transition-all ${seleccionado ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
            <Icon size={14} className={seleccionado ? 'text-primary' : 'text-slate-400'} aria-hidden="true" />
            <span className="text-center leading-tight">{label}</span>
          </button>
        )
      })}
    </div>
  ) : null
  const panelMarcaje = <div className={`${modoVistaMovil === 'hoy' ? 'block' : 'hidden'} md:block`}>{marcajeOperativo}</div>

  if (empError || asisError || feriadosError) return <div className="min-w-0 space-y-4">
    {selectorModoMovil}
    {panelMarcaje}
    <div role="alert" className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 space-y-3">
      <p>No se pudo comprobar la asistencia, la plantilla o los feriados. No se muestran ausencias ni totales en cero como si fueran datos confirmados.</p>
      <button type="button" onClick={() => { retryEmpleados(); retryAsistencia(); retryFeriados() }} className="min-h-11 px-4 py-2 rounded-xl border border-rose-300 bg-white font-bold">Volver a intentar</button>
    </div>
  </div>

  return (
    <div className="min-w-0 space-y-4">
      {/* En móvil cada flujo se muestra por separado para evitar confundir horas reales con previstas. */}
      {selectorModoMovil}
      {panelMarcaje}

      {/* Los KPIs semanales no desplazan la vista diaria en el primer scroll de iPhone. */}
      <div className={`${modoVistaMovil === 'semana' ? 'grid' : 'hidden md:grid'} grid-cols-2 lg:grid-cols-4 gap-3`}>
        <KpiCard icon={Users}         label="Personal en Nómina" value={configsEmpleados.length} color="indigo" />
        <KpiCard icon={Clock}         label="Horas normales"     value={`${totales.horas.toFixed(1)}h`} color="slate" />
        <KpiCard icon={Clock}         label="Horas extra"        value={`${totales.extras.toFixed(1)}h`} color="amber" />
        <KpiCard icon={CalendarClock} label="Ausencias / Faltas" value={totales.ausencias} color={totales.ausencias > 0 ? 'red' : 'green'} />
      </div>

      {asistenciaTruncada && (
        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-rose-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-600" aria-hidden="true" />
          <p className="text-[11px] font-semibold leading-snug">
            Este rango tiene más asistencia de la que se puede cargar de una vez: la lista y los totales
            están incompletos. Consulta por semana (o por empleado) para verlos completos.
          </p>
        </div>
      )}

      {empleadosSinControl.length > 0 && (
        <p className={`${modoVistaMovil === 'semana' ? 'block' : 'hidden md:block'} text-[11px] font-semibold text-slate-500`}>
          {empleadosSinControl.length === 1
            ? '1 perfil de nómina no controla asistencia (cobro por comisión o monto fijo): no aparece en esta zona.'
            : `${empleadosSinControl.length} perfiles de nómina no controlan asistencia (cobro por comisión o monto fijo): no aparecen en esta zona.`}
        </p>
      )}

      {/* Navegación del resumen semanal. */}
      <div className={`${modoVistaMovil === 'semana' ? 'flex' : 'hidden md:flex'} flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5`}>
        {/* Navegación semanal */}
        <div className="flex items-center justify-between sm:justify-start gap-1.5 bg-white border border-slate-200 rounded-2xl p-1 shadow-xs">
          <button onClick={() => moverSemana(-1)} aria-label="Semana anterior"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
            style={{ touchAction: 'manipulation' }}>
            <ChevronLeft size={16} aria-hidden="true" /> Anterior
          </button>
          <span className="text-xs font-black text-slate-800 px-2 whitespace-nowrap">
            {numeroSemanaIso(iso(dias[0]), iso(dias[6]))?.etiqueta} · {fmtCorto(dias[0])} – {fmtCorto(dias[6])}
          </span>
          <button onClick={() => moverSemana(1)} aria-label="Semana siguiente"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
            style={{ touchAction: 'manipulation' }}>
            Siguiente <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>

        {!esSemanaActual && (
          <button onClick={() => { setDiaAncla(hoy); setFechaSeleccionada(hoyIso) }}
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-700 shadow-xs transition-colors hover:bg-slate-50"
            style={{ touchAction: 'manipulation' }}>
            Volver a hoy
          </button>
        )}
      </div>

      {/* Vista semanal/diaria se oculta en móvil cuando está seleccionado Hoy. */}
      <div className={`${modoVistaMovil === 'semana' ? 'block' : 'hidden md:block'}`}>
      {/* Grilla semanal / registro manual por horario fijo */}
      {cargando ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : empleados.length === 0 ? (
        <EmptyState
          icon={Users}
          title={empleadosSinControl.length > 0 ? 'Sin personal con control de asistencia' : 'No hay empleados en nómina'}
          description={empleadosSinControl.length > 0
            ? 'Los perfiles activos están marcados como “sin asistencia”. Actívalo en su ficha de la pestaña Empleados para registrarlos aquí.'
            : 'Configura primero los empleados en la pestaña Empleados.'}
        />
      ) : (
        <>
          {/* Vista móvil: control diario por excepción sobre la semana activa. */}
          <div className="md:hidden">
            <AsistenciaDiariaMovil
              empleados={empleados}
              registrosPorEmpleado={indice}
              feriadoDelDia={feriadosPorFecha.get(fechaSeleccionada)}
              fechaSeleccionada={fechaSeleccionada}
              onCambiarFecha={setFechaSeleccionada}
              diasSemana={dias}
              onMoverSemana={moverSemana}
              esAdmin={esAdmin}
              puedeGestionarNomina={puedeGestionarNomina}
              onAbrirDetalle={setModal}
              onIrHoy={irAHoy}
            />
          </div>

          <HorizontalScroll className="hidden md:block" contentClassName="bg-white border border-slate-200 rounded-2xl shadow-xs">
            <table className="w-full min-w-[780px] text-xs" aria-label="Asistencia semanal">
              <thead className="bg-slate-50/80 text-slate-500 text-[10px] uppercase tracking-wider border-b border-slate-100">
                <tr>
                  <th className="text-left px-3.5 py-3 font-black sticky left-0 bg-slate-50 z-10 min-w-[150px]">
                    Empleado
                  </th>
                  {dias.map(d => {
                    const hoy = iso(d) === hoyIso
                    const finde = d.getDay() === 0 || d.getDay() === 6
                    return (
                      <th key={iso(d)}
                        className={`text-center px-2 py-3 font-bold min-w-[80px] ${
                          hoy ? 'text-primary bg-primary/[0.04]' : finde ? 'text-amber-600' : 'text-slate-600'
                        }`}>
                        <div className="font-black text-xs">{DIAS[d.getDay()]}</div>
                        <div className="text-[10px] font-medium opacity-75">{d.getDate()}</div>
                      </th>
                    )
                  })}
                  <th className="text-right px-3.5 py-3 font-black min-w-[65px]">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {empleados.map(emp => {
                  const totalHoras = dias.reduce((s, d) => {
                    const f = iso(d)
                    const r = indice.get(`${emp.empleado_id}|${f}`)
                    if (r) return s + Number(r.horas_trabajadas || 0)
                    return esDiaPresentePresunto({ empleado: emp, fecha: f, registro: null, feriado: feriadosPorFecha.get(f) })
                      ? s + horarioEfectivoDelDia(emp, f).horasJornada
                      : s
                  }, 0)

                  return (
                    <tr key={emp.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-3.5 py-2.5 sticky left-0 bg-white z-10">
                        <div className="font-bold text-slate-800 truncate max-w-[140px]">{emp.empleado?.nombre || '—'}</div>
                        {emp.cargo && <div className="text-[10px] text-slate-400 truncate max-w-[140px] font-medium">{emp.cargo}</div>}
                      </td>

                      {dias.map(d => {
                        const fecha = iso(d)
                        const reg = indice.get(`${emp.empleado_id}|${fecha}`)
                        const esHoy = fecha === hoyIso
                        return (
                          <td key={fecha} className={`px-1 py-1.5 text-center ${esHoy ? 'bg-primary/[0.02]' : ''}`}>
                            <CeldaAsistencia
                              empleado={emp}
                              fecha={fecha}
                              registro={reg}
                              feriado={feriadosPorFecha.get(fecha)}
                              esFinde={(d.getDay() === 0 || d.getDay() === 6) && !trabajaEseDia(emp, fecha)}
                              esSabado={d.getDay() === 6}
                              libre={!trabajaEseDia(emp, fecha)}
                              onClick={() => setModal({
                                empleado: emp,
                                fecha,
                                registro: ['entrada', 'completo', 'corregido'].includes(reg?.estado_marcaje) ? null : reg,
                                lectura: ['entrada', 'completo', 'corregido'].includes(reg?.estado_marcaje),
                                feriado: feriadosPorFecha.get(fecha),
                              })}
                            />
                          </td>
                        )
                      })}

                      <td className="px-3.5 py-2.5 text-right font-black text-slate-800">
                        {totalHoras > 0 ? `${totalHoras.toFixed(1)}h` : <span className="text-slate-300">—</span>}
                        <span className="block text-[10px] font-semibold text-slate-400">de 40h</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </HorizontalScroll>
        </>
      )}

      </div>
      {/* Leyenda de estados */}
      <div className={`${modoVistaMovil === 'semana' ? 'flex' : 'hidden md:flex'} flex-wrap items-center gap-3.5 p-3 rounded-2xl bg-white border border-slate-100 text-[11px] text-slate-600 shadow-sm`}>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-3.5 h-3.5 rounded-lg bg-emerald-50 border border-emerald-200" /> Presente por defecto
        </span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-3.5 h-3.5 rounded-lg bg-amber-100 border border-amber-300" /> Con horas extra
        </span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-3.5 h-3.5 rounded-lg bg-red-100 border border-red-300" /> Ausencia / Falta
        </span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-3.5 h-3.5 rounded-lg bg-purple-100 border border-purple-300" /> Día Feriado
        </span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-3.5 h-3.5 rounded-lg bg-slate-100 border border-slate-300 text-slate-500 text-[9px] font-bold px-1 py-0.5" /> Libre (descanso)
        </span>
        <span className="text-slate-400 ml-auto italic">Toca cualquier día para registrar horas extras, ausencias o descanso trabajado.</span>
      </div>

      {modal && (
        <AsistenciaModal
          empleado={modal.empleado}
          fecha={modal.fecha}
          registro={modal.registro}
          soloLectura={modal.lectura}
          horasDescansoDefault={configNomina?.nomina_horas_descanso ?? 1}
          feriado={modal.feriado}
          esAdmin={esAdmin}
          puedeGestionarNomina={puedeGestionarNomina}
          onClose={() => setModal(null)}
        />
      )}

      {cerrandoPeriodo && (
        <CerrarPeriodoModal
          periodo={cerrandoPeriodo}
          onClose={() => setCerrandoPeriodo(null)}
          onVerHoja={setDetallePeriodo}
        />
      )}
      {detallePeriodo && (
        <PeriodoDetalleModal
          periodo={detallePeriodo}
          puedeGestionarNomina={puedeGestionarNomina}
          onClose={() => setDetallePeriodo(null)}
        />
      )}
    </div>
  )
}

function CeldaAsistencia({ empleado, fecha, registro, feriado, esFinde = false, esSabado = false, libre = false, onClick, isMobile = false }) {
  if (!registro) {
    if (libre || esFinde) {
      return (
        <button
          type="button"
          onClick={onClick}
          aria-label={feriado ? `Feriado: ${feriado.nombre}` : (libre
            ? 'Día no laborable para este empleado (toca para registrar si vino)'
            : (esSabado ? 'Descanso (toca para marcar si vino)' : 'Descanso'))}
          title={libre
            ? 'Día no laborable según su ficha (toca si vino a trabajar)'
            : (esSabado ? 'Día de descanso (toca si vino a trabajar)' : 'Día de descanso')}
          style={{ touchAction: 'manipulation' }}
          className={`w-full ${isMobile ? 'h-11 py-0.5' : 'py-1'} px-0.5 rounded-xl border border-slate-200/80 bg-slate-100/60 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-800 text-slate-400 text-[10px] font-bold transition-all group`}
        >
          <span className="block text-[9px] group-hover:hidden text-slate-400 font-semibold">Libre</span>
          <span className="hidden group-hover:block text-[9px] text-amber-700 font-bold">+ Marcar</span>
        </button>
      )
    }

    const presunto = esDiaPresentePresunto({ empleado, fecha, registro: null, feriado })
    const horas = presunto ? horarioEfectivoDelDia(empleado, fecha).horasJornada : 0
    return (
      <button type="button" onClick={onClick}
        aria-label={feriado ? `Registrar asistencia: ${feriado.nombre}` : (presunto ? 'Presente por defecto (toca para excepciones)' : 'Registrar asistencia')}
        style={{ touchAction: 'manipulation' }}
        className={`w-full ${isMobile ? 'h-11 py-1' : 'py-1.5'} px-1 rounded-xl border transition-all text-[11px] font-bold ${feriado && !feriado.laborable
          ? 'bg-purple-50 border-purple-200 text-purple-700 hover:border-purple-400'
          : presunto
            ? 'bg-emerald-50/75 border-emerald-200 text-emerald-700 hover:border-emerald-400'
            : 'bg-slate-50 border-dashed border-slate-200 text-slate-400 hover:border-primary hover:text-primary'}`}>
        {feriado && !feriado.laborable ? (isMobile ? 'Fer' : 'Feriado') : (presunto ? `${horas.toFixed(1)}h` : '+')}
      </button>
    )
  }

  const extra = Number(registro.horas_extra || 0)
  const horas = Number(registro.horas_trabajadas || 0)

  let cls = 'bg-emerald-50 border-emerald-300 text-emerald-800'
  let texto = `${horas.toFixed(1)}h`

  if (registro.es_ausencia && registro.ausencia_justificada) {
    // Falta con justificativo: se paga el día (regla del usuario, 19/11/2026).
    cls = 'bg-sky-50 border-sky-300 text-sky-800'
    texto = isMobile ? 'F. just.' : 'Justificada'
  } else if (registro.es_ausencia) {
    cls = 'bg-red-50 border-red-300 text-red-700'
    texto = 'Falta'
  } else if (registro.es_feriado) {
    cls = 'bg-purple-50 border-purple-300 text-purple-800'
    texto = isMobile ? 'Fer' : 'Feriado'
  } else if (extra > 0) {
    cls = 'bg-amber-50 border-amber-300 text-amber-900'
  }

  return (
    <button type="button" onClick={onClick}
      aria-label="Editar asistencia"
      style={{ touchAction: 'manipulation' }}
      className={`w-full ${isMobile ? 'h-11 py-0.5' : 'py-1'} px-0.5 rounded-xl border text-[11px] font-black hover:shadow-xs transition-all ${cls}`}>
      <span className="block leading-tight">{texto}</span>
      {extra > 0 && !registro.es_ausencia && (
        <span className="block text-[8px] font-black text-amber-700 leading-none mt-0.5">+{extra.toFixed(1)}h</span>
      )}
    </button>
  )
}
