// src/hooks/marcajeCache.js
// M-4 de docs/PLAN_MARCAJE_BOTONES_UX.md: la tarjeta cambia de estado en cuanto el
// servidor confirma la acción (con la fila que devuelve), sin esperar la recarga.
// La recarga sigue ocurriendo en segundo plano y es la que manda al final.
import { KEY_MARCAJE } from './nominaApi.js'

/**
 * Aplica a la caché del marcaje de hoy el resultado confirmado por el servidor.
 * - `registro`: fila nueva o actualizada (reemplaza la del mismo empleado).
 * - `empleadoId`: a quién pertenece si la fila del servidor no lo trae.
 * - `quitarRegistroId` / `quitarEmpleadoId`: la fila dejó de existir.
 */
export function aplicarMarcajeEnCache(qc, { registro = null, empleadoId = null, quitarRegistroId = null, quitarEmpleadoId = null }) {
  qc.setQueryData(KEY_MARCAJE, anterior => {
    if (!anterior || !Array.isArray(anterior.registros)) return anterior
    const duenoNuevo = registro ? (registro.empleado_id || empleadoId) : null
    const previo = duenoNuevo ? anterior.registros.find(fila => fila.empleado_id === duenoNuevo) : null
    const registros = anterior.registros.filter(fila => !(
      (quitarRegistroId && fila.id === quitarRegistroId)
      || (quitarEmpleadoId && fila.empleado_id === quitarEmpleadoId)
      || (duenoNuevo && fila.empleado_id === duenoNuevo)
    ))
    if (registro && duenoNuevo) registros.push({ ...(previo || {}), ...registro, empleado_id: duenoNuevo })
    return { ...anterior, registros }
  })
}
