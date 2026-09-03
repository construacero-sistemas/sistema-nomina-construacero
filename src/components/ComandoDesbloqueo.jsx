// src/components/ComandoDesbloqueo.jsx
// 🔓 Comando secreto de desbloqueo en vivo (lanzamiento por fases).
//
// Dos formas de invocarlo, ambas invisibles para el usuario final:
//   1. Escribir la palabra "desbloquear" con el teclado (en cualquier pantalla).
//   2. Dar 7 toques rápidos (menos de 4 s entre toques) sobre el logo.
//
// Abre un diálogo que pide CODIGO_DESBLOQUEO (src/config/modulos.js) y, si es
// correcto, levanta los candados SOLO de esta sesión (candadosRuntime):
// navegación, rutas y botones se restauran al instante sin recargar.
// Al recargar la página vuelven los interruptores estáticos de modulos.js.
import { useEffect, useRef, useState } from 'react'
import { Unlock } from 'lucide-react'

import { CODIGO_DESBLOQUEO } from '../config/modulos.js'
import { desbloquearSesion, useCandados } from '../config/candadosRuntime.js'
import { showToast } from '../../../compat/components/ui/toastBus.js'
import { Modal } from '../../../compat/components/ui/Modal.jsx'

const PALABRA_SECRETA = 'desbloquear'
const TOQUES_REQUERIDOS = 7
const VENTANA_TOQUES_MS = 4000

/** Escucha global: palabra tecleada en cualquier pantalla + toques en el logo. */
export function useComandoDesbloqueo(onAbrir) {
  const bufferRef = useRef('')
  const toquesRef = useRef({ n: 0, primera: 0 })

  // Palabra tecleada (ignora mientras se escribe en inputs/textarea).
  useEffect(() => {
    const onKeyDown = e => {
      const el = document.activeElement
      const escribiendo = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (escribiendo) return
      if (e.key.length !== 1) return
      bufferRef.current = (bufferRef.current + e.key.toLowerCase()).slice(-PALABRA_SECRETA.length)
      if (bufferRef.current === PALABRA_SECRETA) {
        bufferRef.current = ''
        onAbrir()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onAbrir])

  // Gesto táctil/click: toques rápidos sobre el logo.
  const onLogoTap = () => {
    const ahora = Date.now()
    const { n, primera } = toquesRef.current
    const siguiente = ahora - primera <= VENTANA_TOQUES_MS ? n + 1 : 1
    toquesRef.current = { n: siguiente, primera: siguiente === 1 ? ahora : primera }
    if (siguiente >= TOQUES_REQUERIDOS) {
      toquesRef.current = { n: 0, primera: 0 }
      onAbrir()
    }
  }

  return onLogoTap
}

/**
 * Diálogo del comando. Montar una vez dentro del shell autenticado.
 * El botón del logo debe recibir `onLogoTap` (return del hook).
 */
export default function ComandoDesbloqueo() {
  const [abierto, setAbierto] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const candados = useCandados()

  const abrir = () => {
    // Si ya está todo desbloqueado, no hace falta el diálogo.
    if (!candados.cualquiera) {
      showToast('Los módulos ya están desbloqueados en esta sesión', 'info')
      return
    }
    setCodigo('')
    setError('')
    setAbierto(true)
  }

  const onLogoTap = useComandoDesbloqueo(abrir)

  // Exponer el gesto del logo vía evento DOM para no ensuciar el árbol de props:
  // el logo (LogoButton) hace window.dispatchEvent(new CustomEvent('logo-tap')).
  useEffect(() => {
    const handler = () => onLogoTap()
    window.addEventListener('logo-tap', handler)
    return () => window.removeEventListener('logo-tap', handler)
  }, [onLogoTap])

  const confirmar = e => {
    e.preventDefault()
    if (codigo.trim().toUpperCase() !== CODIGO_DESBLOQUEO.toUpperCase()) {
      setError('Código incorrecto.')
      return
    }
    desbloquearSesion()
    setAbierto(false)
    showToast('Módulos desbloqueados para esta sesión', 'success')
  }

  return (
    <Modal isOpen={abierto} onClose={() => setAbierto(false)} title="Comando de desbloqueo" className="max-w-sm">
      <form onSubmit={confirmar} className="space-y-4">
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
    </Modal>
  )
}

/** Botón de logo que cuenta toques para el comando (emite 'logo-tap'). */
export function LogoButton({ children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      onPointerDown={() => window.dispatchEvent(new CustomEvent('logo-tap'))}
    >
      {children}
    </button>
  )
}
