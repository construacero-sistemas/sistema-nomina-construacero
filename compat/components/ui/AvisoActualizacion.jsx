import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { RefreshCw, X } from 'lucide-react'
import { aplicarActualizacion, aplicarSiEsSeguro, suscribirActualizacion } from '../../lib/actualizacionApp.js'
import { showToast } from './toastBus.js'

// Aviso temporal (regla del producto: ningún aviso queda fijo en pantalla).
export const AVISO_DURACION_MS = 15000

export default function AvisoActualizacion() {
  const { pathname } = useLocation()
  const [lista, setLista] = useState(false)
  const [visible, setVisible] = useState(false)
  const avisoPrevio = useRef(null)
  const rutaPrevia = useRef(pathname)

  useEffect(() => suscribirActualizacion(estado => {
    setLista(estado.lista)
    if (!estado.lista) { setVisible(false); return }
    // Mostrar al detectarse la versión y de nuevo al volver a la app.
    if (avisoPrevio.current !== estado.avisoEn) {
      avisoPrevio.current = estado.avisoEn
      setVisible(true)
    }
  }), [])

  useEffect(() => {
    if (!visible) return undefined
    const t = setTimeout(() => setVisible(false), AVISO_DURACION_MS)
    return () => clearTimeout(t)
  }, [visible])

  // Cambiar de pantalla es un momento seguro para tomar la versión nueva.
  useEffect(() => {
    if (rutaPrevia.current === pathname) return
    rutaPrevia.current = pathname
    if (lista) aplicarSiEsSeguro()
  }, [pathname, lista])

  if (!lista || !visible) return null

  const actualizarAhora = () => {
    if (!aplicarActualizacion({ forzar: true })) {
      showToast.warning('Espera a que termine la operación en curso y vuelve a intentarlo.')
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 z-[9998] w-[calc(100vw-1.5rem)] max-w-md box-border bottom-[calc(env(safe-area-inset-bottom)+5rem)] md:bottom-6"
    >
      <div className="relative flex flex-wrap items-center gap-3 rounded-2xl border border-sky-700/40 bg-slate-900/95 py-3 pl-4 pr-12 text-white shadow-2xl shadow-black/40 backdrop-blur-xl">
        <RefreshCw size={20} className="shrink-0 text-sky-200" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug">Hay una versión nueva del sistema</p>
          <p className="text-xs leading-snug text-white/80">Se aplicará sola cuando no tengas nada abierto.</p>
        </div>
        <button
          type="button"
          onClick={actualizarAhora}
          className="h-11 shrink-0 rounded-xl bg-white px-4 text-sm font-bold text-primary hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
        >
          Actualizar ahora
        </button>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-white/70 hover:text-white"
          aria-label="Cerrar aviso"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
