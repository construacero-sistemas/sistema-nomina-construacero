import { useState } from 'react'
import { Unlock, Lock } from 'lucide-react'

import { CODIGO_DESBLOQUEO } from '../config/modulos.js'
import { desbloquearSesion, bloquearSesion, useCandados } from '../config/candadosRuntime.js'
import { showToast } from '../../compat/components/ui/toastBus.js'
import { Modal } from '../../compat/components/ui/Modal.jsx'
import { useComandoDesbloqueo } from './comandoDesbloqueoListener.js'

/**
 * Diálogo del comando. Montar una vez dentro del shell autenticado.
 * Las señales (palabra tecleada + evento 'logo-tap' desde los logos) las
 * escucha useComandoDesbloqueo.
 *
 * Con módulos bloqueados pide el código para desbloquear la sesión.
 * Con todo desbloqueado ofrece volver a bloquear (sin código, es la acción
 * conservadora: bloquear nunca expone nada).
 */
export default function ComandoDesbloqueo() {
  const [abierto, setAbierto] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const candados = useCandados()

  const abrir = () => {
    setAbierto(prev => {
      if (prev) return prev
      setCodigo('')
      setError('')
      return true
    })
  }

  useComandoDesbloqueo(abrir)

  const confirmarDesbloqueo = e => {
    e.preventDefault()
    if (codigo.trim() !== CODIGO_DESBLOQUEO) {
      setError('Código incorrecto.')
      return
    }
    desbloquearSesion()
    setAbierto(false)
    showToast('Módulos desbloqueados para esta sesión', 'success')
  }

  const volverABloquear = () => {
    bloquearSesion()
    setAbierto(false)
    showToast('Módulos bloqueados de nuevo', 'info')
  }

  return (
    <Modal
      isOpen={abierto}
      onClose={() => setAbierto(false)}
      title="Comando de candados"
      className="max-w-sm"
      closeOnBackdrop={false}
    >
      {candados.cualquiera ? (
        <form onSubmit={confirmarDesbloqueo} className="space-y-4">
          <p className="text-sm text-slate-500 leading-relaxed">
            Introduce el código para desbloquear los módulos bloqueados. El cambio dura solo esta sesión.
          </p>
          <div>
            <input
              type="password"
              value={codigo}
              onChange={e => { setCodigo(e.target.value); setError('') }}
              placeholder="Código"
              autoComplete="off"
              autoFocus
              inputMode="numeric"
              className="w-full px-3.5 py-3 min-h-11 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-800 tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40"
            />
            {error && <p role="alert" className="mt-1.5 text-xs font-bold text-red-600">{error}</p>}
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="px-4 py-2.5 min-h-11 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 active:scale-95 transition-all cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-11 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-black shadow-xs transition-all active:scale-95 cursor-pointer"
            >
              <Unlock size={14} aria-hidden="true" /> Desbloquear
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500 leading-relaxed">
            Los módulos ya están desbloqueados en esta sesión.
          </p>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="px-4 py-2.5 min-h-11 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 active:scale-95 transition-all cursor-pointer"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={volverABloquear}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-11 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black transition-all active:scale-95 cursor-pointer"
            >
              <Lock size={14} aria-hidden="true" /> Volver a bloquear
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
