// src/components/nomina/marcaje/useAccionesMarcaje.js
// Acciones diarias por excepción: horas extras, ausencias y días trabajados en descanso/feriado.
// M-4: el bloqueo es por empleado (una persona en curso no congela a las demás).
// M-14: una única región viva (`anuncio`) en el panel describe la última acción.
import { useState } from 'react'

function sinClave(mapa, clave) {
  const copia = new Map(mapa)
  copia.delete(clave)
  return copia
}

export default function useAccionesMarcaje({
  filas,
  bloqueoGlobal,
  horasExtraMut,
  diaTrabajadoMut,
  ausenciaMut,
  onExito,
}) {
  const [pendientes, setPendientes] = useState(() => new Map())
  const [error, setError] = useState('')
  const [anuncio, setAnuncio] = useState('')

  const filaDe = empleadoId => filas.find(fila => fila.empleado.empleado_id === empleadoId)
  const bloqueada = empleadoId => bloqueoGlobal || pendientes.has(empleadoId)

  async function ejecutar(empleadoId, tipo, accion) {
    setError('')
    setPendientes(actual => new Map(actual).set(empleadoId, tipo))
    try {
      const resultado = await accion()
      onExito?.(empleadoId)
      return resultado
    } finally {
      setPendientes(actual => sinClave(actual, empleadoId))
    }
  }

  async function registrarHorasExtra(empleadoId, horasExtra) {
    if (bloqueada(empleadoId)) return
    const fila = filaDe(empleadoId)
    try {
      await ejecutar(empleadoId, 'horas-extra', () => horasExtraMut.mutateAsync({
        empleadoId,
        horasExtra,
        nombre: fila?.nombre,
      }))
      const h = Number(horasExtra) || 0
      setAnuncio(h > 0
        ? `Horas extras de ${fila?.nombre || 'la persona'} guardadas (+${h} h)`
        : `Horas extras de ${fila?.nombre || 'la persona'} retiradas`)
    } catch (err) {
      setError(err?.message || 'No se pudieron guardar las horas extras. Actualiza e inténtalo de nuevo.')
    }
  }

  async function marcarDiaTrabajado(empleadoId, quitar = false) {
    if (bloqueada(empleadoId)) return
    const fila = filaDe(empleadoId)
    try {
      await ejecutar(empleadoId, quitar ? 'quitar-dia-trabajado' : 'dia-trabajado', () => diaTrabajadoMut.mutateAsync({
        empleadoId,
        quitar,
        nombre: fila?.nombre,
      }))
      setAnuncio(quitar
        ? `Día de descanso de ${fila?.nombre || 'la persona'} restaurado`
        : `Día trabajado de ${fila?.nombre || 'la persona'} registrado`)
    } catch (err) {
      setError(err?.message || 'No se pudo actualizar el día trabajado. Actualiza e inténtalo de nuevo.')
    }
  }

  async function marcarAusencia(empleadoId, quitar = false, justificada = false) {
    if (bloqueada(empleadoId)) return
    const fila = filaDe(empleadoId)
    try {
      await ejecutar(empleadoId, quitar ? 'quitar-ausencia' : 'ausencia', () => ausenciaMut.mutateAsync(quitar
        ? { empleadoId, quitar }
        : { empleadoId, quitar, justificada: justificada === true }))
      const texto = quitar
        ? 'Ausencia retirada (vuelve a presente)'
        : justificada ? 'Falta justificada registrada' : 'Falta sin justificativo registrada'
      setAnuncio(`${texto} de ${fila?.nombre || 'la persona'}`)
    } catch (err) {
      setError(err?.message || 'No se pudo actualizar la ausencia. Actualiza y vuelve a intentarlo.')
    }
  }

  function limpiarError() {
    setError('')
  }

  function estadoTarjeta(empleadoId) {
    return {
      pendiente: pendientes.get(empleadoId) || null,
      bloqueada: bloqueada(empleadoId),
    }
  }

  return {
    registrarHorasExtra,
    marcarDiaTrabajado,
    marcarAusencia,
    limpiarError,
    estadoTarjeta,
    anuncio,
    anunciar: setAnuncio,
    error,
    hayPendientes: pendientes.size > 0,
  }
}
