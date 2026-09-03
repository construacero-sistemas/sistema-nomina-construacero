// src/components/LogoutConfirmModal.jsx
// Modal de confirmación de cierre de sesión (desktop y móvil).
import { useEffect } from 'react'
import { LogOut } from 'lucide-react'

export default function LogoutConfirmModal({ isOpen, onClose, onConfirm }) {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = e => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logout-modal-title"
    >
      <div
        className="relative border border-white/10 w-full max-w-sm rounded-3xl p-6 shadow-2xl text-center overflow-hidden animate-in zoom-in-95 duration-200"
        style={{
          background: 'linear-gradient(180deg, #0f1f38 0%, #0a1628 100%)',
          boxShadow: '0 20px 50px rgba(0,0,0,0.6), 0 0 30px rgba(239,68,68,0.1)',
        }}
      >
        <div
          className="absolute -top-12 left-1/2 -translate-x-1/2 w-32 h-32 rounded-full pointer-events-none opacity-25"
          style={{ background: 'radial-gradient(circle, #ef4444 0%, transparent 70%)', filter: 'blur(20px)' }}
        />

        <div className="relative z-10">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4 text-red-400">
            <LogOut size={22} />
          </div>

          <h3 id="logout-modal-title" className="text-lg font-black text-white mb-2">
            ¿Cerrar sesión?
          </h3>
          <p className="text-xs text-white/60 mb-6 leading-relaxed">
            Tu sesión actual se cerrará de forma segura en este dispositivo.
          </p>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white/80 hover:text-white text-xs font-bold transition-all active:scale-95"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-lg shadow-red-950/50 transition-all active:scale-95 flex items-center justify-center gap-1.5"
            >
              <LogOut size={14} />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
