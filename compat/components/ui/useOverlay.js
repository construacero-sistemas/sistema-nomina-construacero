import { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react'

export const OverlayContext = createContext(null)

const entries = []
const subscribers = new Set()
const hidden = new Map()
let revision = 0
let unlockScroll = null
let observer = null
let redirectingFocus = false
const focusSelector = 'button, [href], input, select, textarea, [tabindex], [contenteditable="true"]'

function top() { return entries.at(-1) }
function notify() { revision += 1; subscribers.forEach(listener => listener()) }
function subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener) }
function snapshot() { return revision }

function isVisible(element) {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

function focusable(entry) {
  return [...entry.panel.querySelectorAll(focusSelector)].filter(element =>
    element.tabIndex >= 0 && !element.matches(':disabled') && isVisible(element))
}

function focusEntry(entry) {
  if (!entry?.panel.isConnected) return
  const preferred = entry.options().initialFocusRef?.current
  const target = preferred && entry.panel.contains(preferred) && !preferred.matches(':disabled') && isVisible(preferred)
    ? preferred : focusable(entry)[0] || entry.panel
  target.focus({ preventScroll: true })
}

function restoreBackground() {
  hidden.forEach((previous, element) => {
    if (previous.inert === null) element.removeAttribute('inert')
    else element.setAttribute('inert', previous.inert)
    if (previous.ariaHidden === null) element.removeAttribute('aria-hidden')
    else element.setAttribute('aria-hidden', previous.ariaHidden)
  })
  hidden.clear()
}

function syncBackground() {
  restoreBackground()
  if (!entries.some(entry => entry.options().modal)) return
  const allowed = [top().layer, ...document.querySelectorAll('[data-overlay-live]')]
  function visit(parent) {
    for (const child of parent.children) {
      if (!(child instanceof HTMLElement) || ['SCRIPT', 'STYLE', 'LINK'].includes(child.tagName)) continue
      if (allowed.includes(child)) continue
      if (allowed.some(node => child.contains(node))) visit(child)
      else {
        hidden.set(child, { inert: child.getAttribute('inert'), ariaHidden: child.getAttribute('aria-hidden') })
        child.setAttribute('inert', '')
        child.setAttribute('aria-hidden', 'true')
      }
    }
  }
  visit(document.body)
}

function syncScroll() {
  const needsLock = entries.some(entry => entry.options().modal)
  if (needsLock && !unlockScroll) {
    const body = document.body
    const x = window.scrollX
    const y = window.scrollY
    const properties = ['position', 'top', 'left', 'right', 'width', 'overflow', 'padding-right']
    const previous = properties.map(property => [property, body.style.getPropertyValue(property), body.style.getPropertyPriority(property)])
    const scrollbar = document.documentElement.clientWidth > 0 ? window.innerWidth - document.documentElement.clientWidth : 0
    if (scrollbar > 0) body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight || '0') + scrollbar}px`
    Object.assign(body.style, { position: 'fixed', top: `${-y}px`, left: `${-x}px`, right: '0', width: '100%', overflow: 'hidden' })
    unlockScroll = () => {
      previous.forEach(([property, value, priority]) => value ? body.style.setProperty(property, value, priority) : body.style.removeProperty(property))
      if (x !== window.scrollX || y !== window.scrollY || x || y) {
        const root = document.documentElement
        const behavior = root.style.scrollBehavior
        root.style.scrollBehavior = 'auto'
        window.scrollTo(x, y)
        root.style.scrollBehavior = behavior
      }
    }
  } else if (!needsLock && unlockScroll) {
    unlockScroll()
    unlockScroll = null
  }
}

function requestClose(id, reason) {
  const entry = top()
  if (entry?.id === id) entry.options().onRequestClose?.(reason)
}

function onKeyDown(event) {
  const entry = top()
  if (!entry || event.isComposing) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    requestClose(entry.id, 'escape')
  } else if (event.key === 'Tab') {
    const controls = focusable(entry)
    const current = controls.indexOf(document.activeElement)
    if (!controls.length) {
      event.preventDefault()
      entry.panel.focus({ preventScroll: true })
    } else if (current < 0 || (event.shiftKey && current === 0) || (!event.shiftKey && current === controls.length - 1)) {
      event.preventDefault()
      controls[event.shiftKey ? controls.length - 1 : 0].focus({ preventScroll: true })
    }
  }
}

function onFocus(event) {
  const entry = top()
  if (!entry || redirectingFocus || entry.panel.contains(event.target) || event.target.closest?.('[data-overlay-live]')) return
  redirectingFocus = true
  focusEntry(entry)
  redirectingFocus = false
}

function onPointerDown(event) {
  const entry = top()
  if (!entry?.options().dismissOnOutside) return
  if (entry.layer.contains(event.target) || entry.options().returnFocusRef?.current?.contains(event.target)) return
  requestClose(entry.id, 'outside')
}

function isDescendant(entry, parentId) {
  let id = entry.parentId
  while (id) {
    if (id === parentId) return true
    id = entries.find(candidate => candidate.id === id)?.parentId
  }
  return false
}

function register(entry) {
  const childIndex = entries.findIndex(candidate => isDescendant(candidate, entry.id))
  entries.splice(childIndex < 0 ? entries.length : childIndex, 0, entry)
  if (entries.length === 1) {
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocus, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    observer = new MutationObserver(syncBackground)
    observer.observe(document.body, { childList: true, subtree: true })
  }
  syncBackground()
  syncScroll()
  notify()
  if (top() === entry && !entry.panel.contains(document.activeElement)) focusEntry(entry)
  return () => {
    const wasTop = top() === entry
    const index = entries.indexOf(entry)
    if (index < 0) return
    entries.splice(index, 1)
    syncBackground()
    syncScroll()
    if (!entries.length) {
      observer?.disconnect()
      observer = null
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocus, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
    notify()
    if (wasTop) {
      const next = top()
      const target = entry.options().returnFocusRef?.current || entry.previousFocus
      if (target?.isConnected && isVisible(target) && (!next || next.panel.contains(target))) target.focus({ preventScroll: true })
      else if (next) focusEntry(next)
    }
  }
}

export function useOverlay({ open, panelRef, layerRef = panelRef, onRequestClose, modal = true, initialFocusRef, returnFocusRef, dismissOnOutside = false }) {
  const overlayId = useId()
  const parentId = useContext(OverlayContext)
  const current = useRef(null)
  useLayoutEffect(() => {
    current.current = { onRequestClose, modal, initialFocusRef, returnFocusRef, dismissOnOutside }
  })
  useSyncExternalStore(subscribe, snapshot, snapshot)
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !layerRef.current) return
    return register({ id: overlayId, parentId, panel: panelRef.current, layer: layerRef.current,
      previousFocus: document.activeElement, options: () => current.current })
  }, [open, overlayId, parentId, panelRef, layerRef])
  useLayoutEffect(() => { if (open) { syncBackground(); syncScroll() } }, [open, modal])
  const close = useCallback(reason => requestClose(overlayId, reason), [overlayId])
  const index = entries.findIndex(entry => entry.id === overlayId)
  return { overlayId, zIndex: 1000 + Math.max(index, 0) * 10, isTopmost: top()?.id === overlayId, requestClose: close }
}
