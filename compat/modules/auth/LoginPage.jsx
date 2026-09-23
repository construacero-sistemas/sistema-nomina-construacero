import { useState, useEffect } from 'react'
import { CircleAlert, Eye, EyeOff, Key, Mail, RefreshCw, ArrowRight } from 'lucide-react'
import useAuthStore from '../../store/useAuthStore'
import PwaInstallButton from './PwaInstallButton'
import OperatorPicker from './OperatorPicker'
import PinInput from '../../components/auth/PinInput.jsx'
import DarkBackground from '../../components/auth/DarkBackground.jsx'
import { longitudPin } from '../../../server/lib/permissions.js'

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
      // Keep the profile error for the recovery screen; login clears it on retry.
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

// Arranque de cuenta (solo visible cuando la cuenta no tiene operadores
// activos): crea el primer usuario desde la propia pantalla de error. El rol es
// fijo (jefe) y el PIN recién creado se valida al entrar por switch-operator.
function PrimerUsuarioForm({ onCrear }) {
  const [nombre, setNombre] = useState('')
  const [pin, setPin] = useState('')
  const [pending, setPending] = useState(false)
  const [localError, setLocalError] = useState(null)
  const largoPin = longitudPin('jefe')

  async function submit(event) {
    event.preventDefault()
    if (nombre.trim().length < 3) return setLocalError('El nombre debe tener al menos 3 caracteres.')
    if (pin.length !== largoPin) return setLocalError(`El PIN debe ser de ${largoPin} dígitos.`)
    setLocalError(null)
    setPending(true)
    const ok = await onCrear({ nombre: nombre.trim(), pin })
    // Con éxito la app desmonta esta pantalla (entra el operador); solo se
    // reactiva el formulario ante un fallo.
    if (!ok) setPending(false)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-white/15 bg-white/5 p-3">
      <p className="text-xs text-slate-300">Este será el primer usuario de la cuenta: rol <b>Jefe</b> (acceso total y gestión de usuarios). Su PIN es de {largoPin} dígitos.</p>
      <div className="login-field">
        <label className="login-field-label" htmlFor="bootstrap-nombre">Nombre del usuario</label>
        <input id="bootstrap-nombre" value={nombre} onChange={e => { setNombre(e.target.value); setLocalError(null) }} className="login-field-control w-full outline-none" style={{ minHeight: '50px' }} placeholder="Ej: María Pérez" maxLength={60} disabled={pending} autoComplete="name" />
      </div>
      <label className="login-field">
        <span className="login-field-label">PIN de acceso ({largoPin} dígitos)</span>
        <PinInput value={pin} onChange={v => { setPin(v); setLocalError(null) }} length={largoPin} dark disabled={pending} />
      </label>
      {localError && <p className="login-form-error" role="alert"><CircleAlert size={15} aria-hidden="true" /><span>{localError}</span></p>}
      <button type="submit" disabled={pending || nombre.trim().length < 3 || pin.length !== largoPin} className="login-submit w-full flex items-center justify-center gap-2 text-sm font-bold text-white transition-all" style={{ background: 'linear-gradient(135deg, #B8860B 0%, #8B6914 100%)' }}>
        {pending ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
        {pending ? 'Creando...' : 'Crear usuario y entrar'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  const initialized = useAuthStore(state => state.initialized)
  const user = useAuthStore(state => state.user)
  const status = useAuthStore(state => state.authStatus)
  const error = useAuthStore(state => state.error)
  const retryProfile = useAuthStore(state => state.retryProfile)
  const logout = useAuthStore(state => state.logout)
  const loadingProfile = useAuthStore(state => state._cargandoPerfil)
  const seleccionPendiente = useAuthStore(state => state.seleccionPendiente)
  const cuentaSinOperadores = useAuthStore(state => state.cuentaSinOperadores)
  const crearPrimerOperador = useAuthStore(state => state.crearPrimerOperador)
  useEffect(() => {
    const previous = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#0a1628'
    return () => { document.body.style.backgroundColor = previous }
  }, [])
  // F2 — cuenta multi-operador sin selección: pantalla de operadores + PIN.
  if (initialized && user && seleccionPendiente && status === 'seleccion-pendiente') return <OperatorPicker />
  if (!initialized || user || status === 'error') return (
    <><DarkBackground /><main className="login-stage">
      <section className="login-panel login-panel-ready w-full max-w-md" aria-busy={loadingProfile}>
        <div className="login-panel-content space-y-4">
          <h1 className="login-panel-title">{!initialized || (loadingProfile && !error && !cuentaSinOperadores) ? 'Comprobando tu acceso' : user && cuentaSinOperadores ? 'Crea el primer usuario' : 'No pudimos abrir tu cuenta'}</h1>
          <p className="text-sm text-slate-300" role={error ? 'alert' : 'status'}>
            {error || 'Estamos verificando la sesión y los permisos de tu cuenta.'}
          </p>
          {user?.email && <p className="text-xs text-slate-400 break-all">{user.email}</p>}
          {user && cuentaSinOperadores && <PrimerUsuarioForm onCrear={crearPrimerOperador} />}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => retryProfile()} disabled={loadingProfile}
              className="min-h-11 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold disabled:opacity-60 transition-colors">
              {loadingProfile ? 'Comprobando...' : 'Reintentar'}
            </button>
            <button type="button" onClick={() => logout()} className="min-h-11 px-4 py-2 rounded-xl bg-white/10 border border-white/30 hover:bg-white/20 text-white font-bold transition-colors">
              {user ? 'Cerrar sesión' : 'Volver al acceso'}
            </button>
          </div>
        </div>
      </section>
    </main></>
  )
  return <GateStep />
}
