// compat/hooks/useTablistNav.js
// Navegación por teclado para tablists (patrón ARIA tabs): flechas, Home y End
// mueven la selección y el foco (roving tabindex). Requiere que cada tab sea
// focusable con el id indicado en `ids`.
import { useCallback } from 'react'

export default function useTablistNav(ids, activeId, onSelect) {
  return useCallback(event => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (!ids.length) return
    const current = ids.indexOf(activeId)
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? ids.length - 1
        : event.key === 'ArrowRight'
          ? (current + 1 + ids.length) % ids.length
          : (current - 1 + ids.length) % ids.length
    const nextId = ids[next]
    onSelect(nextId)
    requestAnimationFrame(() => document.getElementById(nextId)?.focus())
  }, [ids, activeId, onSelect])
}
