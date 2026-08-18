import { useEffect, useCallback, useRef, useState } from 'react'
import { ArrowRightLeft, Menu, PanelLeftClose, PanelLeftOpen, Wallet, X } from 'lucide-react'
import { Navigate, Outlet, Route, Routes, NavLink, useLocation, useNavigate } from 'react-router-dom'
import useAuthStore from '../compat/store/useAuthStore.js'
import LoginAvatar from '../compat/components/auth/LoginAvatar.jsx'
import LoginPage from '../compat/modules/auth/LoginPage.jsx'
import NominaView from './views/NominaView.jsx'

const NAV = [
  { to: '/nomina', label: 'Nómina', icon: Wallet },
]

function Loading() {
  const [showRetry, setShowRetry] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShowRetry(true), 6000)
    return () => clearTimeout(timer)
  }, [])

  function recargarAplicacion() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => registration.unregister())
      })
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name))
      })
    }
    window.location.reload()
  }

  return (
    <div className="min-h-screen flex items-center justify-center"
      style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 40%, #0a1a0f 100%)' }}>
      <div className="flex flex-col items-center gap-6">
        <img
          src="/logo.png"
          alt="Construacero Carabobo C.A."
          className="h-32 md:h-48 w-auto object-contain opacity-90 drop-shadow-2xl"
        />
        <div className="loader" role="status" aria-label="Cargando aplicación">
          {Array.from({ length: 7 }, (_, index) => <div key={index} className="loader-square" />)}
        </div>
        {showRetry && (
          <button
            type="button"
            onClick={recargarAplicacion}
            className="mt-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white/80 text-sm font-semibold rounded-xl backdrop-blur-sm transition-all active:scale-95 border border-white/10"
          >
            Toca aquí si no carga
          </button>
        )}
      </div>
    </div>
  )
}

function BadgeRol({ rol }) {
  const estilos = {
    administracion: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    jefe: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
    desarrollador: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    logistica: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    supervisor: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    vendedor: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
    vendedor_sin_comision: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
  }
  const textos = {
    administracion: 'Administración',
    jefe: 'Jefe',
    desarrollador: 'Desarrollador',
    logistica: 'Logística',
    supervisor: 'Supervisor',
    vendedor: 'Vendedor',
    vendedor_sin_comision: 'Vendedor',
  }

  return (
    <span className={`inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full border ${estilos[rol] ?? 'bg-white/10 text-white/50 border-white/10'}`}>
      {textos[rol] ?? rol ?? 'Usuario'}
    </span>
  )
}

function NavItem({ item, collapsed, onClick }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => `flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-1.5 rounded-xl text-sm font-bold transition-colors duration-150 ${isActive ? 'text-white shadow-lg' : 'text-white/75 hover:text-white hover:bg-white/10'}`}
      style={({ isActive }) => isActive
        ? {
            touchAction: 'manipulation',
            background: 'linear-gradient(135deg, rgba(27,54,93,0.9), rgba(184,134,11,0.7))',
            boxShadow: '0 4px 15px rgba(184,134,11,0.2)',
            border: '1px solid rgba(184,134,11,0.25)',
          }
        : { touchAction: 'manipulation' }}
    >
      <Icon size={18} />
      {!collapsed && <span>{item.label}</span>}
    </NavLink>
  )
}

function Protected() {
  const initialized = useAuthStore(useCallback(state => state.initialized, []))
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  const user = useAuthStore(useCallback(state => state.user, []))
  const loadingProfile = useAuthStore(useCallback(state => state._cargandoPerfil, []))
  if (!initialized || (user && !perfil && loadingProfile)) return <Loading />
  if (!perfil) return <Navigate to="/login" replace />
  return <Outlet />
}

function Public() {
  const initialized = useAuthStore(useCallback(state => state.initialized, []))
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  if (!initialized) return <Loading />
  if (perfil) return <Navigate to="/nomina" replace />
  return <Outlet />
}

function Shell() {
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  const switchOut = useAuthStore(state => state.switchOut)
  const navigate = useNavigate()
  const location = useLocation()
  const mainRef = useRef(null)
  const current = NAV.find(item => location.pathname.startsWith(item.to)) || NAV[0]
  const CurrentIcon = current.icon
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth < 1400,
  )

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [location.pathname])

  async function cambiarUsuario() {
    setMenuOpen(false)
    await switchOut()
    navigate('/login', { replace: true })
  }

  const collapsed = sidebarCollapsed && !menuOpen

  return (
    <div className="flex h-screen h-[100dvh] pt-12 md:pt-14 overflow-hidden" style={{ background: '#f1f5f9' }}>
      {/* Barra superior: misma jerarquía visual del proyecto de referencia */}
      <header
        className="fixed top-0 left-0 right-0 z-40 px-3 md:px-4 h-12 md:h-14 flex items-center justify-between gap-2 md:gap-4"
        style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 100%)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <button
          onClick={() => setMenuOpen(true)}
          className="md:hidden p-2.5 rounded-xl transition-colors text-white/60 hover:text-white hover:bg-white/10"
          aria-label="Abrir menú"
          aria-expanded={menuOpen}
        >
          <Menu size={20} />
        </button>

        <img
          src="/logo.png"
          alt="Construacero Carabobo C.A."
          className="md:hidden h-7 w-auto object-contain"
          style={{ filter: 'brightness(1.1)' }}
        />

        <div className="hidden md:flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.8), rgba(184,134,11,0.5))', border: '1px solid rgba(184,134,11,0.2)' }}
          >
            <CurrentIcon size={16} className="text-white/80" />
          </div>
          <span className="text-sm font-black tracking-wide text-white/90">{current.label}</span>
        </div>

        <div className="flex-1" />
        <span className="hidden sm:inline text-xs text-white/60 truncate max-w-[180px]">{perfil?.nombre || 'Usuario'}</span>
        <button
          onClick={cambiarUsuario}
          className="p-2.5 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          title="Cambiar usuario"
          aria-label="Cambiar usuario"
        >
          <ArrowRightLeft size={17} />
        </button>
      </header>

      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar fijo en desktop y drawer completo en móvil */}
      <div className={`relative shrink-0 transition-all duration-300 ease-out ${sidebarCollapsed ? 'md:w-[72px]' : 'md:w-64'}`}>
        <aside
          className={`fixed left-0 top-0 bottom-0 z-[200] flex flex-col overflow-hidden transition-all duration-300 ease-out ${
            menuOpen ? 'translate-x-0' : '-translate-x-full'
          } ${sidebarCollapsed ? 'md:w-[72px]' : 'md:w-64'} w-[85%] max-w-xs rounded-br-2xl rounded-tr-2xl md:inset-y-0 md:top-auto md:bottom-auto md:rounded-none md:translate-x-0 md:static md:z-auto md:h-[calc(100vh-3.5rem)] md:sticky md:top-14`}
          style={{
            background: 'linear-gradient(180deg, #0a1628 0%, #0d1f3c 60%, #0a1a0f 100%)',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            boxShadow: '4px 0 24px rgba(0,0,0,0.3)',
          }}
        >
          <div className="relative flex flex-col md:h-full min-h-0">
            <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-[0.03]">
              <svg width="100%" height="100%" aria-hidden="true">
                <defs><pattern id="nomina-sidebar-dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="white" /></pattern></defs>
                <rect width="100%" height="100%" fill="url(#nomina-sidebar-dots)" />
              </svg>
            </div>
            <div
              className="absolute bottom-0 left-0 w-48 h-48 rounded-full pointer-events-none -mb-16 -ml-16 opacity-20"
              style={{ background: 'radial-gradient(circle, #B8860B 0%, transparent 70%)', filter: 'blur(30px)' }}
            />

            {/* Perfil y cierre del drawer en móvil */}
            <div className="md:hidden relative z-10 px-4 py-3 flex items-center gap-3 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <LoginAvatar user={perfil} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate leading-tight">{perfil?.nombre ?? 'Usuario'}</p>
                <BadgeRol rol={perfil?.rol} />
              </div>
              <button
                onClick={() => setMenuOpen(false)}
                className="p-2 rounded-xl bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-colors shrink-0"
                aria-label="Cerrar menú"
              >
                <X size={20} />
              </button>
            </div>

            {/* Logo en desktop */}
            <div className="relative z-10 px-4 py-2 hidden md:flex flex-col items-center shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <img
                src="/logo.png"
                alt="Construacero Carabobo C.A."
                className={`object-contain transition-all duration-300 select-none pointer-events-none ${collapsed ? 'h-10 w-10' : 'h-[66px] md:h-20'}`}
                style={{ filter: 'brightness(1.05) drop-shadow(0 0 12px rgba(184,134,11,0.2))' }}
                draggable={false}
              />
              {!collapsed && (
                <div className="mt-1.5 md:mt-2 flex items-center gap-2 w-full justify-center">
                  <div className="h-px flex-1 opacity-20" style={{ background: 'linear-gradient(to right, transparent, #B8860B)' }} />
                  <span className="text-[9px] font-bold tracking-[0.25em] uppercase whitespace-nowrap" style={{ color: 'rgba(184,134,11,0.7)' }}>
                    Nómina y Finanzas
                  </span>
                  <div className="h-px flex-1 opacity-20" style={{ background: 'linear-gradient(to left, transparent, #B8860B)' }} />
                </div>
              )}
            </div>

            <nav className="relative z-10 flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5" aria-label="Navegación principal">
              {NAV.map(item => <NavItem key={item.to} item={item} collapsed={collapsed} onClick={() => setMenuOpen(false)} />)}
            </nav>

            <div className="md:hidden relative z-10 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
              <button
                onClick={cambiarUsuario}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors active:scale-[0.98]"
              >
                <ArrowRightLeft size={18} />
                <span className="text-sm font-semibold">Cambiar usuario</span>
              </button>
            </div>

            <div className="relative z-10 p-2 pb-2 shrink-0 hidden md:block" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                onClick={cambiarUsuario}
                className={`flex items-center ${collapsed ? 'justify-center p-1.5 mx-auto' : 'w-full gap-3 p-3'} rounded-2xl transition-all active:scale-[0.98] group`}
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                title={collapsed ? 'Cambiar operador' : undefined}
              >
                <LoginAvatar user={perfil} size="sm" />
                {!collapsed && (
                  <>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-black text-white/90 truncate leading-tight">{perfil?.nombre ?? 'Usuario'}</p>
                      <BadgeRol rol={perfil?.rol} />
                    </div>
                    <ArrowRightLeft size={14} className="shrink-0 text-white/25 group-hover:text-white/50 transition-colors" />
                  </>
                )}
              </button>
            </div>
          </div>
        </aside>

        <button
          onClick={() => setSidebarCollapsed(value => !value)}
          className="hidden md:flex absolute -right-3 top-14 w-6 h-6 rounded-full items-center justify-center transition-all hover:scale-110 z-50"
          style={{ background: '#0d1f3c', border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', color: 'rgba(255,255,255,0.5)' }}
          title={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
          aria-label={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        </button>
      </div>

      <main ref={mainRef} className="flex-1 min-w-0 overflow-y-auto flex flex-col pb-20 md:pb-0">
        <div className="w-full flex flex-col flex-1 min-h-0">
          <Outlet />
          <div className="h-4 shrink-0 md:hidden" aria-hidden="true" />
        </div>
      </main>

      {/* Navegación inferior táctil: conserva una acción primaria y el cambio de usuario */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-[97] md:hidden"
        aria-label="Navegación móvil"
        style={{
          background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 100%)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.3)',
        }}
      >
        <div className="flex items-center justify-around px-2 h-16">
          <NavLink
            to="/nomina"
            className={({ isActive }) => `flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl transition-colors min-w-[64px] ${isActive ? 'text-amber-400' : 'text-white/50 active:text-white/80'}`}
            style={{ touchAction: 'manipulation' }}
          >
            {({ isActive }) => (
              <>
                <div className={`p-1.5 rounded-lg transition-all ${isActive ? 'bg-amber-400/15' : ''}`}>
                  <Wallet size={20} strokeWidth={isActive ? 2.5 : 2} />
                </div>
                <span className={`text-[10px] font-bold ${isActive ? 'text-amber-400' : ''}`}>Nómina</span>
              </>
            )}
          </NavLink>
          <button
            onClick={cambiarUsuario}
            className="flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl transition-colors min-w-[64px] text-white/50 active:text-white/80"
            style={{ touchAction: 'manipulation' }}
            aria-label="Cambiar usuario"
          >
            <div className="p-1.5 rounded-lg"><ArrowRightLeft size={20} /></div>
            <span className="text-[10px] font-bold">Cambiar</span>
          </button>
        </div>
      </nav>
    </div>
  )
}

export default function NominaApp() {
  const initialize = useAuthStore(state => state.initialize)
  useEffect(() => initialize(), [initialize])

  return (
    <Routes>
      <Route element={<Public />}><Route path="/login" element={<LoginPage />} /></Route>
      <Route element={<Protected />}><Route element={<Shell />}><Route path="/nomina" element={<NominaView />} /></Route></Route>
      <Route path="*" element={<Navigate to="/nomina" replace />} />
    </Routes>
  )
}
