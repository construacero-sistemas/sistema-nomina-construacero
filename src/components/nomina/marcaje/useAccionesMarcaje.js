// src/components/nomina/marcaje/useAccionesMarcaje.js
// Acciones del marcaje real de hoy por tarjeta (docs/PLAN_MARCAJE_BOTONES_UX.md):
// - M-3: la clave de idempotencia nace en el clic; «Reintentar» la reutiliza.
// - M-4: el bloqueo es por empleado; marcar a una persona no congela a las demás.
// - M-6: tras marcar entrada o salida se ofrece «Deshacer» durante la ventana.
// - M-7: «Llegó» convierte la ausencia de hoy en entrada.
// - M-8: una salida antes del umbral pide un segundo toque (evita el doble toque).
import { useEffect, useState } from 'react'
import { makeIdempotencyKey } from '../../../hooks/idempotencia.js'
import { horaOperativaAhora } from '../../../utils/fechaOperativa.js'
import { formatHora12 } from '../../../utils/timeUtils'
import { UMBRAL_SALIDA_CORTA_MINUTOS, VENTANA_DESHACER_SEGUNDOS, minutosEntre } from '../../../../server/lib/marcajeReglas.js'

const CONFIRMACION_SALIDA_MS = 4000
// Margen para que el botón desaparezca antes de que el servidor cierre la ventana.
const MARGEN_DESHACER_MS = 5000

function sinClave(mapa, clave) {
  const copia = new Map(mapa)
  copia.delete(clave)
  return copia
}

export default function useAccionesMarcaje({ filas, bloqueoGlobal, entrada, salida, ausencia, deshacer, onExito }) {
  const [pendientes, setPendientes] = useState(() => new Map())
  const [deshacibles, setDeshacibles] = useState(() => new Map())
  const [confirmaciones, setConfirmaciones] = useState(() => new Map())
  const [error, setError] = useState('')
  const [reintento, setReintento] = useState(null)
  const [ahora, setAhora] = useState(() => Date.now())
  // M-14: texto de la región viva del panel («Entrada de X marcada a las 08:02 AM»).
  const [anuncio, setAnuncio] = useState('')

  const hayCuentaRegresiva = deshacibles.size > 0 || confirmaciones.size > 0
  useEffect(() => {
    if (!hayCuentaRegresiva) return undefined
    const intervalo = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(intervalo)
  }, [hayCuentaRegresiva])

  const filaDe = empleadoId => filas.find(fila => fila.empleado.empleado_id === empleadoId)
  const bloqueada = empleadoId => bloqueoGlobal || pendientes.has(empleadoId)

  async function ejecutar(empleadoId, tipo, accion) {
    setError('')
    setReintento(null)
    setPendientes(actual => new Map(actual).set(empleadoId, tipo))
    try {
      const resultado = await accion()
      onExito?.(empleadoId)
      return resultado
    } finally {
      setPendientes(actual => sinClave(actual, empleadoId))
    }
  }

  async function marcar(empleadoId, tipo, { reemplazarAusencia = false, claveReintento = null } = {}) {
    const fila = filaDe(empleadoId)
    const estado = fila?.estado
    const puedeEntrada = estado === 'pendiente' || estado === 'libre' || (reemplazarAusencia && estado === 'ausencia')
    if (bloqueada(empleadoId) || (tipo === 'entrada' && !puedeEntrada) || (tipo === 'salida' && estado !== 'en-curso')) return

    if (tipo === 'salida' && !claveReintento) {
      const minutos = minutosEntre(fila.registro?.hora_entrada, horaOperativaAhora())
      const confirmada = (confirmaciones.get(empleadoId)?.expira ?? 0) > Date.now()
      if (minutos !== null && minutos < UMBRAL_SALIDA_CORTA_MINUTOS && !confirmada) {
        setConfirmaciones(actual => new Map(actual).set(empleadoId, { minutos, expira: Date.now() + CONFIRMACION_SALIDA_MS }))
        setAhora(Date.now())
        return
      }
    }
    setConfirmaciones(actual => sinClave(actual, empleadoId))

    const idempotencyKey = claveReintento || makeIdempotencyKey(tipo, empleadoId)
    const variables = { empleadoId, idempotencyKey, nombre: fila?.nombre, ...(reemplazarAusencia ? { reemplazarAusencia: true } : {}) }
    try {
      const respuesta = await ejecutar(empleadoId, tipo, () => (tipo === 'entrada' ? entrada : salida).mutateAsync(variables))
      const hora = respuesta?.registro?.[tipo === 'entrada' ? 'hora_entrada' : 'hora_salida']
      setAnuncio(`${tipo === 'entrada' ? 'Entrada' : 'Salida'} de ${fila?.nombre || 'la persona'} marcada${hora ? ` a las ${formatHora12(hora)}` : ''}`)
      const registroId = respuesta?.registro?.id
      if (registroId) {
        setDeshacibles(actual => new Map(actual).set(empleadoId, {
          tipo, registroId, idempotencyKey, expira: Date.now() + VENTANA_DESHACER_SEGUNDOS * 1000 - MARGEN_DESHACER_MS,
        }))
        setAhora(Date.now())
      }
    } catch (err) {
      // Sin código HTTP no hubo respuesta: la acción pudo guardarse o no.
      if (!err?.status) {
        setReintento({ empleadoId, tipo, idempotencyKey, reemplazarAusencia })
        setError(`No hubo respuesta del servidor. Puede que la ${tipo} sí se haya guardado: «Reintentar» la repite sin duplicarla.`)
      } else {
        setError(err?.message || `No se pudo registrar la ${tipo}. Intenta actualizar y vuelve a probar.`)
      }
    }
  }

  async function marcarAusencia(empleadoId, quitar) {
    if (bloqueada(empleadoId)) return
    try {
      await ejecutar(empleadoId, quitar ? 'quitar-ausencia' : 'ausencia', () => ausencia.mutateAsync({ empleadoId, quitar }))
      setAnuncio(`${quitar ? 'Ausencia deshecha' : 'Ausencia registrada'} de ${filaDe(empleadoId)?.nombre || 'la persona'}`)
    } catch (err) {
      setError(err?.message || 'No se pudo actualizar la ausencia. Actualiza y vuelve a intentarlo.')
    }
  }

  async function deshacerUltima(empleadoId) {
    const objetivo = deshacibles.get(empleadoId)
    if (!objetivo || bloqueada(empleadoId)) return
    try {
      await ejecutar(empleadoId, `deshacer-${objetivo.tipo}`, () => deshacer.mutateAsync({
        registroId: objetivo.registroId, tipo: objetivo.tipo, idempotencyKey: objetivo.idempotencyKey,
      }))
      setAnuncio(`${objetivo.tipo === 'entrada' ? 'Entrada' : 'Salida'} de ${filaDe(empleadoId)?.nombre || 'la persona'} deshecha`)
    } catch (err) {
      setError(err?.message || 'No se pudo deshacer. Usa «Corregir marcaje».')
    } finally {
      setDeshacibles(actual => sinClave(actual, empleadoId))
    }
  }

  function reintentar() {
    if (!reintento) return
    const { empleadoId, tipo, idempotencyKey, reemplazarAusencia } = reintento
    setReintento(null)
    setError('')
    void marcar(empleadoId, tipo, { claveReintento: idempotencyKey, reemplazarAusencia })
  }

  function limpiarError() {
    setError('')
    setReintento(null)
  }

  // Lo que necesita pintar cada tarjeta, ya resuelto contra el reloj.
  function estadoTarjeta(empleadoId) {
    const objetivo = deshacibles.get(empleadoId)
    const confirmacion = confirmaciones.get(empleadoId)
    return {
      pendiente: pendientes.get(empleadoId) || null,
      bloqueada: bloqueada(empleadoId),
      deshacer: objetivo && objetivo.expira > ahora
        ? { tipo: objetivo.tipo, segundos: Math.max(1, Math.ceil((objetivo.expira - ahora) / 1000)) }
        : null,
      confirmandoSalida: confirmacion && confirmacion.expira > ahora ? { minutos: confirmacion.minutos } : null,
    }
  }

  return {
    marcar, marcarAusencia, deshacerUltima, reintentar, limpiarError, estadoTarjeta, anuncio, anunciar: setAnuncio,
    error, hayReintento: Boolean(reintento), hayPendientes: pendientes.size > 0,
  }
}
