// src/components/nomina/marcaje/AnularEntradaModal.jsx
// Confirmación con motivo para anular una entrada abierta de hoy. El motivo y el
// error viven aquí; el panel solo decide qué registro se anula y ejecuta la acción.
import { useState } from 'react'
import { Modal } from '../../../../compat/components/ui/Modal.jsx'
import { formatoHora } from './marcajeEstado.js'

export default function AnularEntradaModal({ objetivo, onConfirmar, onClose, isPending = false, bloqueado = false }) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const motivoValido = motivo.trim().length >= 3
  const sinRegistro = objetivo.resultadoEsperado === 'sin-registro'
  // M-12: el nombre llega ya capitalizado desde la tarjeta.
  const nombre = objetivo.nombre || objetivo.empleado.empleado?.nombre || objetivo.empleado.nombre

  async function confirmar() {
    if (!motivoValido || bloqueado || isPending) return
    setError('')
    try {
      await onConfirmar(motivo.trim())
    } catch (err) {
      setError(err?.message || 'No se pudo anular la entrada. Actualiza e inténtalo de nuevo.')
    }
  }

  return (
    <Modal
      isOpen
      title={sinRegistro ? 'Anular entrada' : 'Anular entrada y registrar ausencia'}
      onClose={() => { if (!isPending) onClose() }}
      busy={isPending}
      className="max-w-md"
      footer={(
        <div className="flex w-full flex-col-reverse gap-2 pb-3 sm:flex-row sm:justify-end sm:pb-4">
          <button type="button" onClick={onClose} disabled={isPending} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 disabled:opacity-50">Cancelar</button>
          <button type="button" onClick={confirmar} disabled={isPending || !motivoValido || bloqueado} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-black text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50">
            {isPending ? 'Guardando…' : sinRegistro ? 'Anular entrada' : 'Confirmar ausencia'}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-relaxed text-rose-950">
          {sinRegistro
            ? <p>Hoy no es día laborable para <strong>{nombre}</strong>: se eliminará la entrada y el día quedará sin registro (no cuenta como ausencia). La acción se conserva en auditoría.</p>
            : <p><strong>{nombre}</strong> quedará como ausente. Se limpiarán la entrada y las horas del marcaje, pero se conservará la acción en auditoría.</p>}
          <p className="mt-1 text-xs">Entrada registrada: {formatoHora(objetivo.registro.hora_entrada)}. Solo disponible mientras no tenga salida y el período siga abierto.</p>
        </div>
        <label className="block space-y-1.5 text-sm font-bold text-slate-800">
          Motivo de la anulación <span className="text-rose-600" aria-hidden="true">*</span>
          <textarea value={motivo} onChange={event => setMotivo(event.target.value)} maxLength={500} minLength={3} rows={3} disabled={isPending} placeholder="Ej.: entrada marcada por error; empleado no asistió" className="min-h-20 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[16px] font-normal leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60" />
          <span className="block text-right text-[11px] font-normal text-slate-500">{motivo.length}/500</span>
        </label>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{error}</p>}
      </div>
    </Modal>
  )
}
