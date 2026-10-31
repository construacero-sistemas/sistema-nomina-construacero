// src/components/finanzas/useAccionesCategoria.jsx
// Acciones por fila del selector de categorías del formulario de movimientos:
// renombrar y eliminar (baja lógica), cada una con su diálogo. Vive aparte para
// que MovimientoForm respete el guardrail de 600 líneas.
import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { useEliminarCategoria, useRenombrarCategoria } from '../../hooks/useFinanzas.js'
import { EliminarCategoriaDialog, RenombrarCategoriaDialog } from './CategoriaAcciones.jsx'

/**
 * Devuelve `rowActions` (para el CustomSelect) y `dialogos` (elementos a renderizar).
 * `categoriasExtra` son las creadas en esta sesión y aún no reflejadas por el servidor.
 */
export default function useAccionesCategoria({ categorias, categoriasExtra, categoria, setCategoria, setCategoriasExtra }) {
  const eliminarCategoria = useEliminarCategoria()
  const renombrarCategoria = useRenombrarCategoria()
  // Borrado con confirmación; renombrado con diálogo y error inline.
  const [categoriaAEliminar, setCategoriaAEliminar] = useState(null)
  const [categoriaARenombrar, setCategoriaARenombrar] = useState(null)
  const [errorRenombrar, setErrorRenombrar] = useState('')

  // Borrado reversible: guarda el id para pedir confirmación; la mutación
  // (baja lógica) corrige la selección y restaura por si era de esta sesión.
  function confirmarEliminarCategoria(opcion) {
    const actual = categorias.find(c => c.nombre === opcion.value)
    const extra = categoriasExtra.find(c => c.nombre === opcion.value)
    const objetivo = actual || extra
    if (!objetivo?.id) return
    setCategoriaAEliminar(objetivo)
  }

  async function eliminarCategoriaConfirmada() {
    const objetivo = categoriaAEliminar
    if (!objetivo?.id) return
    try {
      await eliminarCategoria.mutateAsync({ id: objetivo.id })
      // Si la categoría eliminada estaba seleccionada, limpiar la elección.
      if (categoria === objetivo.nombre) setCategoria('')
      // Si era una creada en esta sesión, sacarla de las extras para que
      // desaparezca del selector de inmediato (el refetch cubre el resto).
      setCategoriasExtra(prev => prev.filter(c => c.nombre !== objetivo.nombre))
      setCategoriaAEliminar(null)
    } catch {
      // El hook ya mostró el toast de error; el diálogo sigue abierto para reintentar.
    }
  }

  // Abre el diálogo de renombrado para una categoría propia (las del sistema no traen id).
  function iniciarRenombrarCategoria(opcion) {
    const actual = categorias.find(c => c.nombre === opcion.value)
    if (!actual?.id) return
    setErrorRenombrar('')
    setCategoriaARenombrar(actual)
  }

  async function renombrarCategoriaConfirmada(nuevoNombre) {
    const objetivo = categoriaARenombrar
    if (!objetivo?.id) return
    try {
      const res = await renombrarCategoria.mutateAsync({ id: objetivo.id, nombre: nuevoNombre })
      const nombreFinal = res?.categoria?.nombre || nuevoNombre
      // Si estaba seleccionada, seguirla con el nombre nuevo.
      if (categoria === objetivo.nombre) setCategoria(nombreFinal)
      setCategoriasExtra(prev => prev.map(c => (c.nombre === objetivo.nombre ? { ...c, nombre: nombreFinal } : c)))
      setCategoriaARenombrar(null)
    } catch (renombrarError) {
      // El hook ya mostró el toast; el diálogo queda abierto para corregir el nombre.
      setErrorRenombrar(renombrarError.message || 'No se pudo renombrar la categoría.')
    }
  }

  const rowActions = [
    {
      label: 'Renombrar',
      icon: Pencil,
      title: 'Renombrar categoría',
      className: 'text-slate-600 hover:bg-slate-100',
      onSelect: iniciarRenombrarCategoria,
    },
    {
      label: 'Eliminar',
      icon: Trash2,
      title: 'Eliminar categoría (podrás restaurarla)',
      onSelect: confirmarEliminarCategoria,
    },
  ]

  const dialogos = (
    <>
      {categoriaARenombrar && (
        <RenombrarCategoriaDialog
          nombre={categoriaARenombrar.nombre}
          pending={renombrarCategoria.isPending}
          error={errorRenombrar}
          onClose={() => setCategoriaARenombrar(null)}
          onConfirm={renombrarCategoriaConfirmada}
        />
      )}
      {/* Confirmación de borrado de categoría (baja lógica, reversible) */}
      {categoriaAEliminar && (
        <EliminarCategoriaDialog
          nombre={categoriaAEliminar.nombre}
          movimientosCount={categoriaAEliminar.movimientos_count || 0}
          pending={eliminarCategoria.isPending}
          onClose={() => setCategoriaAEliminar(null)}
          onConfirm={eliminarCategoriaConfirmada}
        />
      )}
    </>
  )

  return { rowActions, dialogos }
}
