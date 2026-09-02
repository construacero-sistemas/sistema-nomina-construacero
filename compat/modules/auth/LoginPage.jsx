import { useState, useEffect } from 'react'
import { CircleAlert, Eye, EyeOff, Key, Mail, RefreshCw, ArrowRight } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import PwaInstallButton from './PwaInstallButton'

function DarkBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 40%, #0a1a0f 100%)' }}>
      <div className="absolute -top-[20%] -left-[10%] w-[700px] h-[700px] rounded-full opacity-30" style={{ background: 'radial-gradient(circle, #1B365D 0%, transparent 70%)', filter: 'blur(80px)' }} />
      <div className="absolute -bottom-[20%] -right-[10%] w-[600px] h-[600px] rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)', filter: 'blur(80px)' }} />
      <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="white" /></pattern></defs><rect width="100%" height="100%" fill="url(#grid)" /></svg>
    </div>
  )
}

function GateStep() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const login = useAuthStore(state => state.login)
  const submitReady = Boolean(email.trim() && password) && !loading

  async function handleSubmit(event) {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return setError('Ingresa un correo válido.')
    if (!password) return setError('Ingresa la contraseña para continuar.')
    setLoading(true)
    setError(null)
    const result = await login(normalizedEmail, password)
    setLoading(false)
    if (!result.ok) {
      setError(useAuthStore.getState().error || 'No se pudo abrir la cuenta. Verifica tus datos e inténtalo de nuevo.')
      useAuthStore.getState().limpiarError()
    }
  }

  return (
    <>
      <DarkBackground />
      <div className="login-stage">
        <div className="login-brand select-none" style={{ animation: 'logoReveal 0.8s ease forwards' }}>
          <div className="login-brand-logo-wrap"><img src="/logo.png" alt="Construacero Carabobo C.A." className="login-brand-logo select-none pointer-events-none" style={{ height: 'clamp(116px, 14vw, 188px)' }} draggable={false} /></div>
          <span className="login-brand-kicker">Acceso a la cuenta</span>
        </div>
        <form onSubmit={handleSubmit} noValidate className="login-panel login-gate-panel login-panel-ready" style={{ width: '100%', maxWidth: '460px' }}>
          <h2 className="text-lg font-black text-white mb-1">Bienvenido</h2>
          <p className="text-xs mb-6" style={{ color: 'rgba(255,255,255,0.4)' }}>Usa el correo y contraseña de la cuenta. El acceso quedará guardado en este dispositivo.</p>
          <div className="login-field"><label className="login-field-label" htmlFor="nomina-login-email">Correo de la cuenta</label><div className="relative"><Mail size={17} className="login-field-icon" aria-hidden="true" /><input id="nomina-login-email" type="email" value={email} onChange={e => { setEmail(e.target.value); setError(null) }} className="login-field-control w-full outline-none" style={{ minHeight: '50px' }} placeholder="correo@empresa.com" autoComplete="email" required /></div></div>
          <div className="login-field"><label className="login-field-label" htmlFor="nomina-login-password">Contraseña</label><div className="relative"><Key size={17} className="login-field-icon" aria-hidden="true" /><input id="nomina-login-password" type={showPass ? 'text' : 'password'} value={password} onChange={e => { setPassword(e.target.value); setError(null) }} className="login-field-control login-field-password-control w-full outline-none" style={{ minHeight: '50px' }} placeholder="••••••••" autoComplete="current-password" required /><button type="button" onClick={() => setShowPass(value => !value)} className="login-password-toggle absolute top-1/2 -translate-y-1/2" aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{showPass ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
          {error && <p className="login-form-error" role="alert"><CircleAlert size={15} aria-hidden="true" /><span>{error}</span></p>}
          <button type="submit" disabled={!submitReady} className="login-submit w-full flex items-center justify-center gap-2 text-sm font-bold text-white transition-all" style={{ background: submitReady ? 'linear-gradient(135deg, #B8860B 0%, #8B6914 100%)' : 'linear-gradient(135deg, rgba(184,134,11,0.58) 0%, rgba(139,105,20,0.62) 100%)' }}>{loading ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}{loading ? 'Verificando...' : 'Acceder'}</button>
        </form>
        <PwaInstallButton />
      </div>
      <style>{`@keyframes logoReveal { from { opacity: 0; transform: scale(0.85) translateY(-20px); filter: blur(8px); } to { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); } }`}</style>
    </>
  )
}

export default function LoginPage() {
  const initialized = useAuthStore(state => state.initialized)
  const user = useAuthStore(state => state.user)
  useEffect(() => {
    const previous = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#0a1628'
    return () => { document.body.style.backgroundColor = previous }
  }, [])
  if (!initialized) return <div className="min-h-screen" style={{ background: '#0a1628' }} />
  if (user) return <div className="min-h-screen" style={{ background: '#0a1628' }} />
  return <GateStep />
}
