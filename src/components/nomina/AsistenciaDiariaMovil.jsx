// src/components/nomina/AsistenciaDiariaMovil.jsx
// Vista móvil táctil ultra-rápida ("Pasar Lista") para registrar asistencia diaria en 1 o 2 toques.
import { useState, useMemo } from 'react'
import {
  Check,
  UserX,
  Plus,
  Sparkles,
  Edit3,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useRegistrarAsistencia, useRegistrarAsistenciaMasivo, useEliminarAsistencia } from '../../hooks/useNomina'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'
import { formatRangoHoras12 } from '../../utils/timeUtils.js'

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function AsistenciaDiariaMovil({
  empleados = [],
  registrosPorEmpleado,
  feriadoDelDia,
  fechaSeleccionada,
  onCambiarFecha,
  diasSemana = [],
  onMoverSemana,
  esAdmin,
  onAbrirDetalle,
}) {
  const registrar = useRegistrarAsistencia()
  const registrarMasivo = useRegistrarAsistenciaMasivo()
  const eliminar = useEliminarAsistencia()
  const [expandidoExtra, setExpandidoExtra] = useState(null)
  const [cargandoEmpId, setCargandoEmpId] = useState(null)

  const fechaObj = useMemo(() => new Date(`${fechaSeleccionada}T12:00:00`), [fechaSeleccionada])
  const dow = fechaObj.getDay()
  const esSabado = dow === 6
  const esDomingo = dow === 0
  const hoyIso = iso(new Date())
  const esHoy = fechaSeleccionada === hoyIso

  // Resumen de asistencia del día seleccionado
  const resumenDia = useMemo(() => {
    let presentes = 0
    let faltas = 0
    let sinMarcar = 0

    for (const emp of empleados) {
      const reg = registrosPorEmpleado?.get(`${emp.empleado_id}|${fechaSeleccionada}`)
      if (!reg) {
        sinMarcar++
      } else if (reg.es_ausencia) {
        faltas++
      } else {
        presentes++
      }
    }
    return { presentes, faltas, sinMarcar, total: empleados.length }
  }, [empleados, registrosPorEmpleado, fechaSeleccionada])

  // Marcaje individual: Presente (jornada estándar)
  async function handleMarcarPresente(emp) {
    if (!esAdmin) return
    setCargandoEmpId(emp.empleado_id)
    setExpandidoExtra(null)
    const horaEntrada = emp.hora_inicio ? String(emp.hora_inicio).slice(0, 5) : '08:00'
    const horaSalida = esSabado
      ? '13:00'
      : (emp.hora_fin ? String(emp.hora_fin).slice(0, 5) : '17:00')

    try {
      await registrar.mutateAsync({
        empleadoId: emp.empleado_id,
        fecha: fechaSeleccionada,
        horaEntrada,
        horaSalida,
        esFeriado: !!feriadoDelDia,
        esAusencia: false,
      })
    } finally {
      setCargandoEmpId(null)
    }
  }

  // Marcaje individual: Falta / Ausencia
  async function handleMarcarFalta(emp) {
    if (!esAdmin) return
    setCargandoEmpId(emp.empleado_id)
    setExpandidoExtra(null)
    try {
      await registrar.mutateAsync({
        empleadoId: emp.empleado_id,
        fecha: fechaSeleccionada,
        horaEntrada: null,
        horaSalida: null,
        esFeriado: false,
        esAusencia: true,
      })
    } finally {
      setCargandoEmpId(null)
    }
  }

  // Marcaje individual: Horas extra rápidas (+1h, +2h, +3h)
  async function handleMarcarExtra(emp, horasExtra) {
    if (!esAdmin) return
    setCargandoEmpId(emp.empleado_id)
    setExpandidoExtra(null)
    const baseSalidaH = esSabado ? 13 : 17
    const salidaH = baseSalidaH + horasExtra
    const horaSalida = `${String(salidaH).padStart(2, '0')}:00`

    try {
      await registrar.mutateAsync({
        empleadoId: emp.empleado_id,
        fecha: fechaSeleccionada,
        horaEntrada: '08:00',
        horaSalida,
        esFeriado: !!feriadoDelDia,
        esAusencia: false,
      })
    } finally {
      setCargandoEmpId(null)
    }
  }

  // Marcaje Masivo: Toda la cuadrilla en 1 toque
  async function handleMarcarTodaCuadrilla() {
    if (!esAdmin) return
    const horaSalida = esSabado ? '13:00' : '17:00'
    await registrarMasivo.mutateAsync({
      fecha: fechaSeleccionada,
      horaEntrada: '08:00',
      horaSalida,
      esFeriado: !!feriadoDelDia,
    })
  }

  return (
    <div className="space-y-3">
      {/* ─── Selector de Día Táctil (Semanal) ─── */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-2 shadow-xs">
        <div className="flex items-center justify-between pb-1.5 mb-1 border-b border-slate-100">
          <button
            type="button"
            onClick={() => onMoverSemana(-1)}
            style={{ touchAction: 'manipulation' }}
            className="p-1.5 rounded-xl text-slate-500 hover:bg-slate-100 transition-colors"
            title="Semana anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="text-center">
            <span className="text-xs font-black text-slate-800 capitalize">
              {fechaObj.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'short' })}
            </span>
            {esHoy && (
              <span className="ml-1.5 inline-flex items-center px-1.5 py-0.2 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-black">
                HOY
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onMoverSemana(1)}
            style={{ touchAction: 'manipulation' }}
            className="p-1.5 rounded-xl text-slate-500 hover:bg-slate-100 transition-colors"
            title="Semana siguiente"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Píldoras de los 7 días */}
        <div className="grid grid-cols-7 gap-1">
          {diasSemana.map(d => {
            const fechaD = iso(d)
            const sel = fechaD === fechaSeleccionada
            const esHoyD = fechaD === hoyIso
            const dowD = d.getDay()
            const esFindeD = dowD === 0 || dowD === 6

            return (
              <button
                key={fechaD}
                type="button"
                onClick={() => onCambiarFecha(fechaD)}
                style={{ touchAction: 'manipulation' }}
                className={`py-1.5 rounded-xl text-center transition-all flex flex-col items-center justify-center min-h-11 ${
                  sel
                    ? 'bg-primary text-white shadow-xs font-black'
                    : esHoyD
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 font-bold'
                    : esFindeD
                    ? 'bg-amber-50/50 text-amber-700 hover:bg-amber-100/60 font-semibold'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 font-medium'
                }`}
              >
                <span className="text-[9px] uppercase leading-none block">{DIAS_CORTOS[dowD]}</span>
                <span className="text-xs leading-tight block mt-0.5">{d.getDate()}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── Botón Masivo de 1 Clic Superior ─── */}
      {esAdmin && empleados.length > 0 && !esDomingo && (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-3.5 shadow-sm space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                <Sparkles size={14} className="text-amber-400" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">
                  {esSabado ? 'Jornada de Sábado (5h)' : 'Jornada Estándar (8h)'}
                </p>
                <p className="text-[10px] text-slate-300">
                  {resumenDia.presentes} presentes · {resumenDia.faltas} faltas · {resumenDia.sinMarcar} pendientes
                </p>
              </div>
            </div>
            {resumenDia.sinMarcar === 0 && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                <CheckCircle2 size={11} /> Todo listo
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleMarcarTodaCuadrilla}
            disabled={registrarMasivo.isPending}
            style={{ touchAction: 'manipulation' }}
            className="w-full min-h-11 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-md shadow-emerald-950/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Check size={16} />
            <span>
              {registrarMasivo.isPending
                ? 'Marcando toda la cuadrilla...'
                : esSabado
                ? 'Marcar todos presentes Sábado (08:00 a 01:00 PM)'
                : 'Marcar toda la cuadrilla presente (08:00 a 05:00 PM)'}
            </span>
          </button>
        </div>
      )}

      {/* ─── Lista de Tarjetas de Empleados ─── */}
      <div className="space-y-2">
        {empleados.map(emp => {
          const reg = registrosPorEmpleado?.get(`${emp.empleado_id}|${fechaSeleccionada}`)
          const cargandoEste = cargandoEmpId === emp.empleado_id
          const nombre = capitalizarPalabras(emp.empleado?.nombre) || 'Sin nombre'
          const esPresente = !!reg && !reg.es_ausencia
          const esFalta = !!reg?.es_ausencia
          const horasExt = Number(reg?.horas_extra || 0)
          const horasTrab = Number(reg?.horas_trabajadas || 0)
          const horasNorm = Number(reg?.horas_normales || Math.max(0, horasTrab - horasExt))
          const expandido = expandidoExtra === emp.empleado_id

          return (
            <article
              key={emp.id}
              className={`bg-white border rounded-2xl p-3 shadow-xs space-y-2.5 transition-all ${
                esFalta
                  ? 'border-red-200 bg-red-50/20'
                  : esPresente
                  ? 'border-emerald-200/90 bg-emerald-50/10'
                  : 'border-slate-200/90'
              }`}
            >
              {/* Encabezado del trabajador */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center font-black text-xs shrink-0">
                    {nombre.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-black text-slate-800 truncate" title={nombre}>
                      {nombre}
                    </h4>
                    <p className="text-[10px] text-slate-400 font-medium truncate">
                      {emp.cargo || 'Personal'}
                    </p>
                  </div>
                </div>

                {/* Badge de Estado Actual con Desglose Claro */}
                <div className="shrink-0 text-right">
                  {esFalta ? (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black bg-red-100 text-red-700 border border-red-200">
                      <UserX size={10} /> Falta
                    </span>
                  ) : esPresente ? (
                    <div className="flex flex-col items-end">
                      {horasExt > 0 ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                            <Check size={10} className="text-emerald-700" />
                            <span>{horasNorm.toFixed(1)}h</span>
                            <span className="text-amber-800 font-black">+{horasExt.toFixed(1)}h extra</span>
                          </span>
                          <span className="text-[9px] text-amber-800/90 font-bold">
                            Total: {horasTrab.toFixed(1)}h efectivas
                          </span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
                          <Check size={10} /> {horasTrab.toFixed(1)}h
                        </span>
                      )}
                      {reg.hora_entrada && reg.hora_salida && (
                        <span className="text-[9px] text-slate-400 font-medium mt-0.5">
                          {formatRangoHoras12(reg.hora_entrada, reg.hora_salida)}
                          {horasExt > 0 ? ' · extra continua' : ''}
                        </span>
                      )}
                    </div>
                  ) : esDomingo ? (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                      Domingo
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-400 border border-dashed border-slate-200">
                      Sin marcar
                    </span>
                  )}
                </div>
              </div>

              {/* Botonera de Acción Táctil (1 toque directo) */}
              {esAdmin && (
                <div className="pt-0.5 space-y-1.5">
                  <div className="grid grid-cols-4 gap-1.5">
                    {/* Botón 1: Presente */}
                    <button
                      type="button"
                      onClick={() => handleMarcarPresente(emp)}
                      disabled={cargandoEste}
                      style={{ touchAction: 'manipulation' }}
                      className={`min-h-11 py-2 px-1 rounded-xl text-[11px] font-black flex items-center justify-center gap-1 transition-all active:scale-95 ${
                        esPresente && horasExt === 0
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
                      } disabled:opacity-50`}
                      title="Marcar jornada estándar"
                    >
                      <Check size={13} />
                      <span>{esSabado ? '5h' : '8h'}</span>
                    </button>

                    {/* Botón 2: Horas Extra */}
                    <button
                      type="button"
                      onClick={() => setExpandidoExtra(expandido ? null : emp.empleado_id)}
                      disabled={cargandoEste}
                      style={{ touchAction: 'manipulation' }}
                      className={`min-h-11 py-2 px-1 rounded-xl text-[11px] font-black flex items-center justify-center gap-1 transition-all active:scale-95 ${
                        horasExt > 0
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
                      } disabled:opacity-50`}
                      title="Registrar horas extra"
                    >
                      <Plus size={13} />
                      <span>Extra</span>
                    </button>

                    {/* Botón 3: Falta */}
                    <button
                      type="button"
                      onClick={() => handleMarcarFalta(emp)}
                      disabled={cargandoEste}
                      style={{ touchAction: 'manipulation' }}
                      className={`min-h-11 py-2 px-1 rounded-xl text-[11px] font-black flex items-center justify-center gap-1 transition-all active:scale-95 ${
                        esFalta
                          ? 'bg-red-600 text-white shadow-xs'
                          : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                      } disabled:opacity-50`}
                      title="Marcar falta"
                    >
                      <UserX size={13} />
                      <span>Falta</span>
                    </button>

                    {/* Botón 4: Detalle / Editar con nota */}
                    <button
                      type="button"
                      onClick={() => onAbrirDetalle({
                        empleado: emp,
                        fecha: fechaSeleccionada,
                        registro: reg,
                        feriado: feriadoDelDia,
                      })}
                      style={{ touchAction: 'manipulation' }}
                      className="min-h-11 py-2 px-1 rounded-xl text-[11px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200 flex items-center justify-center gap-1 transition-all active:scale-95"
                      title="Editar horas exactas o agregar nota"
                    >
                      <Edit3 size={13} />
                      <span>Editar</span>
                    </button>
                  </div>

                  {/* Selector rápido de horas extra inline (1 toque) */}
                  {expandido && (
                    <div className="p-2 rounded-xl bg-amber-50/80 border border-amber-200 space-y-1.5 animate-fadeIn">
                      <p className="text-[10px] text-amber-800 font-bold px-0.5">
                        Horas extra unidas de forma continua a la salida:
                      </p>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleMarcarExtra(emp, 1)}
                          style={{ touchAction: 'manipulation' }}
                          className={`min-h-11 py-1.5 px-2 rounded-lg text-[11px] font-black text-center shadow-xs transition-all active:scale-95 ${
                            horasExt === 1 ? 'bg-amber-600 text-white ring-2 ring-amber-400' : 'bg-amber-500 hover:bg-amber-600 text-white'
                          }`}
                        >
                          +1h Extra
                          <span className="block text-[9px] font-normal opacity-90">
                            {esSabado ? 'hasta 02:00 PM' : 'hasta 06:00 PM'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMarcarExtra(emp, 2)}
                          style={{ touchAction: 'manipulation' }}
                          className={`min-h-11 py-1.5 px-2 rounded-lg text-[11px] font-black text-center shadow-xs transition-all active:scale-95 ${
                            horasExt === 2 ? 'bg-amber-600 text-white ring-2 ring-amber-400' : 'bg-amber-500 hover:bg-amber-600 text-white'
                          }`}
                        >
                          +2h Extra
                          <span className="block text-[9px] font-normal opacity-90">
                            {esSabado ? 'hasta 03:00 PM' : 'hasta 07:00 PM'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMarcarExtra(emp, 3)}
                          style={{ touchAction: 'manipulation' }}
                          className={`min-h-11 py-1.5 px-2 rounded-lg text-[11px] font-black text-center shadow-xs transition-all active:scale-95 ${
                            horasExt === 3 ? 'bg-amber-600 text-white ring-2 ring-amber-400' : 'bg-amber-500 hover:bg-amber-600 text-white'
                          }`}
                        >
                          +3h Extra
                          <span className="block text-[9px] font-normal opacity-90">
                            {esSabado ? 'hasta 04:00 PM' : 'hasta 08:00 PM'}
                          </span>
                        </button>
                      </div>

                      {horasExt > 0 && (
                        <button
                          type="button"
                          onClick={() => handleMarcarPresente(emp)}
                          style={{ touchAction: 'manipulation' }}
                          className="w-full min-h-11 py-1.5 px-3 rounded-lg bg-white hover:bg-slate-50 border border-amber-300 text-amber-900 text-xs font-bold text-center flex items-center justify-center gap-1.5 shadow-2xs transition-all active:scale-95"
                        >
                          <RotateCcw size={13} />
                          <span>Quitar horas extra (volver a {esSabado ? '5h' : '8h'} normal)</span>
                        </button>
                      )}

                      {reg && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (reg?.id) {
                              await eliminar.mutateAsync(reg.id)
                              setExpandidoExtra(null)
                            }
                          }}
                          style={{ touchAction: 'manipulation' }}
                          className="w-full min-h-11 py-1 px-3 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold text-center flex items-center justify-center gap-1.5 border border-red-200 transition-all active:scale-95"
                        >
                          <Trash2 size={13} />
                          <span>Desmarcar día (eliminar registro)</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
