import { useLayoutEffect, useState } from 'react'

function viewportSize() {
  const viewport = window.visualViewport
  return { width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight,
    top: viewport?.offsetTop || 0, left: viewport?.offsetLeft || 0 }
}

export function useOverlayPosition({ open, anchorRef, panelRef, minWidth = 280, preferredHeight = 420 }) {
  const [viewport, setViewport] = useState(viewportSize)
  const [position, setPosition] = useState({})
  const coarse = window.matchMedia?.('(any-pointer: coarse)').matches || false
  const isMobile = viewport.width < 768 || (coarse && viewport.width < 1024)
  useLayoutEffect(() => {
    const update = () => {
      const view = viewportSize()
      setViewport(previous => Object.keys(view).every(key => view[key] === previous[key]) ? previous : view)
      if (!open || !anchorRef.current) return
      const rect = anchorRef.current.getBoundingClientRect()
      const width = Math.min(Math.max(rect.width, minWidth), view.width - 24)
      const below = view.top + view.height - rect.bottom - 12
      const above = rect.top - view.top - 12
      const goUp = below < preferredHeight && above > below
      const maxHeight = Math.max(44, Math.min(view.height - 24, goUp ? above : below))
      const height = Math.min(panelRef.current?.getBoundingClientRect().height || preferredHeight, maxHeight)
      setPosition({ position: 'fixed', width, maxHeight,
        left: Math.max(view.left + 12, Math.min(rect.left, view.left + view.width - width - 12)),
        top: Math.max(view.top + 12, goUp ? rect.top - height - 6 : Math.min(rect.bottom + 6, view.top + view.height - height - 12)) })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (anchorRef.current) observer?.observe(anchorRef.current)
    if (panelRef.current) observer?.observe(panelRef.current)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [open, anchorRef, panelRef, minWidth, preferredHeight])
  return { isMobile, position, viewport, mobileStyle: { position: 'fixed', top: viewport.top, left: viewport.left, width: viewport.width, height: viewport.height } }
}
