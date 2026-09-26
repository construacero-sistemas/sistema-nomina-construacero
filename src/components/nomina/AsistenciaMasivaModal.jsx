// src/components/nomina/AsistenciaMasivaModal.jsx
// Aplica horarios previstos solo a personas pendientes, con vista previa y confirmación explícita.
import { useMemo, useState } from 'react'
import { Check, Clock, Users } from 'lucide-react'
import { useRegistrarAsistenciaMasivo, useConfigNomina } from '../../hooks/useNomina'
import { Modal } from '../../../compat/components/ui/Modal.jsx'

const inputCls = 'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[16px] font-semibold tabular-nums text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60'

function normalizarHora(valor) {
  const limpio = String(valor ?? '').slice(0, 5)
  return /^\d{2}:\d{2}$/.test(limpio) ? limpio : null
}

function calcularHoras(entrada, salida, descanso, jornada) {
  if (!entrada || !salida || entrada === salida) return null
  const toMinutes = time => {
    const [hours, minutes] = time.split(':').map(Number)
    return hours * 60 + minutes
  }
  const start = toMinutes(entrada)
  let end = toMinutes(salida)
  if (end <= start) end += 24 * 60
  const worked = Math.max(0, (end - start) / 60 - descanso)
  return { total: worked, normal: Math.min(worked, jornada), extra: Math.max(0, worked - jornada) }
}

export default function AsistenciaMasivaModal({
  fechaInicial,
  empleadoIds = [],
  empleados = [],
  onClose,
}) {
  const registrar = useRegistrarAsistenciaMasivo()
  const { data: configNomina } = useConfigNomina()
  const [esFeriado, setEsFeriado] = useState(false)
  const [error, setError] = useState('')
  const [confirmando, setConfirmando] = useState(false)

  // F-8: el horario previsto parte del horario general de la empresa
  // (`configuracion_negocio`), no de un 08:00–17:00 escrito a mano. Se deriva en el
  // render: si la configuración llega después, las horas se actualizan solas, y en
  // cuanto el operador escribe una hora manda lo escrito. El horario por persona (su
  // semana) solo se puede fijar de a uno: el lote es por fecha.
  const esSabado = Boolean(fechaInicial) && new Date(`${fechaInicial}T12:00:00`).getDay() === 6
  const [horaEntradaManual, setHoraEntradaManual] = useState(null)
  const [horaSalidaManual, setHoraSalidaManual] = useState(null)
  const horaEntrada = horaEntradaManual ?? normalizarHora(configNomina?.nomina_hora_inicio) ?? '08:00'
  const horaSalida = horaSalidaManual ?? normalizarHora(configNomina?.nomina_hora_fin) ?? (esSabado ? '13:00' : '17:00')

  const cargando = registrar.isPending
  const descanso = esSabado ? 0 : Number(configNomina?.nomina_horas_descanso ?? 1)
  const empleadosSeleccionados = useMemo(() => {
    const ids = new Set(empleadoIds)
    return empleados.filter(empleado => ids.has(empleado.empleado_id))
  }, [empleadoIds, empleados])
  const fechaLabel = fechaInicial
    ? new Date(`${fechaInicial}T12:00:00`).toLocaleDateString('es-VE', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
      })
    : ''
  const jornadas = empleadosSeleccionados.map(employee => Number(employee.horas_jornada) || 8)
  const jornadasDistintas = new Set(jornadas).size > 1
  const preview = calcularHoras(horaEntrada, horaSalida, descanso, Math.max(0.5, ...jornadas))
  const empleadosResumen = empleadosSeleccionados.slice(0, 4)
    .map(employee => employee.empleado?.nombre || employee.nombre || 'Empleado')
  const cantidadRestante = Math.max(0, empleadoIds.length - empleadosResumen.length)

  async function guardar() {
    setError('')
    if (!empleadoIds.length) {
      setError('No hay empleados pendientes para esta fecha. Actualiza los registros e inténtalo de nuevo.')
      return
    }
    if (!horaEntrada || !horaSalida || horaEntrada === horaSalida) {
      setError('Indica horas previstas válidas; entrada y salida no pueden ser iguales.')
      return
    }
    if (!confirmando) {
      setConfirmando(true)
      return
    }
    try {
      await registrar.mutateAsync({
        fecha: fechaInicial,
        horaEntrada,
        horaSalida,
        esFeriado,
        horasDescanso: descanso,
        empleadoIds,
      })
      onClose()
    } catch (err) {
      setError(err.message || 'No se pudo aplicar el horario. Actualiza la asistencia y revisa los registros.')
      setConfirmando(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Vista previa · horario manual" className="max-w-md" busy={cargando}>
      <div className="space-y-4">
        <form id="asistencia-masiva-form" onSubmit={event => { event.preventDefault(); void guardar() }} className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-3.5">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-900">
            <Users size={17} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black text-sky-950">{empleadoIds.length} empleado(s) pendiente(s)</p>
            <p className="mt-0.5 text-xs capitalize text-sky-900">{fechaLabel}</p>
            <p className="mt-1 text-xs leading-relaxed text-sky-900">Solo se aplicará a personas sin registro manual ni marcaje real. No reemplaza datos existentes.</p>
          </div>
        </div>

        <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3.5" aria-label="Personas incluidas">
          <h4 className="text-xs font-black uppercase tracking-wide text-slate-500">Personas incluidas</h4>
          {empleadosResumen.length > 0 ? (
            <p className="text-sm text-slate-800">
              {empleadosResumen.join(', ')}{cantidadRestante ? ` y ${cantidadRestante} más` : ''}
            </p>
          ) : (
            <p className="text-sm text-slate-600">La lista cambió o no se pudo cargar. Cierra y actualiza la asistencia.</p>
          )}
        </section>

        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{error}</p>}

        <div className="space-y-2">
          <span className="text-xs font-black uppercase tracking-wide text-slate-500">Horario previsto</span>
          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
            <label className="space-y-1.5 text-xs font-bold text-slate-700">
              Entrada
              <input type="time" value={horaEntrada} onChange={event => { setHoraEntradaManual(event.target.value); setConfirmando(false) }} disabled={cargando} className={inputCls} />
            </label>
            <label className="space-y-1.5 text-xs font-bold text-slate-700">
              Salida
              <input type="time" value={horaSalida} onChange={event => { setHoraSalidaManual(event.target.value); setConfirmando(false) }} disabled={cargando} className={inputCls} />
            </label>
          </div>
          <p className="text-xs text-slate-600">
            Descanso aplicado: <strong>{descanso} h</strong>{esSabado ? ' (sábado)' : ' (configuración de nómina)'}.
          </p>
          {preview ? (
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
              <div><span className="block text-[10px] font-bold text-slate-600">Efectivas</span><strong className="text-sm text-slate-900">{preview.total.toFixed(2)} h</strong></div>
              <div><span className="block text-[10px] font-bold text-emerald-800">Normales</span><strong className="text-sm text-emerald-900">{preview.normal.toFixed(2)} h</strong></div>
              <div><span className="block text-[10px] font-bold text-amber-800">Extra</span><strong className="text-sm text-amber-900">{preview.extra.toFixed(2)} h</strong></div>
            </div>
          ) : <p className="text-xs font-semibold text-rose-700">La entrada y la salida no pueden ser iguales.</p>}
          {preview && jornadasDistintas && (
            <p className="text-[11px] leading-relaxed text-slate-500">
              La jornada varía entre las personas seleccionadas; la vista previa usa la jornada mayor y el servidor reparte normales y extra según la jornada de cada quien.
            </p>
          )}
        </div>

        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={esFeriado} onChange={event => { setEsFeriado(event.target.checked); setConfirmando(false) }} disabled={cargando}
            className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-400" />
          Registrar como día feriado
        </label>
        </form>

        {confirmando && (
          <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-relaxed text-amber-950">
            Confirma aplicar este horario a <strong>{empleadoIds.length} empleado(s)</strong> el <strong>{fechaLabel}</strong>. Si algún registro cambia antes de guardar, el servidor cancelará toda la operación.
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} disabled={cargando}
          className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          Cancelar
        </button>
        {confirmando && (
          <button type="button" onClick={() => setConfirmando(false)} disabled={cargando}
            className="min-h-11 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-900">
            Revisar horario
          </button>
        )}
        <button type="submit" form="asistencia-masiva-form" disabled={cargando || !empleadoIds.length || !preview}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-black text-white shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50">
          {confirmando ? <Check size={16} aria-hidden="true" /> : <Clock size={16} aria-hidden="true" />}
          {cargando ? 'Aplicando…' : confirmando ? 'Confirmar aplicación' : 'Revisar aplicación'}
        </button>
      </div>
    </Modal>
  )
}
