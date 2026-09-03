// src/components/comandoDesbloqueoListener.js
// 🔓 Escucha del comando secreto (hook sin JSX — mantiene react-refresh feliz).
//
// Dos señales, ambas invisibles para el usuario final:
//   1. Escribir la palabra "desbloquear" con el teclado (en cualquier pantalla).
//   2. 7 toques rápidos (menos de 4 s entre toques) — los logos emiten el
//      evento DOM 'logo-tap'.
// Cualquiera de las dos llama a `onAbrir()`.
import { useEffect, useRef } from 'react'

export const PALABRA_SECRETA = 'desbloquear'
export const TOQUES_REQUERIDOS = 7
export const VENTANA_TOQUES_MS = 4000

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

  // Gesto táctil/click: toques rápidos sobre el logo (evento 'logo-tap').
  useEffect(() => {
    const onTap = () => {
      const ahora = Date.now()
      const { n, primera } = toquesRef.current
      const siguiente = ahora - primera <= VENTANA_TOQUES_MS ? n + 1 : 1
      toquesRef.current = { n: siguiente, primera: siguiente === 1 ? ahora : primera }
      if (siguiente >= TOQUES_REQUERIDOS) {
        toquesRef.current = { n: 0, primera: 0 }
        onAbrir()
      }
    }
    window.addEventListener('logo-tap', onTap)
    return () => window.removeEventListener('logo-tap', onTap)
  }, [onAbrir])
}
