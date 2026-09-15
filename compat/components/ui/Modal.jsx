import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { OverlayContext, useOverlay } from './useOverlay.js'
import { useOverlayPosition } from './useOverlayPosition.js'

export const Modal = ({ isOpen, onClose, title, children, className = '', closeOnBackdrop = true,
  footer, busy = false, dirty = false, onRequestClose, ariaLabel, initialFocusRef }) => {
  const modalRef = useRef(null)
  const layerRef = useRef(null)
  const titleId = useId()
  const [dragY, setDragY] = useState(0)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const dragRef = useRef(null)
  const discardFocus = useRef(null)
  const wasConfirming = useRef(false)
  useLayoutEffect(() => {
    if (isOpen && wasConfirming.current && !confirmDiscard) {
      const target = discardFocus.current
      if (target?.isConnected && !target.matches(':disabled') && !target.closest('[hidden], [inert]')) target.focus({ preventScroll: true })
      else modalRef.current?.focus({ preventScroll: true })
    }
    wasConfirming.current = confirmDiscard
  }, [confirmDiscard, isOpen])
  const { mobileStyle } = useOverlayPosition({ open: isOpen, anchorRef: layerRef, panelRef: modalRef })
  const overlay = useOverlay({ open: isOpen, panelRef: modalRef, layerRef, initialFocusRef,
    onRequestClose: reason => {
      if (busy || (!closeOnBackdrop && ['backdrop', 'swipe'].includes(reason))) return
      if (confirmDiscard) { setConfirmDiscard(false); return }
      if (onRequestClose) onRequestClose(reason, { dirty })
      else if (dirty) { discardFocus.current = document.activeElement; setConfirmDiscard(true) }
      else onClose?.()
    } })

  if (!isOpen) return null

  function resetDrag() { dragRef.current = null; setDragY(0) }

  return createPortal(
    <OverlayContext.Provider value={overlay.overlayId}>
      <div ref={layerRef} data-overlay-id={overlay.overlayId}
        className="ui-overlay-layer fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ ...mobileStyle, zIndex: overlay.zIndex }}>
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" aria-hidden="true"
          onClick={() => overlay.requestClose('backdrop')} />
        <div ref={modalRef} role="dialog" aria-modal="true" aria-busy={busy || undefined}
          aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : (ariaLabel || 'Diálogo')}
          tabIndex={-1}
          className={`ui-overlay-panel relative bg-white dark:bg-slate-900 w-full min-w-0 ${className.includes('max-w-') ? '' : 'sm:max-w-sm'} rounded-t-3xl sm:rounded-[2rem] shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden ${className}`}
          style={{ transform: dragY > 0 ? `translateY(${dragY}px)` : undefined }}>
          <div className="sm:hidden flex justify-center pt-2 pb-1 touch-none select-none cursor-grab" aria-hidden="true"
            onTouchStart={event => { if (!busy && overlay.isTopmost) dragRef.current = event.touches[0].clientY }}
            onTouchMove={event => { if (dragRef.current !== null) setDragY(Math.max(0, event.touches[0].clientY - dragRef.current)) }}
            onTouchEnd={() => { if (dragRef.current !== null && dragY > 120) overlay.requestClose('swipe'); resetDrag() }}
            onTouchCancel={resetDrag}>
            <div className="h-1.5 w-10 rounded-full bg-slate-400 dark:bg-slate-500" />
          </div>
          <div className="ui-overlay-header px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center gap-3 bg-slate-50 dark:bg-slate-800 shrink-0">
            <h3 id={titleId} className="min-w-0 break-words font-black text-slate-800 dark:text-white text-lg tracking-tight">{title}</h3>
            <button type="button" onClick={() => overlay.requestClose('close-button')} disabled={busy}
              className="min-h-11 min-w-11 shrink-0 inline-flex items-center justify-center p-2 bg-slate-200 dark:bg-slate-700 rounded-full text-slate-700 dark:text-slate-100 hover:text-red-700 disabled:cursor-wait"
              aria-label="Cerrar">
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <div className={`ui-overlay-content p-4 sm:p-6 flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain custom-scrollbar ${footer ? '' : 'ui-overlay-body-safe'}`}>
            {confirmDiscard ? <div className="space-y-4" role="alert">
              <h4 className="text-lg font-bold text-slate-900">¿Descartar los cambios sin guardar?</h4>
              <p className="text-sm text-slate-700">No se cancelará una operación que ya se haya enviado al servidor.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" autoFocus disabled={busy} onClick={() => { if (!busy) setConfirmDiscard(false) }} className="min-h-11 px-4 py-2 rounded-xl border border-slate-300 font-bold">Seguir editando</button>
                <button type="button" disabled={busy} onClick={() => { if (!busy) { setConfirmDiscard(false); onClose?.() } }} className="min-h-11 px-4 py-2 rounded-xl bg-rose-700 text-white font-bold">Descartar cambios</button>
              </div>
            </div> : null}
            <div hidden={confirmDiscard} inert={confirmDiscard || undefined}>{children}</div>
          </div>
          {footer && !confirmDiscard && <div role="region" aria-label="Acciones del diálogo" className="ui-overlay-footer flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 sm:px-6 pt-3 shrink-0">{footer}</div>}
        </div>
      </div>
    </OverlayContext.Provider>, document.body)
}
