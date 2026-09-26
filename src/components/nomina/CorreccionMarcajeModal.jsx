import { useId, useRef, useState } from 'react'
import { ArrowRight, Check, Clock3, LoaderCircle } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { formatHora12 } from '../../utils/timeUtils.js'

function minutos(hora) {
  const [horas, minutosHora] = hora.split(':').map(Number)
  return horas * 60 + minutosHora
}

function calcularVistaPrevia(entrada, salida, descanso, jornada) {
  if (!entrada || !salida || entrada === salida) return null
  const entradaMinutos = minutos(entrada)
  let salidaMinutos = minutos(salida)
  if (salidaMinutos <= entradaMinutos) salidaMinutos += 24 * 60
  const trabajadas = Math.max(0, (salidaMinutos - entradaMinutos) / 60 - descanso)
  return {
    trabajadas,
    normales: Math.min(trabajadas, jornada),
    extra: Math.max(0, trabajadas - jornada),
  }
}

function HoraCambio({ etiqueta, anterior, nueva }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="w-16 shrink-0 font-semibold text-slate-600">{etiqueta}</span>
      <span className="tabular-nums text-slate-500">{formatHora12(anterior)}</span>
      <ArrowRight size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
      <strong className="tabular-nums text-slate-900">{formatHora12(nueva)}</strong>
    </div>
  )
}

export default function CorreccionMarcajeModal({
  empleado,
  registro,
  horasDescansoDefault = 1,
  onClose,
  onGuardar,
  isSaving = false,
}) {
  const formId = useId()
  const entradaRef = useRef(null)
  const horaEntradaOriginal = String(registro.hora_entrada || '').slice(0, 5)
  const tieneSalida = Boolean(registro.hora_salida)
  const horaSalidaOriginal = tieneSalida ? String(registro.hora_salida).slice(0, 5) : null
  const [horaEntrada, setHoraEntrada] = useState(horaEntradaOriginal)
  const [horaSalida, setHoraSalida] = useState(horaSalidaOriginal || '')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')

  const empleadoNombre = empleado.empleado?.nombre || empleado.nombre || 'Empleado'
  const fechaSabado = new Date(`${registro.fecha}T12:00:00`).getDay() === 6
  const horasDescanso = registro.horas_descanso != null
    ? Number(registro.horas_descanso)
    : (fechaSabado ? 0 : Number(horasDescansoDefault) || 0)
  const horasJornada = Number(empleado.horas_jornada) || 8
  const vistaPrevia = tieneSalida
    ? calcularVistaPrevia(horaEntrada, horaSalida, horasDescanso, horasJornada)
    : null
  const hayCambios = horaEntrada !== horaEntradaOriginal
    || (tieneSalida && horaSalida !== horaSalidaOriginal)
  const horasValidas = horaEntrada.length === 5
    && (!tieneSalida || (horaSalida.length === 5 && horaEntrada !== horaSalida))
  const guardarHabilitado = hayCambios && horasValidas && motivo.trim().length >= 3 && !isSaving

  async function guardar(event) {
    event.preventDefault()
    if (!guardarHabilitado) return
    setError('')
    try {
      await onGuardar({
        registroId: registro.id,
        horaEntradaAnterior: horaEntradaOriginal,
        horaSalidaAnterior: horaSalidaOriginal,
        horaEntrada,
        horaSalida: horaSalidaOriginal === null ? null : horaSalida,
        motivo: motivo.trim(),
      })
      onClose()
    } catch (saveError) {
      setError(saveError?.message || 'No se pudo guardar la corrección. Actualiza los marcajes e inténtalo de nuevo.')
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Corregir marcaje — ${empleadoNombre}`}
      className="sm:max-w-lg"
      busy={isSaving}
      dirty={hayCambios || Boolean(motivo.trim())}
      initialFocusRef={entradaRef}
      footer={(
        <div className="flex w-full flex-col-reverse gap-2 pb-3 sm:flex-row sm:justify-end sm:pb-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form={formId}
            disabled={!guardarHabilitado}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-black text-white shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving
              ? <><LoaderCircle size={16} className="animate-spin" aria-hidden="true" />Guardando…</>
              : <><Check size={16} aria-hidden="true" />Guardar corrección</>}
          </button>
        </div>
      )}
    >
      <form id={formId} onSubmit={guardar} className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-950">
          <strong>Corrección de marcaje real.</strong> Se conservará el registro de auditoría con el valor anterior, el nuevo y el motivo.
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
          <div className="flex items-center gap-2 text-sm font-black text-slate-800">
            <Clock3 size={16} className="text-slate-500" aria-hidden="true" />
            Horas reales
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-bold text-slate-700">
              Hora de entrada
              <input
                ref={entradaRef}
                type="time"
                required
                value={horaEntrada}
                onChange={event => setHoraEntrada(event.target.value)}
                disabled={isSaving}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-[16px] font-semibold tabular-nums text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
              />
            </label>
            {tieneSalida && (
              <label className="space-y-1.5 text-xs font-bold text-slate-700">
                Hora de salida
                <input
                  type="time"
                  required
                  value={horaSalida}
                  onChange={event => setHoraSalida(event.target.value)}
                  disabled={isSaving}
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-[16px] font-semibold tabular-nums text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                />
              </label>
            )}
          </div>
          {!tieneSalida && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-950">
              La jornada sigue en curso. Solo cambiaremos la entrada; la salida permanecerá pendiente y <strong>no se marcará automáticamente</strong>.
            </p>
          )}
        </div>

        <section aria-label="Vista previa de la corrección" className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3.5">
          <h4 className="text-xs font-black uppercase tracking-wide text-slate-500">Antes → después</h4>
          <HoraCambio etiqueta="Entrada" anterior={horaEntradaOriginal} nueva={horaEntrada || '—'} />
          {tieneSalida && <HoraCambio etiqueta="Salida" anterior={horaSalidaOriginal} nueva={horaSalida || '—'} />}
          {tieneSalida && (
            <div className="mt-2 border-t border-slate-100 pt-2 text-sm">
              {vistaPrevia ? (
                <>
                  <p className="font-bold text-slate-800">
                    Horas trabajadas: {Number(registro.horas_trabajadas || 0).toFixed(2)} h
                    <ArrowRight size={14} className="mx-1 inline text-slate-400" aria-hidden="true" />
                    {vistaPrevia.trabajadas.toFixed(2)} h
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {vistaPrevia.normales.toFixed(2)} h normales · {vistaPrevia.extra.toFixed(2)} h extra
                    {horasDescanso > 0 ? ` · ${horasDescanso} h de descanso` : ''}
                  </p>
                </>
              ) : (
                <p className="text-xs font-semibold text-rose-700">La entrada y la salida no pueden ser iguales.</p>
              )}
            </div>
          )}
        </section>

        <label className="block space-y-1.5 text-xs font-bold text-slate-700">
          Motivo de la corrección <span className="text-rose-600" aria-hidden="true">*</span>
          <textarea
            required
            minLength={3}
            maxLength={500}
            rows={3}
            value={motivo}
            onChange={event => setMotivo(event.target.value)}
            disabled={isSaving}
            placeholder="Ej.: Error de digitación, validado con el supervisor"
            className="min-h-20 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[16px] font-normal leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60 sm:text-sm"
          />
          <span className="block text-right text-[11px] font-normal text-slate-500">{motivo.length}/500</span>
        </label>

        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{error}</p>}
      </form>
    </Modal>
  )
}
