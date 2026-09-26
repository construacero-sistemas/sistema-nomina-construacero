import { lazy, Suspense, useEffect, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { OverlayContext, useOverlay } from '../compat/components/ui/useOverlay.js'
import { useOverlayPosition } from '../compat/components/ui/useOverlayPosition.js'
import {
  ChevronRight, Landmark, LogOut, Menu, PanelLeftClose,
  PanelLeftOpen, Settings2, TrendingUp, User, UserCog, Wallet, X
} from 'lucide-react'
import { Link, Navigate, Outlet, Route, Routes, NavLink, useLocation, useNavigate } from 'react-router-dom'
import useAuthStore from '../compat/store/useAuthStore.js'
import LoginPage from '../compat/modules/auth/LoginPage.jsx'
import LogoutConfirmModal from './components/LogoutConfirmModal.jsx'
import { accesoUI, etiquetaRol, rutaParaRol } from './config/accesoModulos.js'
import { filtrarNavPorRol } from './config/navModulos.js'
import SistemaView from './views/SistemaView.jsx'
import useTasaCambioNomina from './hooks/useTasaCambioNomina.js'
import RateHeader from './components/layout/RateHeader.jsx'
import HeaderDate from './components/layout/HeaderDate.jsx'
import MobileDrawerContent from './components/layout/MobileDrawerContent.jsx'

const NominaView = lazy(() => import('./views/NominaView.jsx'))
const FinanzasView = lazy(() => import('./components/finanzas/FinanzasView.jsx'))

const NAV = [
  { to: '/nomina', label: 'Nómina', desc: 'Salarios, asistencia y recibos', icon: Wallet },
  { to: '/finanzas', label: 'Finanzas', desc: 'Movimientos, bancos y balances', icon: Landmark },
  { to: '/sistema', label: 'Sistema', desc: 'Personal y configuración general', icon: Settings2 },
]

function Loading() {
  const [showRetry, setShowRetry] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShowRetry(true), 3000)
    return () => clearTimeout(timer)
  }, [])

  function recargarAplicacion() {
    useAuthStore.setState({ initialized: true, _cargandoPerfil: false, _initializing: false })
    // No borrar registros/cachés de otras aplicaciones ni forzar una versión
    // mientras otra pestaña confirma una operación financiera.
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
  const status = useAuthStore(state => state.authStatus)
  const generation = useAuthStore(state => state.sessionGeneration)
  if (!initialized) return <Loading />
  if (user && (!perfil || loadingProfile && status !== 'authenticated')) return <LoginPage />
  // Roles operativos del sistema (migración 242): jefe/administracion/desarrollador
  // = total; finanzas y nomina = módulo propio. Qué módulos ve cada rol lo decide
  // accesoUI (espejo de la matriz del servidor); el servidor revalida todo endpoint.
  if (!perfil || status !== 'authenticated' || !accesoUI(perfil.rol).finanzas && !accesoUI(perfil.rol).nomina) {
    return <Navigate to="/login" replace />
  }
  return <Outlet key={`${user?.id}:${generation}`} />
}

function Public() {
  const initialized = useAuthStore(useCallback(state => state.initialized, []))
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  const status = useAuthStore(state => state.authStatus)
  if (!initialized) return <Loading />
  if (perfil && status === 'authenticated') return <Navigate to={rutaParaRol(perfil?.rol)} replace />
  return <Outlet />
}



function MobileDrawerOverlay({ onClose, onLogout, onChangeUser }) {
  const panelRef = useRef(null)
  const layerRef = useRef(null)
  const { mobileStyle } = useOverlayPosition({ open: true, anchorRef: layerRef, panelRef })
  const overlay = useOverlay({ open: true, panelRef, layerRef, onRequestClose: onClose })
  useEffect(() => {
    const resize = () => { if (window.innerWidth >= 768) onClose() }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [onClose])
  return createPortal(<OverlayContext.Provider value={overlay.overlayId}>
    <div ref={layerRef} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" style={{ ...mobileStyle, zIndex: overlay.zIndex }} onClick={e => { if (e.target === e.currentTarget) overlay.requestClose('backdrop') }}>
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-label="Menú principal" tabIndex={-1}
        className="translate-x-0 h-full flex flex-col w-[85%] max-w-xs min-w-0 overflow-y-auto rounded-r-2xl bg-slate-900 text-white"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <MobileDrawerContent nav={NAV} onClose={() => overlay.requestClose('close-button')} onLogout={onLogout} onChangeUser={onChangeUser} />
      </aside>
    </div>
  </OverlayContext.Provider>, document.body)
}

function Shell() {
  const logout = useAuthStore(state => state.logout)
  const cambiarOperador = useAuthStore(state => state.cambiarOperador)
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  const acceso = accesoUI(perfil?.rol)
  const navVisible = filtrarNavPorRol(NAV, perfil?.rol)
  const navigate = useNavigate()
  const location = useLocation()
  const mainRef = useRef(null)
  const current = NAV.find(item => location.pathname.startsWith(item.to))
    || navVisible[0]
    || NAV[0]
  const CurrentIcon = current.icon
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth < 1400,
  )
  const collapsed = sidebarCollapsed && !menuOpen

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [location.pathname])

  async function ejecutarCerrarSesion() {
    setConfirmLogoutOpen(false)
    setMenuOpen(false)
    await logout()
    navigate('/login', { replace: true })
  }

  // F2 — cambiar de operador: vuelve a la pantalla de selección + PIN sin
  // cerrar la sesión de la cuenta. El store limpia la selección en el servidor.
  async function ejecutarCambiarUsuario() {
    setMenuOpen(false)
    await cambiarOperador()
  }

  return (
    <div className="flex h-screen h-[100dvh] app-shell-safe overflow-hidden" style={{ background: '#f1f5f9' }}>
      <header
        className="fixed top-0 left-0 right-0 z-40 app-header-safe px-3 md:px-4 flex items-center gap-2.5 md:gap-3 text-white"
        style={{
          background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
        }}
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
          className="md:hidden h-7 w-auto object-contain select-none"
          style={{ filter: 'brightness(1.1)' }}
          draggable={false}
        />

        <div className="hidden md:flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, rgba(27,54,93,0.8), rgba(184,134,11,0.5))', border: '1px solid rgba(184,134,11,0.2)' }}
          >
            <CurrentIcon size={16} className="text-white/80" />
          </div>
          <span className="text-sm font-black tracking-wide text-white/90">{current.label}</span>
          <span className="sr-only">Nómina y Finanzas — Construacero Carabobo</span>
          <HeaderDate />
        </div>

        <div className="flex-1" />
        <RateHeader />
      </header>

      {menuOpen && <MobileDrawerOverlay onClose={() => setMenuOpen(false)} onLogout={() => { setMenuOpen(false); setConfirmLogoutOpen(true) }} onChangeUser={ejecutarCambiarUsuario} />}

      {/* Sidebar fijo en desktop y drawer completo en móvil */}
      <div className={`relative shrink-0 transition-all duration-300 ease-out ${sidebarCollapsed ? 'md:w-[72px]' : 'md:w-64'}`}>
        <aside
          className={`fixed left-0 top-0 bottom-0 z-[200] hidden md:flex flex-col overflow-hidden transition-all duration-300 ease-out ${
            menuOpen ? 'translate-x-0' : '-translate-x-full'
          } ${sidebarCollapsed ? 'md:w-[72px]' : 'md:w-64'} w-[85%] max-w-xs rounded-br-2xl rounded-tr-2xl md:inset-y-0 md:top-auto md:bottom-auto md:rounded-none md:translate-x-0 md:static md:z-auto md:h-[calc(100vh-3.5rem)] md:sticky md:top-14`}
          style={{
            background: 'linear-gradient(180deg, #0a1628 0%, #0d1f3c 60%, #0a1a0f 100%)',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            boxShadow: '4px 0 24px rgba(0,0,0,0.3)',
          }}
        >
          {/* Vista desktop de la Barra Lateral */}
          <div className="hidden md:flex relative flex-col md:h-full min-h-0">
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

            {/* Logo en desktop */}
            <div className="relative z-10 px-4 py-2 flex flex-col items-center shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <img
                src="/logo.png"
                alt="Construacero Carabobo C.A."
                className={`object-contain transition-all duration-300 select-none ${collapsed ? 'h-10 w-10' : 'h-[66px] md:h-20'}`}
                style={{ filter: 'brightness(1.05) drop-shadow(0 0 12px rgba(184,134,11,0.2))' }}
                draggable={false}
              />
              {!collapsed && (
                <div className="mt-1.5 md:mt-2 flex items-center gap-2 w-full justify-center">
                  <div className="h-px flex-1 opacity-20" style={{ background: 'linear-gradient(to right, transparent, #B8860B)' }} />
                  <span className="text-[9px] font-bold tracking-[0.25em] uppercase whitespace-nowrap" style={{ color: 'rgba(184,134,11,0.7)' }}>
                    Gestión empresarial
                  </span>
                  <div className="h-px flex-1 opacity-20" style={{ background: 'linear-gradient(to left, transparent, #B8860B)' }} />
                </div>
              )}
            </div>

            <nav className="relative z-10 flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5 sidebar-scrollbar" aria-label="Navegación principal">
              {navVisible.map(item => <NavItem key={item.to} item={item} collapsed={collapsed} onClick={() => setMenuOpen(false)} />)}
            </nav>

            {/* Zona de sesión en Desktop Sidebar */}
            <div className="relative z-10 p-2.5 pb-3 shrink-0 space-y-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                type="button"
                onClick={ejecutarCambiarUsuario}
                className={`flex items-center ${collapsed ? 'justify-center p-2.5 mx-auto' : 'w-full gap-3 px-3.5 py-2.5'} rounded-xl text-white/70 hover:text-amber-300 hover:bg-amber-500/10 border border-white/[0.06] hover:border-amber-500/25 transition-all duration-150 active:scale-[0.98] group`}
                style={{ background: 'rgba(255,255,255,0.03)' }}
                title="Cambiar de usuario (PIN)"
                aria-label="Cambiar de usuario"
              >
                <UserCog size={17} className="text-white/45 group-hover:text-amber-400 transition-colors shrink-0" />
                {!collapsed && (
                  <span className="text-xs font-bold text-white/80 group-hover:text-white transition-colors truncate">
                    Cambiar de usuario
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setConfirmLogoutOpen(true)}
                className={`flex items-center ${collapsed ? 'justify-center p-2.5 mx-auto' : 'w-full gap-3 px-3.5 py-2.5'} rounded-xl text-white/70 hover:text-red-300 hover:bg-red-500/10 border border-white/[0.06] hover:border-red-500/25 transition-all duration-150 active:scale-[0.98] group`}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                }}
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
              >
                <LogOut size={17} className="text-white/45 group-hover:text-red-400 transition-colors shrink-0" />
                {!collapsed && (
                  <span className="text-xs font-bold text-white/80 group-hover:text-white transition-colors truncate">
                    Cerrar sesión
                  </span>
                )}
              </button>
            </div>
          </div>
        </aside>

        <button
          onClick={() => setSidebarCollapsed(value => !value)}
          className="hidden md:flex absolute -right-3 top-14 min-w-11 min-h-11 rounded-full items-center justify-center transition-all hover:scale-110 z-50"
          style={{ background: '#0d1f3c', border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', color: 'rgba(255,255,255,0.5)' }}
          title={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
          aria-label={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        </button>
      </div>

      <main
        ref={mainRef}
        className="app-main-safe flex-1 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col"
      >
        <div className="w-full flex flex-col flex-1 min-h-0">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
          {/* Hueco tangible del nav móvil: el padding de un contenedor flex con scroll no es fiable. */}
          <div className="app-nav-spacer" aria-hidden="true" />
        </div>
      </main>

      {/* Navegación inferior táctil */}
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
        <div className="flex items-center justify-around px-1 h-16 min-h-[4rem]">
          {navVisible.map(item => {
            const Icon = item.icon
            return <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-xl transition-colors min-w-[58px] ${isActive ? 'text-amber-400' : 'text-white/50 active:text-white/80'}`}
              style={{ touchAction: 'manipulation' }}
            >
              {({ isActive }) => (
                <>
                  <div className={`p-1.5 rounded-lg transition-all ${isActive ? 'bg-amber-400/15' : ''}`}>
                    <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                  </div>
                  <span className={`text-[10px] font-bold ${isActive ? 'text-amber-400' : ''}`}>{item.label}</span>
                </>
              )}
            </NavLink>
          })}
          <button
            onClick={() => setConfirmLogoutOpen(true)}
            className="flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-xl transition-colors min-w-[58px] text-white/50 active:text-white/80"
            style={{ touchAction: 'manipulation' }}
            aria-label="Cerrar sesión"
          >
            <div className="p-1.5 rounded-lg"><LogOut size={20} /></div>
            <span className="text-[10px] font-bold">Salir</span>
          </button>
        </div>
      </nav>

      {/* Modal profesional de confirmación de cierre de sesión */}
      <LogoutConfirmModal
        isOpen={confirmLogoutOpen}
        onClose={() => setConfirmLogoutOpen(false)}
        onConfirm={ejecutarCerrarSesion}
      />

    </div>
  )
}

export default function NominaApp() {
  const initialize = useAuthStore(state => state.initialize)
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  useEffect(() => {
    return initialize()
  }, [initialize])

  const acceso = accesoUI(perfil?.rol)

  return (
    <Routes>
      <Route element={<Public />}><Route path="/login" element={<LoginPage />} /></Route>
      <Route element={<Protected />}><Route element={<Shell />}>
        {/* Defensa en profundidad: aunque el servidor revalida cada endpoint,
            el rol sin acceso al módulo ni siquiera ve la ruta. */}
        {acceso.nomina
          ? <Route path="/nomina" element={<NominaView />} />
          : <Route path="/nomina" element={<Navigate to="/finanzas" replace />} />}
        {acceso.finanzas
          ? <Route path="/finanzas" element={<FinanzasView />} />
          : <Route path="/finanzas" element={<Navigate to="/nomina" replace />} />}
        {acceso.sistema
          ? <Route path="/sistema" element={<SistemaView />} />
          : <Route path="/sistema" element={<Navigate to={acceso.finanzas ? '/finanzas' : '/nomina'} replace />} />}
      </Route></Route>
      <Route path="*" element={<Navigate to={rutaParaRol(perfil?.rol)} replace />} />
    </Routes>
  )
}
