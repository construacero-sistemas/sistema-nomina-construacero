// src/components/nomina/AsistenciaModal.jsx
// Registro y edición rápida e intuitiva de la asistencia diaria de un empleado.
import { useState } from 'react'
import { Clock, Trash2, Calendar, AlertCircle, Sparkles, UserX, Coffee } from 'lucide-react'
import { useRegistrarAsistencia, useEliminarAsistencia, useHorarios } from '../../hooks/useNomina'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { capitalizarPalabras } from '../../utils/cuentasCustodiaUtils.js'
import { formatHora12 } from '../../utils/timeUtils.js'
import { semanaEditable } from '../../utils/diasLaborables.js'

/** Horas de permanencia entre dos HH:MM (la salida anterior a la entrada cruza medianoche). */
function permanenciaEnHoras(entrada, salida) {
  const aMinutos = valor => {
    const [horas, minutos] = String(valor || '').slice(0, 5).split(':').map(Number)
    return Number.isFinite(horas) ? horas * 60 + (minutos || 0) : null
  }
  const inicio = aMinutos(entrada)
  let fin = aMinutos(salida)
  if (inicio === null || fin === null) return null
  if (fin < inicio) fin += 24 * 60
  return Math.max(0, (fin - inicio) / 60)
}

/** Suma horas a un HH:MM (para los atajos de «+1h / +2h extra»). */
function sumarHoras(hora, horas) {
  const [h, m] = String(hora || '').slice(0, 5).split(':').map(Number)
  if (!Number.isFinite(h)) return null
  const total = (h * 60 + (m || 0) + horas * 60) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50 transition-all font-mono'

// Registrar o corregir un día exige `verNomina` (lo que `esAdmin`/administrarNomina
// ya implica), pero ELIMINAR el registro exige `gestionarUsuarios` en el servidor:
// por eso el botón de borrado se gatea con `puedeGestionarNomina`.
export default function AsistenciaModal({ empleado, fecha, registro, feriado, esAdmin, puedeGestionarNomina = false, onClose, soloLectura = false, horasDescansoDefault = 1 }) {
  const registrar = useRegistrarAsistencia()
  const eliminar  = useEliminarAsistencia()

  const esMarcajeReal = soloLectura || ['entrada', 'completo', 'corregido'].includes(registro?.estado_marcaje)
  const puedeEditar = !!esAdmin && !esMarcajeReal

  const dow = new Date(`${fecha}T12:00:00`).getDay()
  const esSabado = dow === 6

  // F-8: los valores por defecto salen del día configurado de ESTA persona en su
  // semana laboral («Días que trabaja»). El 08:00–17:00 genérico y el 13:00 del
  // sábado solo aplican cuando su ficha no tiene semana configurada: antes el modal
  // proponía un horario distinto al de la persona.
  const { data: horarios = [] } = useHorarios(empleado?.empleado_id || '')
  const semana = semanaEditable(horarios, {
    horaInicio: empleado?.hora_inicio, horaFin: empleado?.hora_fin, horasJornada: empleado?.horas_jornada,
  })
  const diaConfigurado = semana.hayHorario
    ? (semana.dias.find(dia => dia.diaSemana === dow) || null)
    : null
  const jornada = Number(diaConfigurado?.horasJornada ?? empleado?.horas_jornada) || 8
  // Descanso derivado de la ficha: lo que sobra entre la permanencia prevista y la
  // jornada efectiva del día (una jornada de 8 h con 08:00–17:00 descansa 1 h).
  const descansoDeFicha = diaConfigurado
    ? Math.max(0, Math.round(((permanenciaEnHoras(diaConfigurado.horaInicio, diaConfigurado.horaFin) ?? 0) - Number(diaConfigurado.horasJornada)) * 100) / 100)
    : null

  const entradaInicial = String(registro?.hora_entrada ?? diaConfigurado?.horaInicio ?? empleado?.hora_inicio ?? '08:00').slice(0, 5)
  const salidaInicial = String(registro?.hora_salida ?? diaConfigurado?.horaFin ?? empleado?.hora_fin ?? (esSabado ? '13:00' : '17:00')).slice(0, 5)
  const descansoInicial = registro?.horas_descanso != null
    ? String(registro.horas_descanso)
    : (descansoDeFicha != null ? String(descansoDeFicha) : (esSabado ? '0' : String(horasDescansoDefault)))
  // Base de los atajos: el día configurado de su semana o, sin ella, la ficha.
  const inicioAtajo = diaConfigurado?.horaInicio ?? String(empleado?.hora_inicio ?? '08:00').slice(0, 5)
  const finAtajo = diaConfigurado?.horaFin ?? String(empleado?.hora_fin ?? (esSabado ? '13:00' : '17:00')).slice(0, 5)
  const descansoAtajo = descansoDeFicha != null ? String(descansoDeFicha) : (esSabado ? '0' : String(horasDescansoDefault))
  const etiquetaJornada = diaConfigurado ? `Su semana: ${diaConfigurado.horasJornada}h` : `${jornada}h de jornada`
  const feriadoInicial = registro?.es_feriado ?? !!feriado
  const ausenciaInicial = registro?.es_ausencia ?? false
  const [horaEntrada, setHoraEntrada] = useState(entradaInicial)
  const [horaSalida, setHoraSalida] = useState(salidaInicial)
  const [horasDescanso, setHorasDescanso] = useState(descansoInicial)
  const [esFeriado, setEsFeriado]   = useState(feriadoInicial)
  const [esAusencia, setEsAusencia] = useState(ausenciaInicial)
  const [nota, setNota]             = useState(registro?.nota ?? '')
  const [confirmandoBorrar, setConfirmandoBorrar] = useState(false)
  const [error, setError] = useState('')

  // Preview dinámico de horas calculadas con descanso deducido
  const preview = (() => {
    if (esAusencia || !horaEntrada || !horaSalida) return { permanencia: 0, descanso: 0, total: 0, normales: 0, extra: 0 }
    const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0) }
    let sal = toMin(horaSalida)
    const ent = toMin(horaEntrada)
    if (sal <= ent) sal += 24 * 60
    const permanencia = Math.max(0, (sal - ent) / 60)
    const descNum = Number(horasDescanso)
    const descanso = Number.isFinite(descNum) && descNum >= 0 ? descNum : 0
    const total = Math.max(0, permanencia - descanso)
    return {
      permanencia,
      descanso,
      total,
      normales: Math.min(total, jornada),
      extra: Math.max(0, total - jornada),
    }
  })()

  const fechaLabel = new Date(`${fecha}T12:00:00`).toLocaleDateString('es-VE', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })

  const cargando = registrar.isPending || eliminar.isPending

  function aplicarPreset(entrada, salida, descanso = esSabado ? '0' : String(horasDescansoDefault)) {
    setEsAusencia(false)
    setHoraEntrada(entrada)
    setHoraSalida(salida)
    setHorasDescanso(descanso)
  }

  function marcarAusenciaRapida() {
    setEsAusencia(true)
    setEsFeriado(false)
  }

  async function guardar(e) {
    if (e) e.preventDefault()
    setError('')
    if (!esAusencia && (!horaEntrada || !horaSalida)) {
      setError('Indica hora de entrada y salida, o marca el día como ausencia')
      return
    }
    try {
      await registrar.mutateAsync({
        empleadoId: empleado.empleado_id,
        fecha,
        registroIdEsperado: registro?.id || null,
        estadoMarcajeEsperado: registro?.estado_marcaje || null,
        horaEntrada: esAusencia ? null : horaEntrada,
        horaSalida:  esAusencia ? null : horaSalida,
        esFeriado, esAusencia,
        horasDescanso: Number(horasDescanso) || 0,
        nota: nota || undefined,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'Error al registrar')
    }
  }

  async function borrar() {
    try {
      await eliminar.mutateAsync(registro.id)
      onClose()
    } catch (err) {
      setError(err.message || 'Error al eliminar')
    }
  }

  return (
    <Modal
      isOpen onClose={onClose}
      busy={cargando}
      dirty={puedeEditar && (horaEntrada !== entradaInicial || horaSalida !== salidaInicial || horasDescanso !== descansoInicial || esFeriado !== feriadoInicial || esAusencia !== ausenciaInicial || nota !== (registro?.nota ?? ''))}
      title={capitalizarPalabras(empleado?.empleado?.nombre) || 'Registro de Asistencia'}
      className="max-w-md">
      <div className="space-y-4">
        {esMarcajeReal && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm leading-relaxed text-violet-950">
            Este es un marcaje real del reloj. Para mantenerlo protegido, aquí se muestra solo en lectura; consúltalo o corrígelo desde <strong>Marcaje real</strong>.
          </div>
        )}
        {/* Cabecera del día */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-800 capitalize">{fechaLabel}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Jornada laboral configurada: <strong className="text-slate-700">{jornada} horas</strong>
            </p>
          </div>
          {feriado ? (
            <span className="px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 text-[10px] font-bold border border-purple-200">
              {feriado.nombre || 'Feriado'}
            </span>
          ) : esSabado && !diaConfigurado ? (
            <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 text-[10px] font-bold border border-amber-200">
              Sábado Rotativo
            </span>
          ) : null}
        </div>

        {esSabado && !diaConfigurado && (
          <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-2.5 text-[11px] text-amber-900 leading-relaxed">
            <strong>Sábado Rotativo:</strong> Registra la jornada si el trabajador laboró este fin de semana para computar su pago de sábado. Si disfrutó de su descanso reglamentario, no es necesario registrar marcaje.
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700 font-medium">
            {error}
          </div>
        )}

        {/* Presets Rápidos de 1 Toque */}
        {puedeEditar && (
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Atajos Rápidos
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => aplicarPreset(inicioAtajo, finAtajo, descansoAtajo)}
                className="py-2 px-2 rounded-xl bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 text-emerald-800 text-[11px] font-bold transition-all text-center min-h-11 flex flex-col items-center justify-center"
                style={{ touchAction: 'manipulation' }}
              >
                {formatHora12(inicioAtajo)} – {formatHora12(finAtajo)}
                <span className="block text-[9px] font-normal text-emerald-600">{etiquetaJornada}</span>
              </button>

              <button
                type="button"
                onClick={() => aplicarPreset(inicioAtajo, sumarHoras(finAtajo, 1), descansoAtajo)}
                className="py-2 px-2 rounded-xl bg-amber-50 hover:bg-amber-100/80 border border-amber-200 text-amber-800 text-[11px] font-bold transition-all text-center min-h-11 flex flex-col items-center justify-center"
                style={{ touchAction: 'manipulation' }}
              >
                {formatHora12(inicioAtajo)} – {formatHora12(sumarHoras(finAtajo, 1))}
                <span className="block text-[9px] font-normal text-amber-600">+1h Extra</span>
              </button>

              <button
                type="button"
                onClick={() => aplicarPreset(inicioAtajo, sumarHoras(finAtajo, 2), descansoAtajo)}
                className="py-2 px-2 rounded-xl bg-amber-50 hover:bg-amber-100/80 border border-amber-200 text-amber-800 text-[11px] font-bold transition-all text-center min-h-11 flex flex-col items-center justify-center"
                style={{ touchAction: 'manipulation' }}
              >
                {formatHora12(inicioAtajo)} – {formatHora12(sumarHoras(finAtajo, 2))}
                <span className="block text-[9px] font-normal text-amber-600">+2h Extra</span>
              </button>

              <button
                type="button"
                onClick={marcarAusenciaRapida}
                className="py-2 px-2 rounded-xl bg-red-50 hover:bg-red-100/80 border border-red-200 text-red-700 text-[11px] font-bold transition-all text-center min-h-11 flex flex-col items-center justify-center"
                style={{ touchAction: 'manipulation' }}
              >
                Falta / Ausencia
                <span className="block text-[9px] font-normal text-red-500">Injustificada</span>
              </button>
            </div>
          </div>
        )}

        <form id="asistencia-manual-form" onSubmit={guardar} className="space-y-4 pt-1">
          {/* Opciones del día */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="min-h-11 flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox" checked={esAusencia}
                onChange={e => { setEsAusencia(e.target.checked); if (e.target.checked) setEsFeriado(false) }}
                disabled={cargando || !puedeEditar}
                className="w-4 h-4 rounded border-slate-300 text-red-500 focus:ring-red-400"
              />
              Marcar como Ausencia / No asistió
            </label>
            <label className="min-h-11 flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox" checked={esFeriado}
                onChange={e => setEsFeriado(e.target.checked)}
                disabled={cargando || !puedeEditar || esAusencia}
                className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-400"
              />
              Día feriado
            </label>
          </div>

          {/* Horas y Descanso */}
          {!esAusencia && (
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <Clock size={13} className="text-slate-400" />
                    Hora de Entrada
                  </label>
                  <input type="time" value={horaEntrada} onChange={e => setHoraEntrada(e.target.value)}
                    className={inputCls} disabled={cargando || !puedeEditar} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <Clock size={13} className="text-slate-400" />
                    Hora de Salida
                  </label>
                  <input type="time" value={horaSalida} onChange={e => setHoraSalida(e.target.value)}
                    className={inputCls} disabled={cargando || !puedeEditar} />
                </div>
              </div>

              {/* Selector de Descanso / Hora Libre */}
              <div className="pt-1.5 border-t border-slate-200/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1">
                    <Coffee size={13} className="text-slate-400" />
                    Descanso / Hora Libre
                  </label>
                  <span className="text-[11px] font-bold text-slate-600 font-mono">
                    {Number(horasDescanso) === 0 ? 'Sin descanso (0h)' : `${Number(horasDescanso)}h`}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { label: '0h', val: '0' },
                    { label: '30 min', val: '0.5' },
                    { label: '45 min', val: '0.75' },
                    { label: '1 hora', val: '1' },
                  ].map(chip => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => setHorasDescanso(chip.val)}
                      disabled={cargando || !puedeEditar}
                      className={`py-1.5 px-1 rounded-xl text-[11px] font-bold transition-all text-center min-h-9 ${
                        String(horasDescanso) === chip.val
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      } disabled:opacity-50`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Preview interactivo de Horas */}
          {!esAusencia && preview.total > 0 && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-2 text-center">
                  <span className="text-[10px] text-slate-400 font-bold block">
                    {preview.descanso > 0 ? `${preview.permanencia.toFixed(1)}h − ${preview.descanso.toFixed(1)}h` : 'Estancia'}
                  </span>
                  <span className="text-sm font-black text-slate-800">{preview.total.toFixed(1)}h efec.</span>
                </div>
                <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-2 text-center">
                  <span className="text-[10px] text-emerald-700 font-bold block">Normales</span>
                  <span className="text-sm font-black text-emerald-800">{preview.normales.toFixed(1)}h</span>
                </div>
                <div className={`border rounded-xl p-2 text-center ${preview.extra > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
                  <span className="text-[10px] font-bold block">Horas Extra</span>
                  <span className="text-sm font-black">{preview.extra > 0 ? `+${preview.extra.toFixed(1)}h` : '0.0h'}</span>
                </div>
              </div>

              {preview.extra > 0 && (
                <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium leading-relaxed">
                  La salida hasta las <strong>{formatHora12(horaSalida)}</strong> incluye <strong>+{preview.extra.toFixed(1)}h extra</strong> continuas unidas al horario habitual.
                </div>
              )}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Nota u observación (opcional)</label>
            <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2}
              placeholder="Ej: Llegó 15 min tarde, permiso médico, apoyo en despacho..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
              disabled={cargando || !puedeEditar} />
          </div>
        </form>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-3 mt-4 border-t border-slate-100">
        {registro && puedeGestionarNomina && !esMarcajeReal ? (
          confirmandoBorrar ? (
            <div className="flex items-center gap-1.5">
              <button onClick={borrar} disabled={cargando}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-50">
                Sí, eliminar
              </button>
              <button onClick={() => setConfirmandoBorrar(false)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">
                Cancelar
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmandoBorrar(true)} disabled={cargando} aria-label="Eliminar registro de asistencia"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
              <Trash2 size={14} aria-hidden="true" /> Eliminar
            </button>
          )
        ) : <span />}

        <div className="flex gap-2">
          <button onClick={onClose} type="button" disabled={cargando}
            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-50">
            Cerrar
          </button>
          {puedeEditar && (
            <button disabled={cargando}
              type="submit" form="asistencia-manual-form"
              className="px-5 py-2 min-h-11 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-primary/20 transition-all active:scale-95">
              {registrar.isPending ? 'Guardando...' : 'Guardar asistencia'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
