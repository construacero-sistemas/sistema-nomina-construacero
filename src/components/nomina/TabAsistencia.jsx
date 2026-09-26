// src/components/nomina/TabAsistencia.jsx
// Grilla semanal de horarios manuales y asistencia, separada del reloj real de hoy.
import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, CalendarClock, Users, Clock, Sparkles, LogIn, AlertTriangle } from 'lucide-react'
import { useConfigEmpleados, useAsistencia, useFeriados, useConfigNomina } from '../../hooks/useNomina'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import EmptyState from '../../../compat/components/ui/EmptyState.jsx'
import KpiCard from '../../../compat/components/ui/KpiCard.jsx'
import HorizontalScroll from '../../../compat/components/ui/HorizontalScroll.jsx'
import AsistenciaModal from './AsistenciaModal'
import AsistenciaMasivaModal from './AsistenciaMasivaModal'
import MarcajeLogisticaPanel from './MarcajeLogisticaPanel'
import AsistenciaDiariaMovil from './AsistenciaDiariaMovil'
import { trabajaEseDia } from '../../utils/diasLaborables.js'
import { jornadasAbiertasDe } from '../../utils/asistenciaOperativa.js'
import { fechaOperativaHoy } from '../../utils/fechaOperativa.js'

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

/** Devuelve el lunes de la semana que contiene `fecha`. */
function lunesDe(fecha) {
  const d = new Date(fecha)
  const dow = d.getDay()
  const diff = dow === 0 ? -6 : 1 - dow // domingo → lunes anterior
  d.setDate(d.getDate() + diff)
  return d
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtCorto(d) {
  return d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })
}

// `esAdmin` (administrarNomina) controla las vistas de asistencia y el marcaje real,
// que ese rol sí puede operar. La carga masiva y la eliminación de registros exigen
// `gestionarUsuarios` en el servidor, así que se gatean con `puedeGestionarNomina`.
export default function TabAsistencia({ esAdmin, puedeGestionarNomina = false }) {
  // La fecha operativa sale de un único helper (America/Caracas): el reloj del
  // navegador puede estar en otra zona y pintar «hoy» en el día equivocado (F-13).
  const hoyIso = fechaOperativaHoy()
  const hoy = useMemo(() => new Date(`${hoyIso}T12:00:00`), [hoyIso])
  const [inicioSemana, setInicioSemana] = useState(() => lunesDe(new Date(`${fechaOperativaHoy()}T12:00:00`)))
  const [modal, setModal]             = useState(null) // { empleado, fecha, registro }
  const [modalMasivo, setModalMasivo] = useState(null) // fecha
  const [modoVistaMovil, setModoVistaMovil] = useState(esAdmin ? 'reloj' : 'manual') // 'reloj' | 'manual' | 'semanal'
  const [fechaSeleccionada, setFechaSeleccionada] = useState(() => fechaOperativaHoy())

  // 7 días desde el lunes
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
  // El reloj real muestra HOY aunque la semana visible sea otra: el rango de feriados
  // se ensancha para incluir la fecha operativa (la fija el servidor en America/Caracas)
  // y el panel no quede sin su feriado al navegar a otra semana.
  const feriadosDesde = desde < hoyIso ? desde : hoyIso
  const feriadosHasta = hasta > hoyIso ? hasta : hoyIso
  const { data: feriados = [], isLoading: feriadosCargando, isError: feriadosError, refetch: retryFeriados } = useFeriados(feriadosDesde, feriadosHasta)
  const { data: configNomina } = useConfigNomina()

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
    for (const r of registros) {
      horas     += Number(r.horas_normales || 0)
      extras    += Number(r.horas_extra    || 0)
      if (r.es_ausencia) ausencias += 1
    }
    return { horas, extras, ausencias }
  }, [registros])

  // Jornadas abiertas de la semana visible: al calcular la nómina no se pagan y el
  // servidor responde 409 hasta que se corrija la salida o el operador confirme.
  const salidasPendientes = useMemo(() => jornadasAbiertasDe(registros).length, [registros])

  const cargando = empCargando || asisCargando || feriadosCargando

  function irAHoy() {
    setInicioSemana(lunesDe(hoy))
    setFechaSeleccionada(hoyIso)
  }

  function moverSemana(delta) {
    const d = new Date(inicioSemana)
    d.setDate(d.getDate() + delta * 7)
    setInicioSemana(d)

    const nuevoLunes = d
    const nuevoDomingo = new Date(d)
    nuevoDomingo.setDate(nuevoDomingo.getDate() + 6)
    const fSel = new Date(`${fechaSeleccionada}T12:00:00`)
    if (fSel < nuevoLunes || fSel > nuevoDomingo) {
      setFechaSeleccionada(iso(nuevoLunes))
    }
  }

  const esSemanaActual = iso(lunesDe(hoy)) === desde

  const marcajeOperativo = esAdmin ? (
    <MarcajeLogisticaPanel
      empleados={empleados}
      feriadosPorFecha={feriadosPorFecha}
      empleadosCargando={empCargando}
      empleadosActualizando={empActualizando}
      empleadosError={empError}
      onReintentarEmpleados={retryEmpleados}
    />
  ) : null

  const selectorModoMovil = (
    <div className={`grid ${esAdmin ? 'grid-cols-3' : 'grid-cols-2'} gap-1 rounded-2xl bg-slate-100 p-1 md:hidden`} role="group" aria-label="Vista de asistencia">
      {[
        ...(esAdmin ? [{ id: 'reloj', label: 'Marcaje real', Icon: LogIn }] : []),
        { id: 'manual', label: 'Manual nómina', Icon: Sparkles },
        { id: 'semanal', label: 'Semana', Icon: CalendarClock },
      ].map(({ id, label, Icon }) => {
        const seleccionado = modoVistaMovil === id
        return (
          <button key={id} type="button" onClick={() => setModoVistaMovil(id)} aria-pressed={seleccionado}
            style={{ touchAction: 'manipulation' }}
            className={`flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-black transition-all ${seleccionado ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}>
            <Icon size={14} className={seleccionado ? 'text-primary' : 'text-slate-400'} aria-hidden="true" />
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
  const panelMarcaje = <div className={`${modoVistaMovil === 'reloj' ? 'block' : 'hidden'} md:block`}>{marcajeOperativo}</div>

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

      {/* Los KPIs semanales no desplazan el marcaje real en el primer scroll de iPhone. */}
      <div className={`${modoVistaMovil === 'semanal' ? 'grid' : 'hidden md:grid'} grid-cols-2 lg:grid-cols-4 gap-3`}>
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

      {salidasPendientes > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-[11px] font-semibold leading-snug">
            {salidasPendientes === 1
              ? '1 marcaje tiene la entrada y no la salida'
              : `${salidasPendientes} marcajes tienen la entrada y no la salida`}
            : al calcular la nómina no se pagan hasta que corrijas la salida en el reloj real (o confirmes el cálculo).
          </p>
        </div>
      )}

      {empleadosSinControl.length > 0 && (
        <p className={`${modoVistaMovil === 'semanal' ? 'block' : 'hidden md:block'} text-[11px] font-semibold text-slate-500`}>
          {empleadosSinControl.length === 1
            ? '1 perfil de nómina no controla asistencia (cobro por comisión o monto fijo): no aparece en esta zona.'
            : `${empleadosSinControl.length} perfiles de nómina no controlan asistencia (cobro por comisión o monto fijo): no aparecen en esta zona.`}
        </p>
      )}

      {/* Navegación del resumen semanal y acceso al horario manual masivo. */}
      <div className={`${modoVistaMovil === 'semanal' ? 'flex' : 'hidden md:flex'} flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5`}>
        {/* Navegación semanal */}
        <div className="flex items-center justify-between sm:justify-start gap-1.5 bg-white border border-slate-200 rounded-2xl p-1 shadow-xs">
          <button onClick={() => moverSemana(-1)} aria-label="Semana anterior"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
            style={{ touchAction: 'manipulation' }}>
            <ChevronLeft size={16} aria-hidden="true" /> Anterior
          </button>
          <span className="text-xs font-black text-slate-800 px-2 whitespace-nowrap">
            {fmtCorto(dias[0])} – {fmtCorto(dias[6])}
          </span>
          <button onClick={() => moverSemana(1)} aria-label="Semana siguiente"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
            style={{ touchAction: 'manipulation' }}>
            Siguiente <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>

        {!esSemanaActual && (
          <button onClick={() => { setInicioSemana(lunesDe(hoy)); setFechaSeleccionada(hoyIso) }}
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-bold text-slate-700 shadow-xs transition-colors hover:bg-slate-50"
            style={{ touchAction: 'manipulation' }}>
            Volver a hoy
          </button>
        )}
      </div>

      {/* Registro manual y resumen se ocultan en móvil cuando está seleccionado el reloj real. */}
      <div className={`${modoVistaMovil !== 'reloj' ? 'block' : 'hidden md:block'}`}>
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
          {/* Vista móvil: registro manual por día o resumen semanal. */}
          <div className={`${modoVistaMovil === 'semanal' ? 'hidden' : 'block'} md:hidden`}>
            {modoVistaMovil === 'manual' ? (
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
                onAbrirMasivo={payload => setModalMasivo(payload)}
                onIrHoy={irAHoy}
              />
            ) : (
              <div className="space-y-3">
                {empleados.map(emp => {
                  const totalHoras = dias.reduce((s, d) => {
                    const r = indice.get(`${emp.empleado_id}|${iso(d)}`)
                    return s + Number(r?.horas_trabajadas || 0)
                  }, 0)

                  return (
                    <div key={emp.id} className="bg-white border border-slate-200/90 rounded-2xl p-3 shadow-xs space-y-2.5">
                      {/* Cabecera del Empleado */}
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-black text-slate-800 truncate">
                            {emp.empleado?.nombre || '—'}
                          </h4>
                          <p className="text-[10px] text-slate-400 font-medium truncate">
                            {emp.cargo || 'Personal'}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="text-[9px] font-bold text-slate-400 block uppercase">Total</span>
                          <span className="text-xs font-black text-primary bg-primary/10 px-2 py-0.5 rounded-lg inline-block">
                            {totalHoras > 0 ? `${totalHoras.toFixed(1)}h` : '0h'}
                          </span>
                        </div>
                      </div>

                      {/* Cuadrícula de los 7 días (ajustada al 100% de la pantalla sin scroll) */}
                      <div className="grid grid-cols-7 gap-1">
                        {dias.map(d => {
                          const fecha = iso(d)
                          const reg = indice.get(`${emp.empleado_id}|${fecha}`)
                          const esHoy = fecha === hoyIso
                          const feriado = feriadosPorFecha.get(fecha)
                          const finde = d.getDay() === 0 || d.getDay() === 6
                          // Día no laborable para esta persona según su ficha: se pinta
                          // como Libre en vez de pendiente de registro.
                          const libre = !trabajaEseDia(emp, fecha)

                          return (
                            <div key={fecha} className="flex flex-col items-center gap-1 min-w-0">
                              <div className={`text-center leading-none ${
                                esHoy ? 'text-primary font-black' : finde ? 'text-amber-600 font-bold' : 'text-slate-500 font-bold'
                              }`}>
                                <span className="text-[9px] uppercase block">{DIAS[d.getDay()]}</span>
                                <span className="text-[10px] block">{d.getDate()}</span>
                              </div>
                              <CeldaAsistencia
                                registro={reg}
                                feriado={feriado}
                                // F-5: el fin de semana solo es descanso si esa persona no trabaja
                                // ese día; el sábado de quien sí trabaja queda como pendiente.
                                esFinde={finde && libre}
                                esSabado={d.getDay() === 6}
                                libre={libre}
                                isMobile={true}
                                onClick={() => setModal({
                                  empleado: emp,
                                  fecha,
                                  registro: ['entrada', 'completo', 'corregido'].includes(reg?.estado_marcaje) ? null : reg,
                                  lectura: ['entrada', 'completo', 'corregido'].includes(reg?.estado_marcaje),
                                  feriado,
                                })}
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Vista de escritorio: resumen matricial semanal. */}
          <HorizontalScroll className={`${modoVistaMovil === 'semanal' ? 'block' : 'hidden'} md:block`} contentClassName="bg-white border border-slate-200 rounded-2xl shadow-xs">
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
                    const r = indice.get(`${emp.empleado_id}|${iso(d)}`)
                    return s + Number(r?.horas_trabajadas || 0)
                  }, 0)

                  return (
                    <tr key={emp.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-3.5 py-2.5 sticky left-0 bg-white z-10">
                        <div className="font-bold text-slate-800 truncate max-w-[140px]">
                          {emp.empleado?.nombre || '—'}
                        </div>
                        {emp.cargo && (
                          <div className="text-[10px] text-slate-400 truncate max-w-[140px] font-medium">{emp.cargo}</div>
                        )}
                      </td>

                      {dias.map(d => {
                        const fecha = iso(d)
                        const reg = indice.get(`${emp.empleado_id}|${fecha}`)
                        const esHoy = fecha === hoyIso
                        return (
                          <td key={fecha} className={`px-1 py-1.5 text-center ${esHoy ? 'bg-primary/[0.02]' : ''}`}>
                            <CeldaAsistencia
                              registro={reg}
                              feriado={feriadosPorFecha.get(fecha)}
                              // F-5: mismo criterio que la vista móvil — el descanso de fin de
                              // semana solo aplica a quien no trabaja ese día.
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
      <div className={`${modoVistaMovil === 'semanal' ? 'flex' : 'hidden md:flex'} flex-wrap items-center gap-3.5 p-3 rounded-2xl bg-white border border-slate-100 text-[11px] text-slate-600 shadow-sm`}>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-3.5 h-3.5 rounded-lg bg-emerald-100 border border-emerald-300" /> Jornada estándar (8h)
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
          <span className="w-3.5 h-3.5 rounded-lg bg-slate-100 border border-slate-300 text-slate-500 text-[9px] font-bold px-1 py-0.5" /> Libre (día no laborable suyo)
        </span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-3.5 h-3.5 rounded-lg bg-slate-50 border border-dashed border-slate-300" /> Sin registro
        </span>
        <span className="text-slate-400 ml-auto italic">Las celdas permiten ajustar el horario previsto o la ausencia; el reloj real se marca en el panel superior.</span>
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

      {modalMasivo && (
        <AsistenciaMasivaModal
          fechaInicial={modalMasivo.fecha}
          empleadoIds={modalMasivo.empleadoIds}
          empleados={empleados}
          registrosPorEmpleado={indice}
          onClose={() => setModalMasivo(null)}
        />
      )}
    </div>
  )
}

function CeldaAsistencia({ registro, feriado, esFinde = false, esSabado = false, libre = false, onClick, isMobile = false }) {
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

    return (
      <button type="button" onClick={onClick}
        aria-label={feriado ? `Registrar asistencia: ${feriado.nombre}` : 'Registrar asistencia'}
        style={{ touchAction: 'manipulation' }}
        className={`w-full ${isMobile ? 'h-11 py-1' : 'py-1.5'} px-1 rounded-xl border transition-all text-[11px] font-bold ${feriado && !feriado.laborable
          ? 'bg-purple-50 border-purple-200 text-purple-700 hover:border-purple-400'
          : 'bg-slate-50 border-dashed border-slate-200 text-slate-400 hover:border-primary hover:text-primary hover:bg-primary/[0.04]'}`}>
        {feriado && !feriado.laborable ? (isMobile ? 'Fer' : 'Feriado') : '+'}
      </button>
    )
  }

  const extra = Number(registro.horas_extra || 0)
  const horas = Number(registro.horas_trabajadas || 0)

  let cls = 'bg-emerald-50 border-emerald-300 text-emerald-800'
  let texto = `${horas.toFixed(1)}h`

  if (registro.es_ausencia) {
    cls = 'bg-red-50 border-red-300 text-red-700'
    texto = isMobile ? 'Falta' : 'Falta'
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
