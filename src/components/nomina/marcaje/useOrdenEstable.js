// src/components/nomina/marcaje/useOrdenEstable.js
// M-5 de docs/PLAN_MARCAJE_BOTONES_UX.md: durante una tanda de marcaje ninguna
// tarjeta se mueve debajo del dedo. El orden (prioridad de estado y nombre) se
// toma una vez y se congela hasta que cambie la `clave` (filtro, búsqueda, vista
// o «Actualizar»). Las tarjetas marcadas en la tanda siguen visibles aunque su
// nuevo estado ya no coincida con el filtro: se ve el resultado, no un hueco.
import { useState } from 'react'
import { PRIORIDAD_ESTADO } from './marcajeEstado.js'

function compararFilas(a, b) {
  return PRIORIDAD_ESTADO[a.estado] - PRIORIDAD_ESTADO[b.estado]
    || a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
}

function ordenDe(filas) {
  return new Map([...filas].sort(compararFilas).map((fila, indice) => [fila.empleado.empleado_id, indice]))
}

export default function useOrdenEstable(filas, clave) {
  const [foto, setFoto] = useState({ clave: null, orden: new Map(), recientes: new Set() })

  // Se recalcula al cambiar la clave o si la foto se tomó antes de tener datos.
  // Ajustar estado durante el render es el patrón de React para derivar de props.
  if (foto.clave !== clave || (foto.orden.size === 0 && filas.length > 0)) {
    setFoto({ clave, orden: ordenDe(filas), recientes: new Set() })
  }

  function ordenar(lista) {
    return [...lista].sort((a, b) => {
      const ia = foto.orden.get(a.empleado.empleado_id)
      const ib = foto.orden.get(b.empleado.empleado_id)
      if (ia !== undefined && ib !== undefined) return ia - ib
      if (ia !== undefined) return -1
      if (ib !== undefined) return 1
      return compararFilas(a, b)
    })
  }

  function marcarReciente(empleadoId) {
    setFoto(actual => (actual.recientes.has(empleadoId)
      ? actual
      : { ...actual, recientes: new Set(actual.recientes).add(empleadoId) }))
  }

  return { ordenar, recientes: foto.recientes, marcarReciente }
}
