// src/components/nomina/TabAsistencia.jsx
// Grilla semanal de asistencia visual e intuitiva con marcaje rápido masivo.
import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, CalendarClock, Users, Clock, CalendarPlus, Sparkles } from 'lucide-react'
import { useConfigEmpleados, useAsistencia, useFeriados } from '../../hooks/useNomina'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import EmptyState from '../../../compat/components/ui/EmptyState.jsx'
import KpiCard from '../../../compat/components/ui/KpiCard.jsx'
import HorizontalScroll from '../../../compat/components/ui/HorizontalScroll.jsx'
import AsistenciaModal from './AsistenciaModal'
import AsistenciaMasivaModal from './AsistenciaMasivaModal'
import MarcajeLogisticaPanel from './MarcajeLogisticaPanel'

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

export default function TabAsistencia({ esAdmin }) {
  const [inicioSemana, setInicioSemana] = useState(() => lunesDe(new Date()))
  const [modal, setModal]             = useState(null) // { empleado, fecha, registro }
  const [modalMasivo, setModalMasivo] = useState(null) // fecha

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

  const { data: empleados = [], isLoading: empCargando } = useConfigEmpleados()
  const { data: registros = [], isLoading: asisCargando } = useAsistencia({ desde, hasta })
  const { data: feriados = [], isLoading: feriadosCargando } = useFeriados(desde, hasta)

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

  const cargando = empCargando || asisCargando || feriadosCargando

  function moverSemana(delta) {
    const d = new Date(inicioSemana)
    d.setDate(d.getDate() + delta * 7)
    setInicioSemana(d)
  }

  const esSemanaActual = iso(lunesDe(new Date())) === desde
  const hoyIso = iso(new Date())

  return (
    <div className="space-y-4">
      <MarcajeLogisticaPanel />

      {/* KPIs de la semana */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Users}         label="Personal en Nómina" value={empleados.length} color="indigo" />
        <KpiCard icon={Clock}         label="Horas normales"     value={`${totales.horas.toFixed(1)}h`} color="slate" />
        <KpiCard icon={Clock}         label="Horas extra"        value={`${totales.extras.toFixed(1)}h`} color="amber" />
        <KpiCard icon={CalendarClock} label="Ausencias / Faltas" value={totales.ausencias} color={totales.ausencias > 0 ? 'red' : 'green'} />
      </div>

      {/* Barra de Navegación y Acciones Rápidas */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
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

        <div className="flex flex-wrap items-center gap-2">
          {!esSemanaActual && (
            <button onClick={() => setInicioSemana(lunesDe(new Date()))}
              className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 shadow-xs transition-colors"
              style={{ touchAction: 'manipulation' }}>
              Semana actual
            </button>
          )}

          {/* Acciones de marcaje rápido */}
          {esAdmin && empleados.length > 0 && (
            <>
              <button
                onClick={() => setModalMasivo(hoyIso)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white text-xs font-bold shadow-md shadow-emerald-950/20 transition-all active:scale-95"
                style={{ touchAction: 'manipulation' }}>
                <Sparkles size={14} />
                <span>Marcar hoy (8 a 5)</span>
              </button>
              <button
                onClick={() => setModalMasivo(desde)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold shadow-xs transition-all"
                style={{ touchAction: 'manipulation' }}>
                <CalendarPlus size={14} />
                <span>Otro día</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Grilla Semanal */}
      {cargando ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : empleados.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No hay empleados en nómina"
          description="Configura primero los empleados en la pestaña Empleados."
        />
      ) : (
        <>
          {/* ═══ VISTA MÓVIL: Tarjetas por Empleado con 7 Días Fluidos (CERO SCROLL HORIZONTAL) ═══ */}
          <div className="block md:hidden space-y-3">
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
                            esFinde={finde}
                            esSabado={d.getDay() === 6}
                            isMobile={true}
                            onClick={() => setModal({
                              empleado: emp,
                              fecha,
                              registro: reg,
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

          {/* ═══ VISTA DESKTOP: Tabla Matricial Completa ═══ */}
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
                              esFinde={d.getDay() === 0 || d.getDay() === 6}
                              esSabado={d.getDay() === 6}
                              onClick={() => setModal({
                                empleado: emp,
                                fecha,
                                registro: reg,
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

      {/* Leyenda de estados */}
      <div className="flex flex-wrap items-center gap-3.5 p-3 rounded-2xl bg-white border border-slate-100 text-[11px] text-slate-600 shadow-sm">
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
          <span className="w-3.5 h-3.5 rounded-lg bg-slate-100 border border-slate-300 text-slate-500 text-[9px] font-bold px-1 py-0.5" /> Descanso / Libre
        </span>
        <span className="flex items-center gap-1.5 font-medium">
          <span className="w-3.5 h-3.5 rounded-lg bg-slate-50 border border-dashed border-slate-300" /> Sin registro
        </span>
        <span className="text-slate-400 ml-auto italic">Toca cualquier celda para ver o editar.</span>
      </div>

      {modal && (
        <AsistenciaModal
          empleado={modal.empleado}
          fecha={modal.fecha}
          registro={modal.registro}
          feriado={modal.feriado}
          esAdmin={esAdmin}
          onClose={() => setModal(null)}
        />
      )}

      {modalMasivo && (
        <AsistenciaMasivaModal
          fechaInicial={modalMasivo}
          totalEmpleados={empleados.length}
          onClose={() => setModalMasivo(null)}
        />
      )}
    </div>
  )
}

function CeldaAsistencia({ registro, feriado, esFinde = false, esSabado = false, onClick, isMobile = false }) {
  if (!registro) {
    if (esFinde) {
      return (
        <button
          type="button"
          onClick={onClick}
          aria-label={feriado ? `Feriado: ${feriado.nombre}` : (esSabado ? 'Sábado rotativo: Descanso (toca para marcar si asistió)' : 'Descanso')}
          title={esSabado ? 'Sábado rotativo: Día de descanso (toca si vino a trabajar)' : 'Día de descanso'}
          style={{ touchAction: 'manipulation' }}
          className={`w-full ${isMobile ? 'h-11 py-0.5' : 'py-1'} px-0.5 rounded-xl border border-slate-200/80 bg-slate-100/60 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-800 text-slate-400 text-[10px] font-bold transition-all group`}
        >
          <span className="block text-[9px] group-hover:hidden text-slate-400 font-semibold">{isMobile ? 'Libre' : 'Descanso'}</span>
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
