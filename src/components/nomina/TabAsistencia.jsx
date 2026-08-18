// src/components/nomina/TabAsistencia.jsx
// Grilla semanal de asistencia: filas = empleados, columnas = días de la semana.
import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, CalendarClock, Users, Clock, CalendarPlus } from 'lucide-react'
import { useConfigEmpleados, useAsistencia, useFeriados } from '../../hooks/useNomina'
import Skeleton from '../../../compat/components/ui/Skeleton.jsx'
import EmptyState from '../../../compat/components/ui/EmptyState.jsx'
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
  const [modal, setModal]         = useState(null) // { empleado, fecha, registro }
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

  return (
    <div className="space-y-4">
      <MarcajeLogisticaPanel />
      {/* KPIs de la semana */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={Users}         label="Empleados"       value={empleados.length} color="indigo" />
        <KpiCard icon={Clock}         label="Horas normales"  value={totales.horas.toFixed(1)} color="slate" />
        <KpiCard icon={Clock}         label="Horas extra"     value={totales.extras.toFixed(1)} color="amber" />
        <KpiCard icon={CalendarClock} label="Ausencias"       value={totales.ausencias} color={totales.ausencias > 0 ? 'red' : 'green'} />
      </div>

      {/* Navegación de semana */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-1.5 py-1">
          <button onClick={() => moverSemana(-1)} title="Semana anterior"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs font-bold text-slate-700 px-1.5 whitespace-nowrap">
            {fmtCorto(dias[0])} – {fmtCorto(dias[6])}
          </span>
          <button onClick={() => moverSemana(1)} title="Semana siguiente"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>

        {!esSemanaActual && (
          <button onClick={() => setInicioSemana(lunesDe(new Date()))}
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50">
            Semana actual
          </button>
        )}

        {esAdmin && empleados.length > 0 && (
          <button
            onClick={() => setModalMasivo(iso(new Date()))}
            className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-bold transition-all">
            <CalendarPlus size={14} />
            Registrar día completo
          </button>
        )}
      </div>

      {/* Grilla */}
      {cargando ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : empleados.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No hay empleados en nómina"
          description="Configura primero los empleados en la pestaña Empleados."
        />
      ) : (
        <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold sticky left-0 bg-slate-50 z-10 min-w-[140px]">
                  Empleado
                </th>
                {dias.map(d => {
                  const hoy = iso(d) === iso(new Date())
                  const finde = d.getDay() === 0 || d.getDay() === 6
                  return (
                    <th key={iso(d)}
                      className={`text-center px-2 py-2.5 font-semibold min-w-[76px] ${
                        hoy ? 'text-primary' : finde ? 'text-amber-600' : ''
                      }`}>
                      <div>{DIAS[d.getDay()]}</div>
                      <div className="text-[9px] font-normal opacity-70">{d.getDate()}</div>
                    </th>
                  )
                })}
                <th className="text-right px-3 py-2.5 font-semibold min-w-[60px]">Total</th>
              </tr>
            </thead>
            <tbody>
              {empleados.map(emp => {
                const totalHoras = dias.reduce((s, d) => {
                  const r = indice.get(`${emp.empleado_id}|${iso(d)}`)
                  return s + Number(r?.horas_trabajadas || 0)
                }, 0)

                return (
                  <tr key={emp.id} className="border-t border-slate-100 hover:bg-slate-50/40">
                    <td className="px-3 py-2 sticky left-0 bg-white z-10">
                      <div className="font-semibold text-slate-700 truncate max-w-[130px]">
                        {emp.empleado?.nombre || '—'}
                      </div>
                      {emp.cargo && (
                        <div className="text-[10px] text-slate-400 truncate max-w-[130px]">{emp.cargo}</div>
                      )}
                    </td>

                    {dias.map(d => {
                      const fecha = iso(d)
                      const reg = indice.get(`${emp.empleado_id}|${fecha}`)
                      return (
                        <td key={fecha} className="px-1 py-1.5 text-center">
                          <CeldaAsistencia
                            registro={reg}
                            feriado={feriadosPorFecha.get(fecha)}
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

                    <td className="px-3 py-2 text-right font-black text-slate-700">
                      {totalHoras > 0 ? `${totalHoras.toFixed(1)}h` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-green-100 border border-green-200" /> Jornada normal
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-amber-100 border border-amber-200" /> Con horas extra
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-red-100 border border-red-200" /> Ausencia
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-indigo-100 border border-indigo-200" /> Feriado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-slate-50 border border-slate-200" /> Sin registro
        </span>
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

function CeldaAsistencia({ registro, feriado, onClick }) {
  if (!registro) {
    return (
      <button onClick={onClick}
        title={feriado ? `${feriado.nombre}${feriado.laborable ? ' (laborable)' : ''}` : undefined}
        className={`w-full py-1.5 rounded-lg border transition-colors text-[11px] font-bold ${feriado && !feriado.laborable
          ? 'bg-indigo-50 border-indigo-200 text-indigo-500 hover:border-primary'
          : 'bg-slate-50 border-slate-200 text-slate-300 hover:border-primary hover:text-primary'}`}>
        {feriado && !feriado.laborable ? 'F' : '+'}
      </button>
    )
  }

  const extra = Number(registro.horas_extra || 0)
  const horas = Number(registro.horas_trabajadas || 0)

  let cls = 'bg-green-50 border-green-200 text-green-700'
  let texto = `${horas.toFixed(1)}h`

  if (registro.es_ausencia) {
    cls = 'bg-red-50 border-red-200 text-red-600'
    texto = 'Falta'
  } else if (registro.es_feriado) {
    cls = 'bg-indigo-50 border-indigo-200 text-indigo-700'
  } else if (extra > 0) {
    cls = 'bg-amber-50 border-amber-200 text-amber-700'
  }

  return (
    <button onClick={onClick}
      className={`w-full py-1.5 rounded-lg border text-[11px] font-bold hover:brightness-95 transition-all ${cls}`}>
      {texto}
      {extra > 0 && !registro.es_ausencia && (
        <span className="block text-[9px] font-semibold opacity-80">+{extra.toFixed(1)}</span>
      )}
    </button>
  )
}

function KpiCard({ icon: Icon, label, value, color }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-700',
    slate:  'bg-slate-50 text-slate-700',
    amber:  'bg-amber-50 text-amber-700',
    green:  'bg-green-50 text-green-700',
    red:    'bg-red-50 text-red-600',
  }
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon size={16} />
        </div>
        <span className="text-xs text-slate-500 font-medium">{label}</span>
      </div>
      <div className="text-lg font-black text-slate-800">{value}</div>
    </div>
  )
}
