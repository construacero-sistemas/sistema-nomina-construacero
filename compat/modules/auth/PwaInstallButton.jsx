import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'

export default function PwaInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [installed, setInstalled] = useState(false)
  const [showIosGuide, setShowIosGuide] = useState(false)
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    const installedHandler = () => setInstalled(true)
    window.addEventListener('appinstalled', installedHandler)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])
  if (installed || isStandalone) return null
  async function handleInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') setInstalled(true)
    setDeferredPrompt(null)
  }
  if (isIos && !deferredPrompt) {
    return (
      <>
        <button onClick={() => setShowIosGuide(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:scale-105 active:scale-95" style={{ background: 'rgba(184,134,11,0.15)', border: '1px solid rgba(184,134,11,0.4)', color: '#B8860B', backdropFilter: 'blur(8px)' }}>
          <Download size={15} /> Instalar App
        </button>
        {showIosGuide && (
          <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && setShowIosGuide(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in slide-in-from-bottom">
              <div className="px-5 pt-5 pb-3 text-center"><div className="w-12 h-12 mx-auto mb-3 rounded-full bg-blue-50 flex items-center justify-center"><Download size={22} className="text-blue-600" /></div><h3 className="text-lg font-bold text-slate-800">Instalar en iPhone</h3><p className="text-sm text-slate-500 mt-1">Sigue estos pasos para agregar la app a tu pantalla de inicio</p></div>
              <div className="px-5 pb-4 space-y-3">
                <Step number="1">Pulsa el botón <strong>Compartir</strong> en la barra de Safari</Step>
                <Step number="2">Desplaza y selecciona <strong>"Agregar a pantalla de inicio"</strong></Step>
                <Step number="3">Pulsa <strong>"Agregar"</strong> en la esquina superior derecha</Step>
              </div>
              <div className="px-5 pb-5"><button onClick={() => setShowIosGuide(false)} className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition-colors">Entendido</button></div>
            </div>
          </div>
        )}
      </>
    )
  }
  if (!prompt) return null
  return <button onClick={handleInstall} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:scale-105 active:scale-95" style={{ background: 'rgba(184,134,11,0.15)', border: '1px solid rgba(184,134,11,0.4)', color: '#B8860B', backdropFilter: 'blur(8px)' }}><Download size={15} /> Instalar App</button>
}

function Step({ number, children }) {
  return <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl"><span className="shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center">{number}</span><p className="text-sm text-slate-700">{children}</p></div>
}
