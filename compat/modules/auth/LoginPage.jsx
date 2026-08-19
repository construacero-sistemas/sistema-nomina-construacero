// src/modules/auth/LoginPage.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleAlert, Eye, EyeOff, Key, LogOut, Mail, RefreshCw, ShieldCheck, UsersRound, ArrowRight } from 'lucide-react'
import supabase from '../../services/supabase/client'
import useAuthStore from '../../store/useAuthStore'
import LoginPinModal from '../../components/auth/LoginPinModal'
import UserCard from './UserCard'
import PwaInstallButton from './PwaInstallButton'

// ─── Fondo animado con orbes ─────────────────────────────────────────────────
function DarkBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 40%, #0a1a0f 100%)' }}>
      <div className="absolute -top-[20%] -left-[10%] w-[700px] h-[700px] rounded-full opacity-30"
        style={{ background: 'radial-gradient(circle, #1B365D 0%, transparent 70%)', filter: 'blur(80px)' }} />
      <div className="absolute -bottom-[20%] -right-[10%] w-[600px] h-[600px] rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)', filter: 'blur(80px)' }} />
      <div className="absolute top-[30%] left-[50%] -translate-x-1/2 w-[400px] h-[400px] rounded-full opacity-10"
        style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)', filter: 'blur(60px)' }} />
      <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="white" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <div className="absolute top-0 left-[35%] w-px h-full opacity-10"
        style={{ background: 'linear-gradient(to bottom, transparent 0%, #B8860B 30%, #1B365D 70%, transparent 100%)' }} />
      <div className="absolute top-0 left-[65%] w-px h-full opacity-5"
        style={{ background: 'linear-gradient(to bottom, transparent 0%, #3b82f6 50%, transparent 100%)' }} />
    </div>
  )
}
const USUARIOS_CACHE_KEY = 'construacero_usuarios_cache'
function operatorCacheKey(userId) {
  return `${USUARIOS_CACHE_KEY}_${userId || 'unknown'}`
}
// ─── Paso 1: Login del negocio (email + contraseña) ─────────────────────────
function GateStep({ onPass }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const { login } = useAuthStore()
  const submitReady = Boolean(email.trim() && password) && !loading
  async function handleSubmit(e) {
    e.preventDefault()
    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      setError('Ingresa el correo de la empresa.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Ingresa un correo válido.')
      return
    }
    if (!password) {
      setError('Ingresa la contraseña para continuar.')
      return
    }
    setLoading(true)
    setError(null)
    const { ok } = await login(normalizedEmail, password)
    setLoading(false)
    if (ok) {
      onPass()
    } else {
      // Leer error del store
      const storeError = useAuthStore.getState().error
      setError(storeError || 'Email o contraseña incorrectos')
      useAuthStore.getState().limpiarError()
    }
  }
  return (
    <>
      <DarkBackground />
      <div className="login-stage">
        {/* Logo */}
        <div className="login-brand select-none" style={{ animation: 'logoReveal 0.8s ease forwards' }}>
          <div className="login-brand-logo-wrap">
            <img src="/logo.png" alt="Construacero Carabobo C.A."
              className="login-brand-logo select-none pointer-events-none"
              style={{ height: 'clamp(116px, 14vw, 188px)' }}
              draggable={false} />
          </div>
          <span className="login-brand-kicker">Acceso seguro</span>
        </div>
        {/* Formulario login negocio */}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="login-panel login-gate-panel login-panel-ready"
          style={{ width: '100%', maxWidth: '460px' }}
        >
          <div className="absolute top-0 left-[10%] right-[10%] h-px"
            style={{ background: 'linear-gradient(to right, transparent, rgba(184,134,11,0.6), transparent)' }} />
          <h2 className="text-lg font-black text-white mb-1">Verificación de acceso</h2>
          <p className="text-xs mb-6" style={{ color: 'rgba(255,255,255,0.4)' }}>Ingresa las credenciales del negocio</p>
          {/* Email */}
          <div className="login-field">
            <label className="login-field-label" htmlFor="nomina-login-email">Correo de la empresa</label>
            <div className="relative">
              <Mail size={17} className="login-field-icon" aria-hidden="true" />
              <input
                id="nomina-login-email"
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); if (error) setError(null) }}
                className="login-field-control w-full outline-none"
                style={{ minHeight: '50px' }}
                onFocus={e => e.target.style.borderColor = 'rgba(184,134,11,0.75)'}
                onBlur={e => e.target.style.borderColor = 'rgba(148,163,184,0.28)'}
                placeholder="correo@empresa.com"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                aria-required="true"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'nomina-login-error' : undefined}
                required
              />
            </div>
          </div>
          {/* Password */}
          <div className="login-field">
            <label className="login-field-label" htmlFor="nomina-login-password">Contraseña</label>
            <div className="relative">
              <Key size={17} className="login-field-icon" aria-hidden="true" />
              <input
                id="nomina-login-password"
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); if (error) setError(null) }}
                className="login-field-control login-field-password-control w-full outline-none"
                style={{ minHeight: '50px' }}
                onFocus={e => e.target.style.borderColor = 'rgba(184,134,11,0.75)'}
                onBlur={e => e.target.style.borderColor = 'rgba(148,163,184,0.28)'}
                placeholder="••••••••"
                autoComplete="current-password"
                aria-required="true"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'nomina-login-error' : undefined}
                required
              />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="login-password-toggle absolute top-1/2 -translate-y-1/2"
                style={{ color: 'rgba(226,232,240,0.55)' }}
                aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
          {error && (
            <p id="nomina-login-error" className="login-form-error" role="alert">
              <CircleAlert size={15} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
          <button
            type="submit"
            disabled={!submitReady}
            className="login-submit w-full flex items-center justify-center gap-2 text-sm font-bold text-white transition-all"
            style={{
              background: submitReady
                ? 'linear-gradient(135deg, #B8860B 0%, #8B6914 100%)'
                : 'linear-gradient(135deg, rgba(184,134,11,0.58) 0%, rgba(139,105,20,0.62) 100%)',
              color: submitReady ? '#ffffff' : 'rgba(255,255,255,0.8)',
              boxShadow: submitReady ? '0 4px 20px rgba(184,134,11,0.3)' : '0 6px 16px rgba(0,0,0,0.16)',
            }}
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            {loading ? 'Verificando...' : 'Acceder'}
          </button>
        </form>
        <PwaInstallButton />
      </div>
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes logoReveal {
          from { opacity: 0; transform: scale(0.85) translateY(-20px); filter: blur(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
        }
      `}</style>
    </>
  )
}
// ─── Paso 2: Seleccionar operador ────────────────────────────────────────────
function UserSelectStep({ onLogout }) {
  const accountUser = useAuthStore(state => state.user)
  const cacheKey = operatorCacheKey(accountUser?.id)
  const cached = (() => { try { return JSON.parse(localStorage.getItem(cacheKey) || '[]').filter(u => u.rol === 'administracion') } catch { return [] } })()
  const [usuarios,     setUsuarios]     = useState(cached)
  const [cargando,     setCargando]     = useState(cached.length === 0)
  const [errorLista,   setErrorLista]   = useState(null)
  const [seleccionado, setSeleccionado] = useState(null)
  const [visible,      setVisible]      = useState(false)
  const { switchOperator, logout } = useAuthStore()
  const navigate = useNavigate()
  async function cargarUsuarios(silencioso = false) {
    if (!silencioso) setCargando(usuarios.length === 0)
    setErrorLista(null)
    const { data, error } = await supabase.rpc('listar_usuarios_login')
    if (error) {
      if (usuarios.length === 0) setErrorLista('No se pudo cargar la lista de usuarios')
    } else {
      const lista = (data ?? []).filter(u => u.rol === 'administracion')
      setUsuarios(lista)
      localStorage.setItem(cacheKey, JSON.stringify(lista))
    }
    setCargando(false)
  }
  useEffect(() => {
    const loadTimer = setTimeout(() => cargarUsuarios(cached.length > 0), 0)
    const visibleTimer = setTimeout(() => setVisible(true), 50)
    return () => {
      clearTimeout(loadTimer)
      clearTimeout(visibleTimer)
    }
  }, [])
  async function handlePin(pin) {
    if (!seleccionado) return false
    const { ok } = await switchOperator(seleccionado.id, pin)
    if (ok) navigate('/', { replace: true })
    return ok
  }
  const gridMode = usuarios.length === 1 ? 'single' : usuarios.length === 2 ? 'double' : 'many'
  return (
    <>
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes logoReveal {
          from { opacity: 0; transform: scale(0.85) translateY(-20px); filter: blur(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
        }
      `}</style>
      <DarkBackground />
      <div className="login-stage">
        {/* ── LOGO + BRANDING ── */}
        <div
          className="login-brand select-none"
          style={{ animation: 'logoReveal 0.8s ease forwards' }}
        >
          <div className="login-brand-logo-wrap">
            <img
              src="/logo.png"
              alt="Construacero Carabobo"
              className="login-brand-logo select-none drop-shadow-2xl"
              style={{
                height: 'clamp(116px, 14vw, 188px)',
              }}
              draggable={false}
            />
          </div>
          <span className="login-brand-kicker">Nómina y Finanzas</span>
          <p className="login-brand-description">
            Gestión de nómina, asistencia y finanzas para Construacero Carabobo C.A.
          </p>
        </div>
        {/* ── PANEL PRINCIPAL ── */}
        <div className={`login-panel ${visible ? 'login-panel-ready' : ''}`}>
          <div className="login-panel-content">
            {/* Header */}
            <div className="login-panel-header">
              <div className="min-w-0">
                <span className="login-panel-eyebrow">Sesión activa</span>
                <h1 className="login-panel-title">¿Quién está operando?</h1>
                <p className="login-panel-subtitle">Selecciona tu usuario e ingresa tu PIN</p>
              </div>
              <div className="login-action-group">
                <button
                  onClick={() => cargarUsuarios(false)}
                  disabled={cargando}
                  className="login-icon-button"
                  title="Actualizar operadores"
                  aria-label="Actualizar operadores"
                >
                  <RefreshCw size={16} className={cargando ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={async () => {
                    await logout()
                    onLogout()
                  }}
                  className="login-icon-button danger"
                  title="Cerrar sesión"
                  aria-label="Cerrar sesión"
                >
                  <LogOut size={16} />
                </button>
              </div>
            </div>
            {/* Grid usuarios */}
            {cargando ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-2.5 sm:gap-3 py-4 sm:py-6 animate-pulse">
                    <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    <div className="space-y-2 w-full px-2">
                      <div className="h-2.5 rounded w-3/4 mx-auto" style={{ background: 'rgba(255,255,255,0.08)' }} />
                      <div className="h-2 rounded w-1/2 mx-auto" style={{ background: 'rgba(255,255,255,0.05)' }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : errorLista ? (
              <div className="login-empty" role="alert">
                <div className="login-empty-icon" style={{ color: '#fca5a5', borderColor: 'rgba(248,113,113,0.32)', background: 'rgba(239,68,68,0.1)' }}>
                  <CircleAlert size={25} />
                </div>
                <span className="login-empty-kicker" style={{ color: '#fca5a5' }}>No se pudo actualizar</span>
                <h2 className="login-empty-title">No pudimos cargar los operadores</h2>
                <p className="login-empty-copy">{errorLista}. Revisa la conexión e inténtalo de nuevo.</p>
                <button onClick={() => cargarUsuarios(false)} className="login-empty-action" disabled={cargando}>
                  <RefreshCw size={16} className={cargando ? 'animate-spin' : ''} />
                  Reintentar
                </button>
              </div>
            ) : usuarios.length === 0 ? (
              <div className="login-empty" role="status" aria-live="polite">
                <div className="login-empty-icon"><UsersRound size={25} /></div>
                <span className="login-empty-kicker">Configuración pendiente</span>
                <h2 className="login-empty-title">Aún no hay operadores disponibles</h2>
                <p className="login-empty-copy">Tu sesión está activa, pero todavía no hay usuarios habilitados para operar Nómina y Finanzas.</p>
                <button onClick={() => cargarUsuarios(false)} className="login-empty-action" disabled={cargando}>
                  <RefreshCw size={16} className={cargando ? 'animate-spin' : ''} />
                  Actualizar operadores
                </button>
                <div className="login-session-note">
                  <ShieldCheck size={15} />
                  Sesión protegida · PIN requerido para continuar
                </div>
              </div>
            ) : (
              <>
                <div className="operator-list-summary" aria-live="polite">
                  <span><span className="operator-list-dot" />{usuarios.length} operador{usuarios.length === 1 ? '' : 'es'} disponible{usuarios.length === 1 ? '' : 's'}</span>
                  <span className="operator-list-hint">Selecciona para continuar</span>
                </div>
                <div className={`operator-grid ${gridMode}`}>
                {[...usuarios].map((u, i) => (
                  <div key={u.id} className="min-w-0">
                    <UserCard user={u} onClick={setSeleccionado} index={i} />
                  </div>
                ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {/* Footer — PWA install button */}
      <div className="fixed bottom-3 sm:bottom-4 left-0 right-0 flex justify-center z-20 pointer-events-none"
        style={{ animation: 'fadeIn 1s ease 0.8s forwards', opacity: 0 }}>
        <div className="pointer-events-auto">
          <PwaInstallButton />
        </div>
      </div>
      {/* Modal PIN */}
      <LoginPinModal
        isOpen={!!seleccionado}
        user={seleccionado}
        onClose={() => setSeleccionado(null)}
        onSubmit={handlePin}
      />
    </>
  )
}
// ─── Vista principal ──────────────────────────────────────────────────────────
// La sesión de Supabase persiste en localStorage. Si el usuario ya inició sesión
// con email/contraseña, no necesita volver a hacerlo — va directo a selección de operador.
// Detectar sesión guardada en localStorage de forma síncrona
// para evitar flash del formulario email/contraseña al recargar
function haySessionGuardada() {
  try {
    const keys = Object.keys(localStorage)
    const sbKey = keys.find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
    if (!sbKey) return false
    const stored = localStorage.getItem(sbKey)
    if (!stored) return false
    const parsed = JSON.parse(stored)
    return !!(parsed?.access_token || parsed?.user)
  } catch { return false }
}
export default function LoginPage() {
  const { user, initialized } = useAuthStore()
  const [gatePassed, setGatePassed] = useState(() => haySessionGuardada())
  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#0a1628'
    return () => { document.body.style.backgroundColor = prev }
  }, [])
  // Mientras se verifica la sesión guardada, mostrar splash de carga
  if (!initialized) {
    return (
      <>
        <DarkBackground />
        <div className="relative z-10 min-h-screen flex items-center justify-center">
          <div className="flex flex-col items-center gap-6">
            <img
              src="/logo.png"
              alt="Construacero Carabobo C.A."
              className="h-32 md:h-48 w-auto object-contain opacity-90 drop-shadow-2xl"
            />
            <div className="loader" role="status" aria-label="Cargando aplicación">
              {Array.from({ length: 7 }, (_, index) => <div key={index} className="loader-square" />)}
            </div>
          </div>
        </div>
        <style>{`
          @keyframes logoReveal {
            from { opacity: 0; transform: scale(0.85) translateY(-20px); filter: blur(8px); }
            to   { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
          }
        `}</style>
      </>
    )
  }
  // Si no hay sesión de negocio → pedir email/contraseña (solo la primera vez)
  if (!gatePassed && !user) {
    return <GateStep onPass={() => setGatePassed(true)} />
  }
  // Sesión activa → selección de operador + PIN
  return <UserSelectStep onLogout={() => setGatePassed(false)} />
}
