import React, { useEffect, useRef, useCallback, useState } from 'react';
import { X } from 'lucide-react';

export const Modal = ({ isOpen, onClose, title, children, className = '', closeOnBackdrop = true }) => {
  const modalRef = useRef(null);
  const previousFocusRef = useRef(null);

  // Estado del gesto de arrastre para cerrar (bottom sheet móvil)
  const [dragY, setDragY] = useState(0);
  const dragRef = useRef({ startY: 0, active: false });

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    // Trap focus inside modal
    if (e.key === 'Tab' && modalRef.current) {
      const focusable = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    
    // Guardar el foco previo
    previousFocusRef.current = document.activeElement;
    document.addEventListener('keydown', handleKeyDown);

    // Solo hacer autofoco al abrir, no en cada render
    const timer = setTimeout(() => {
      if (modalRef.current) {
        // Si ya hay un elemento del modal con foco, no forzar el primero
        if (modalRef.current.contains(document.activeElement)) return;
        
        const firstFocusable = modalRef.current.querySelector(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        firstFocusable?.focus();
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen]); // Quitar handleKeyDown de dependencias para evitar re-foco constante

  // ─── GESTO DE ARRASTRE PARA CERRAR (BOTTOM SHEET MÓVIL) ───────────────────
  const onDragStart = useCallback((e) => {
    dragRef.current = { startY: e.touches[0].clientY, active: true };
  }, []);

  const onDragMove = useCallback((e) => {
    if (!dragRef.current.active) return;
    const dy = e.touches[0].clientY - dragRef.current.startY;
    setDragY(Math.max(0, dy));
  }, []);

  const onDragEnd = useCallback(() => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    if (dragY > 120 && closeOnBackdrop) onClose();
    setDragY(0);
  }, [dragY, onClose, closeOnBackdrop]);

  if (!isOpen) return null;

  return (
    // z-[100] asegura que esté por encima de la barra de navegación (z-30)
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >

      {/* Backdrop con desenfoque */}
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Contenido del Modal */}
      <div
        ref={modalRef}
        className={`relative bg-white dark:bg-slate-900 w-full max-w-[calc(100vw-1.5rem)] ${className.includes('max-w-') ? '' : 'sm:max-w-sm'} rounded-t-3xl sm:rounded-[2rem] max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 transition-all pb-[env(safe-area-inset-bottom)] ${className}`}
        style={{
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragY > 0 ? 'none' : '',
        }}
      >

        {/* Tirador (grabber) para cerrar con arrastre — solo móvil */}
        <div
          className="sm:hidden flex justify-center pt-2 pb-1 touch-none select-none cursor-grab"
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
          onTouchCancel={onDragEnd}
          aria-hidden="true"
        >
          <div className="h-1.5 w-10 rounded-full bg-slate-300/90 dark:bg-slate-600" />
        </div>

        {/* Cabecera */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
          <h3 className="font-black text-slate-800 dark:text-white text-lg tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            className="p-2 bg-slate-200 dark:bg-slate-700 rounded-full text-slate-500 hover:text-red-500 transition-colors"
            aria-label="Cerrar"
          >
            <X size={16} strokeWidth={3} />
          </button>
        </div>

        {/* Body con Scroll Mejorado */}
        <div className="p-4 sm:p-6 flex-1 min-h-0 overflow-y-auto custom-scrollbar pb-6">
          {children}
        </div>
      </div>
    </div>
  );
};
