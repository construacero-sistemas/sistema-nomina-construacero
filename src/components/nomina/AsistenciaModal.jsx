// src/components/nomina/AsistenciaModal.jsx
// Modal de asistencia por excepción para cualquier día de la grilla o vista diaria:
// todo trabajador activo está Presente por defecto en su día laborable según su horario;
// aquí solo se marcan horas extras (desde 0.5h), ausencias (con/sin justificativo) o
// días de descanso/feriados trabajados.
import { useState } from 'react'
import { AlertCircle, CalendarCheck2, Clock, FileCheck2, FileX2, Lock, RotateCcw, UserX } from 'lucide-react'
import { useEliminarAsistencia, useHorarios, useRegistrarAsistencia } from '../../hooks/useNomina'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'
import { formatHora12 } from '../../utils/timeUtils.js'
import { semanaEditable, trabajaEseDia } from '../../utils/diasLaborables.js'
import {
  ATAJOS_HORAS_EXTRA,
  HORAS_EXTRA_MAX,
  HORAS_EXTRA_MIN,
  horarioEfectivoDelDia,
  normalizarHorasExtra,
  sumarHorasHHMM,
} from '../../../server/lib/asistenciaExcepciones.js'

const TACTIL = { touchAction: 'manipulation' }

function horasPorDiaDesdeHorarios(horarios, empleado) {
  const base = { ...(empleado?.horarios_por_dia || {}) }
  for (const row of horarios || []) {
    if (row?.trabaja === false || row?.dia_semana == null) continue
    base[row.dia_semana] = {
      hora_inicio: row.hora_inicio || null,
      hora_fin: row.hora_fin || null,
      horas_jornada: row.horas_jornada ?? null,
    }
  }
  return base
}

export default function AsistenciaModal({
  empleado,
  fecha,
  registro,
  feriado,
  esAdmin,
  puedeGestionarNomina = false,
  onClose,
  soloLectura = false,
  horasDescansoDefault = 1,
}) {
  const registrar = useRegistrarAsistencia()
  const eliminar = useEliminarAsistencia()

  const esMarcajeReal = soloLectura || ['entrada', 'completo', 'corregido'].includes(registro?.estado_marcaje)
  const puedeEditar = !!esAdmin && !esMarcajeReal

  const dow = new Date(`${fecha}T12:00:00`).getDay()
  const { data: horarios = [] } = useHorarios(empleado?.empleado_id || '')
  const semana = semanaEditable(horarios, {
    horaInicio: empleado?.hora_inicio,
    horaFin: empleado?.hora_fin,
    horasJornada: empleado?.horas_jornada,
  })
  const diaConfigurado = semana.hayHorario
    ? (semana.dias.find(dia => dia.diaSemana === dow) || null)
    : null
  const horarioBase = horarioEfectivoDelDia(
    { ...empleado, horarios_por_dia: horasPorDiaDesdeHorarios(horarios, empleado) },
    fecha,
    horasDescansoDefault,
  )
  const feriadoNoLaborable = Boolean(feriado && feriado.laborable === false)
  const diaNoLaborable = (semana.hayHorario ? !diaConfigurado : !trabajaEseDia(empleado, fecha)) || feriadoNoLaborable

  const [modo, setModo] = useState(() => (registro?.es_ausencia ? 'ausente' : 'extras'))
  const [horasTexto, setHorasTexto] = useState(() => {
    if (Number(registro?.horas_extra) > 0) return String(registro.horas_extra)
    return diaNoLaborable ? '0' : '1'
  })
  const [justificada, setJustificada] = useState(() => (registro?.es_ausencia ? registro?.ausencia_justificada === true : false))
  const [nota, setNota] = useState(registro?.nota ?? '')
  const [confirmandoRestaurar, setConfirmandoRestaurar] = useState(false)
  const [error, setError] = useState('')

  const fechaLabel = new Date(`${fecha}T12:00:00`).toLocaleDateString('es-VE', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })
  const cargando = registrar.isPending || eliminar.isPending
  const horasNum = normalizarHorasExtra(horasTexto)
  const salidaEstimada = horasNum && horasNum > 0
    ? sumarHorasHHMM(horarioBase.horaFin, horasNum)
    : horarioBase.horaFin

  async function guardar(e) {
    if (e) e.preventDefault()
    setError('')

    if (!diaNoLaborable && modo === 'ausente') {
      try {
        await registrar.mutateAsync({
          empleadoId: empleado.empleado_id,
          fecha,
          horaEntrada: null,
          horaSalida: null,
          horasDescanso: 0,
          esFeriado: Boolean(feriado),
          esAusencia: true,
          ausenciaJustificada: justificada === true,
          nota: nota.trim() || null,
          registroIdEsperado: registro?.id ?? null,
          estadoMarcajeEsperado: registro?.estado_marcaje ?? null,
        })
        onClose()
      } catch (err) {
        setError(err.message || 'No se pudo guardar la ausencia.')
      }
      return
    }

    const horasValidas = diaNoLaborable
      ? horasNum !== null
      : (horasNum !== null && horasNum >= HORAS_EXTRA_MIN)
    if (!horasValidas) {
      setError(diaNoLaborable
        ? `Indica 0 o entre ${HORAS_EXTRA_MIN} y ${HORAS_EXTRA_MAX} horas extras.`
        : `Indica entre ${HORAS_EXTRA_MIN} y ${HORAS_EXTRA_MAX} horas extras (ej. 0.5, 1.5, 2).`)
      return
    }

    try {
      await registrar.mutateAsync({
        empleadoId: empleado.empleado_id,
        fecha,
        horaEntrada: horarioBase.horaInicio,
        horaSalida: salidaEstimada,
        horasDescanso: horarioBase.horasDescanso,
        esFeriado: Boolean(feriado),
        esAusencia: false,
        ausenciaJustificada: false,
        nota: nota.trim() || null,
        registroIdEsperado: registro?.id ?? null,
        estadoMarcajeEsperado: registro?.estado_marcaje ?? null,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'No se pudo guardar la excepción.')
    }
  }

  async function restaurarHabitual() {
    if (!registro?.id) return
    setError('')
    try {
      await eliminar.mutateAsync(registro.id)
      onClose()
    } catch (err) {
      setError(err.message || 'No se pudo restaurar el estado habitual.')
    }
  }

  const tituloPrincipal = capitalizarPalabras(empleado?.empleado?.nombre) || 'Asistencia'
  const botonGuardarTexto = diaNoLaborable
    ? (registro ? 'Guardar día trabajado' : 'Marcar día trabajado')
    : modo === 'ausente' ? 'Guardar ausencia' : 'Guardar horas extras'

  return (
    <Modal isOpen onClose={onClose} title={tituloPrincipal} className="max-w-md" busy={cargando}>
      <form id="asistencia-excepcion-form" onSubmit={guardar} className="space-y-4">
        <div className={`rounded-2xl border p-3.5 ${diaNoLaborable ? 'border-slate-200 bg-slate-50' : 'border-emerald-200 bg-emerald-50/70'}`}>
          <p className="text-xs font-black capitalize text-slate-900">{fechaLabel}</p>
          {feriado && (
            <p className="mt-0.5 text-[11px] font-bold text-violet-800">
              {feriadoNoLaborable ? `Feriado no laborable: ${feriado.nombre || 'feriado'}` : `Feriado laborable: ${feriado.nombre || 'feriado'}`}
            </p>
          )}
          <p className="mt-1 text-xs font-semibold text-slate-600 tabular-nums">
            {diaNoLaborable
              ? `Día de descanso · libre por defecto (base ${formatHora12(horarioBase.horaInicio)} – ${formatHora12(horarioBase.horaFin)}, ${horarioBase.horasJornada} h)`
              : `Presente por defecto · ${formatHora12(horarioBase.horaInicio)} – ${formatHora12(horarioBase.horaFin)} (${horarioBase.horasJornada} h)`}
          </p>
        </div>

        {esMarcajeReal && (
          <div className="space-y-2 rounded-2xl border border-violet-200 bg-violet-50 p-3.5 text-xs text-violet-950">
            <div className="flex items-start gap-2">
              <Lock size={15} className="mt-0.5 shrink-0 text-violet-700" aria-hidden="true" />
              <div>
                <p className="font-black">Marcaje real del reloj — solo lectura</p>
                <p className="mt-0.5 leading-relaxed text-violet-800">
                  Registro histórico de entrada/salida ({registro?.hora_entrada ? formatHora12(registro.hora_entrada) : '—'} – {registro?.hora_salida ? formatHora12(registro.hora_salida) : 'pendiente'} · {Number(registro?.horas_trabajadas || 0).toFixed(1)} h). No se sobrescribe manualmente.
                </p>
              </div>
            </div>
            {registro?.nota && <p className="border-t border-violet-200 pt-2 text-[11px] text-violet-900">Nota: {registro.nota}</p>}
          </div>
        )}

        {puedeEditar && (
          <>
            {!diaNoLaborable && (
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de excepción del día">
                <button
                  type="button"
                  onClick={() => { setModo('extras'); setError('') }}
                  aria-pressed={modo === 'extras'}
                  style={TACTIL}
                  className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-black transition-colors ${
                    modo === 'extras'
                      ? 'border-amber-600 bg-amber-600 text-white shadow-xs'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-amber-50'
                  }`}
                >
                  <Clock size={15} aria-hidden="true" />
                  Horas extras
                </button>
                <button
                  type="button"
                  onClick={() => { setModo('ausente'); setError('') }}
                  aria-pressed={modo === 'ausente'}
                  style={TACTIL}
                  className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-black transition-colors ${
                    modo === 'ausente'
                      ? 'border-rose-700 bg-rose-700 text-white shadow-xs'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-rose-50'
                  }`}
                >
                  <UserX size={15} aria-hidden="true" />
                  Ausente
                </button>
              </div>
            )}

            {(diaNoLaborable || modo === 'extras') ? (
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                {diaNoLaborable && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-black text-violet-900">
                      <CalendarCheck2 size={15} aria-hidden="true" />
                      Horas extras opcionales en día trabajado
                    </span>
                    <button
                      type="button"
                      onClick={() => { setHorasTexto('0'); setError('') }}
                      style={TACTIL}
                      className={`min-h-9 rounded-lg border px-2.5 text-[11px] font-bold ${
                        horasNum === 0
                          ? 'border-violet-700 bg-violet-700 text-white'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      Sin extras (0h)
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Atajos de horas extras">
                  {ATAJOS_HORAS_EXTRA.map(chip => {
                    const activo = Number(horasTexto.replace(',', '.')) === chip
                    return (
                      <button
                        key={chip}
                        type="button"
                        disabled={cargando}
                        onClick={() => { setHorasTexto(String(chip)); setError('') }}
                        style={TACTIL}
                        className={`min-h-11 rounded-xl border px-2 text-xs font-black transition-colors ${
                          activo
                            ? 'border-amber-600 bg-amber-600 text-white shadow-xs'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50'
                        }`}
                      >
                        +{chip}h
                      </button>
                    )
                  })}
                </div>

                <label className="block text-xs font-bold text-slate-700">
                  {diaNoLaborable ? 'Horas extras manuales (0 o 0.5 a 16 h)' : 'Horas extras manuales (0.5 a 16 h)'}
                  <div className="relative mt-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={horasTexto}
                      disabled={cargando}
                      onChange={e => { setHorasTexto(e.target.value); setError('') }}
                      placeholder="Ej.: 0.5 o 2.5"
                      className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 pr-10 text-[16px] font-mono font-bold text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200 sm:text-sm"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">h</span>
                  </div>
                </label>

                {horasNum !== null && (diaNoLaborable || horasNum >= HORAS_EXTRA_MIN) && (
                  <p className="text-xs font-semibold text-amber-950 tabular-nums">
                    {diaNoLaborable
                      ? `Se marcará como trabajado: ${horarioBase.horasJornada} h${horasNum > 0 ? ` + ${horasNum} h extras` : ''}`
                      : `Jornada: ${horarioBase.horasJornada} h normales + ${horasNum} h extras · salida est. ${formatHora12(salidaEstimada)}`}
                  </p>
                )}
              </div>
            ) : (
              <div role="group" aria-label="¿Trae justificativo?" className="space-y-2 rounded-2xl border border-rose-200 bg-rose-50/60 p-3.5">
                <p className="text-xs font-bold text-slate-800">¿Trae justificativo?</p>
                <button
                  type="button"
                  onClick={() => setJustificada(true)}
                  aria-pressed={justificada}
                  style={TACTIL}
                  className={`flex min-h-12 w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                    justificada ? 'border-sky-500 bg-sky-50 text-sky-950 ring-2 ring-sky-200' : 'border-slate-200 bg-white text-slate-700 hover:bg-sky-50/50'
                  }`}
                >
                  <FileCheck2 size={17} className="shrink-0 text-sky-700" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-xs font-black">Con justificativo</span>
                    <span className="block text-[11px] font-medium text-sky-800">El día se paga</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setJustificada(false)}
                  aria-pressed={!justificada}
                  style={TACTIL}
                  className={`flex min-h-12 w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                    !justificada ? 'border-rose-500 bg-rose-50 text-rose-950 ring-2 ring-rose-200' : 'border-slate-200 bg-white text-slate-700 hover:bg-rose-50/50'
                  }`}
                >
                  <FileX2 size={17} className="shrink-0 text-rose-700" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-xs font-black">Sin justificativo</span>
                    <span className="block text-[11px] font-medium text-rose-800">Se descuenta solo ese día</span>
                  </span>
                </button>
              </div>
            )}

            <label className="block text-xs font-bold text-slate-700">
              Nota u observación (opcional)
              <textarea
                value={nota}
                onChange={e => setNota(e.target.value)}
                disabled={cargando}
                rows={2}
                placeholder="Ej.: permiso médico, descarga fuera de horario, apoyo en inventario..."
                className="mt-1 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-[16px] text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 sm:text-sm"
              />
            </label>
          </>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-800">
            <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {registro && puedeGestionarNomina && !esMarcajeReal && confirmandoRestaurar && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
            <span className="font-semibold">¿Quitar esta excepción y volver al estado habitual?</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmandoRestaurar(false)} disabled={cargando} style={TACTIL}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 font-bold text-slate-700">
                Cancelar
              </button>
              <button type="button" onClick={restaurarHabitual} disabled={cargando} style={TACTIL}
                className="min-h-11 rounded-lg bg-slate-800 px-3 font-bold text-white hover:bg-slate-900">
                {eliminar.isPending ? 'Restaurando…' : 'Sí, restaurar'}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          {registro && puedeGestionarNomina && !esMarcajeReal ? (
            <button
              type="button"
              onClick={() => setConfirmandoRestaurar(true)}
              disabled={cargando}
              style={TACTIL}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RotateCcw size={14} aria-hidden="true" />
              {diaNoLaborable ? 'Dejar como día libre' : 'Volver a presente'}
            </button>
          ) : <div />}

          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={cargando} style={TACTIL}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50">
              Cerrar
            </button>
            {puedeEditar && (
              <button type="submit" disabled={cargando} style={TACTIL}
                className="min-h-11 rounded-xl bg-primary px-4 text-xs font-black text-white shadow-sm hover:brightness-110 disabled:opacity-50">
                {registrar.isPending ? 'Guardando…' : botonGuardarTexto}
              </button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  )
}
