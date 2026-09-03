import { lazy, Suspense, useEffect, useCallback, useRef, useState } from 'react'
import {
  ChevronRight, Landmark, Lock, LogOut, Menu, PanelLeftClose,
  PanelLeftOpen, Settings2, TrendingUp, User, Wallet, X
} from 'lucide-react'
import { Link, Navigate, Outlet, Route, Routes, NavLink, useLocation, useNavigate } from 'react-router-dom'
import useAuthStore from '../compat/store/useAuthStore.js'
import LoginPage from '../compat/modules/auth/LoginPage.jsx'
import LogoutConfirmModal from './components/LogoutConfirmModal.jsx'
import ModuloBloqueado from './components/ModuloBloqueado.jsx'
import ComandoDesbloqueo from './components/ComandoDesbloqueo.jsx'
import { useCandados } from './config/candadosRuntime.js'
import { rutaPorDefecto } from './config/modulos.js'
import SistemaView from './views/SistemaView.jsx'
import useTasaCambioNomina from './hooks/useTasaCambioNomina.js'
import RateHeader from './components/layout/RateHeader.jsx'
import HeaderDate from './components/layout/HeaderDate.jsx'

const NominaView = lazy(() => import('./views/NominaView.jsx'))
const FinanzasView = lazy(() => import('./components/finanzas/FinanzasView.jsx'))

// El estado EN VIVO de los candados vive en src/config/candadosRuntime.js.
const NAV = [
  { to: '/nomina', label: 'Nómina', desc: 'Salarios, asistencia y recibos', icon: Wallet, locked: false },
  { to: '/finanzas', label: 'Finanzas', desc: 'Movimientos, bancos y balances', icon: Landmark, locked: false },
  { to: '/sistema', label: 'Sistema', desc: 'Personal y configuración general', icon: Settings2, locked: false },
]

/** ¿Está este ítem del NAV bloqueado ahora mismo? (consulta el runtime) */
function itemBloqueado(item, candados) {
  if (item.to === '/nomina') return candados.nomina
  return item.locked
}

function NavLockedButton({ item, collapsed, onClick }) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? `${item.label} (próximamente)` : undefined}
      aria-label={`${item.label} — bloqueado temporalmente`}
      aria-disabled="true"
      className={`flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-1.5 rounded-xl text-sm font-bold text-white/30 cursor-not-allowed transition-colors duration-150`}
      style={{ touchAction: 'manipulation' }}
    >
      <Icon size={18} />
      {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
      {!collapsed && <Lock size={13} className="text-white/25 shrink-0" aria-hidden="true" />}
    </button>
  )
}

function Loading() {
  const [showRetry, setShowRetry] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShowRetry(true), 3000)
    return () => clearTimeout(timer)
  }, [])

  function recargarAplicacion() {
    useAuthStore.setState({ initialized: true, _cargandoPerfil: false, _initializing: false })
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

function MobileDrawerContent({ onClose, onLogout }) {
  const candados = useCandados()
  const { usd, eur, usdt, loading } = useTasaCambioNomina()
  const format = value => value > 0 ? `${value.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'

  return (
    <div className="flex flex-col h-full justify-between min-h-0 text-white select-none">
      {/* 1. Cabecera del drawer móvil */}
      <div
        className="px-4 py-3.5 flex items-center justify-between shrink-0"
        style={{
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          paddingTop: 'calc(0.875rem + env(safe-area-inset-top, 0px))',
        }}
      >
        <div className="flex items-center gap-2.5">
          <img
            src="/logo.png"
            alt="Construacero Carabobo C.A."
            className="h-8 w-auto object-contain brightness-110 select-none"
            draggable={false}
            onPointerDown={() => window.dispatchEvent(new CustomEvent('logo-tap'))}
          />
          <div>
            <h4 className="text-xs font-black text-white tracking-wide">Construacero</h4>
            <span className="text-[10px] font-bold text-amber-400/80 uppercase tracking-widest block">
              Nómina & Finanzas
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white/80 hover:text-white transition-colors active:scale-95"
          aria-label="Cerrar menú"
        >
          <X size={18} />
        </button>
      </div>

      {/* 2. Cuerpo desplazable con módulos y tasas */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3.5 custom-scrollbar">
        {/* Módulos de Navegación */}
        <div className="space-y-1.5">
          <span className="px-2 text-[10px] font-bold tracking-widest uppercase text-white/40 block">
            Módulos del Sistema
          </span>
          <nav className="space-y-1" aria-label="Navegación móvil">
            {NAV.map(item => {
              if (itemBloqueado(item, candados)) {
                return (
                  <button
                    key={item.to}
                    type="button"
                    onClick={onClose}
                    aria-label={`${item.label} — bloqueado temporalmente`}
                    aria-disabled="true"
                    className="w-full flex items-center justify-between p-3 rounded-2xl bg-white/[0.02] border border-white/[0.05] text-white/35 cursor-not-allowed"
                    style={{ touchAction: 'manipulation' }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-white/[0.04] text-white/30">
                        <item.icon size={18} />
                      </div>
                      <div>
                        <p className="text-xs font-black leading-tight text-white/50">{item.label}</p>
                        <p className="text-[10px] text-white/35 mt-0.5">Disponible próximamente</p>
                      </div>
                    </div>
                    <Lock size={15} className="text-white/25 shrink-0" aria-hidden="true" />
                  </button>
                )
              }
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center justify-between p-3 rounded-2xl transition-all ${
                      isActive
                        ? 'bg-gradient-to-r from-amber-500/20 via-primary/30 to-amber-500/10 border border-amber-500/30 text-white shadow-lg shadow-amber-950/30'
                        : 'bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.05] text-white/70 hover:text-white'
                    }`
                  }
                  style={{ touchAction: 'manipulation' }}
                >
                  {({ isActive }) => (
                    <>
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${isActive ? 'bg-amber-500 text-white shadow-md' : 'bg-white/10 text-white/70'}`}>
                          <Icon size={18} />
                        </div>
                        <div>
                          <p className="text-xs font-black leading-tight text-white">{item.label}</p>
                          <p className="text-[10px] text-white/50 mt-0.5">{item.desc}</p>
                        </div>
                      </div>
                      <ChevronRight size={15} className={isActive ? 'text-amber-400' : 'text-white/30'} />
                    </>
                  )}
                </NavLink>
              )
            })}
          </nav>
        </div>

        {/* Widget de Tasas Referenciales en Móvil */}
        <div className="p-3 rounded-2xl bg-gradient-to-br from-white/[0.05] to-white/[0.02] border border-white/[0.08] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-black text-amber-400 flex items-center gap-1.5">
              <TrendingUp size={13} />
              Tasas Referenciales
            </span>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-white/10 text-white/70 uppercase">
              Al día
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 pt-0.5 text-center">
            <div className="p-1.5 rounded-xl bg-white/[0.04] border border-white/[0.05]">
              <span className="text-[9px] font-bold text-white/40 block">USD BCV</span>
              <strong className="text-[11px] font-black text-white">{loading ? '...' : format(usd)}</strong>
            </div>
            <div className="p-1.5 rounded-xl bg-white/[0.04] border border-white/[0.05]">
              <span className="text-[9px] font-bold text-white/40 block">EUR BCV</span>
              <strong className="text-[11px] font-black text-white">{loading ? '...' : format(eur)}</strong>
            </div>
            <div className="p-1.5 rounded-xl bg-white/[0.04] border border-white/[0.05]">
              <span className="text-[9px] font-bold text-white/40 block">USDT</span>
              <strong className="text-[11px] font-black text-white">{loading ? '...' : format(usdt)}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Footer con Botón de Cerrar Sesión y Versión */}
      <div
        className="p-3.5 border-t border-white/[0.08] bg-black/20 shrink-0 space-y-2"
        style={{ paddingBottom: 'calc(0.875rem + env(safe-area-inset-bottom))' }}
      >
        <button
          onClick={onLogout}
          className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-200 hover:text-white font-bold text-xs transition-all active:scale-[0.98] shadow-lg shadow-red-950/40"
          style={{ touchAction: 'manipulation' }}
        >
          <LogOut size={16} />
          <span>Cerrar sesión</span>
        </button>
        <p className="text-[10px] text-center text-white/30 font-medium">
          Construacero Carabobo C.A. · v2.1
        </p>
      </div>
    </div>
  )
}

function Protected() {
  const initialized = useAuthStore(useCallback(state => state.initialized, []))
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  const user = useAuthStore(useCallback(state => state.user, []))
  const loadingProfile = useAuthStore(useCallback(state => state._cargandoPerfil, []))
  if (!initialized || (user && !perfil && loadingProfile)) return <Loading />
  if (!perfil || perfil.rol !== 'administracion') return <Navigate to="/login" replace />
  return <Outlet />
}

function Public() {
  const initialized = useAuthStore(useCallback(state => state.initialized, []))
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  if (!initialized) return <Loading />
  if (perfil) return <Navigate to={rutaPorDefecto()} replace />
  return <Outlet />
}



function Shell() {
  const logout = useAuthStore(state => state.logout)
  const candados = useCandados()
  const navigate = useNavigate()
  const location = useLocation()
  const mainRef = useRef(null)
  const current = NAV.find(item => location.pathname.startsWith(item.to)) || NAV[0]
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
          onPointerDown={() => window.dispatchEvent(new CustomEvent('logo-tap'))}
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
          {/* Vista móvil del Drawer */}
          <div className="md:hidden h-full flex flex-col min-h-0">
            <MobileDrawerContent
              onClose={() => setMenuOpen(false)}
              onLogout={() => {
                setMenuOpen(false)
                setConfirmLogoutOpen(true)
              }}
            />
          </div>

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
                onPointerDown={() => window.dispatchEvent(new CustomEvent('logo-tap'))}
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
              {NAV.map(item => itemBloqueado(item, candados)
                ? <NavLockedButton key={item.to} item={item} collapsed={collapsed} onClick={() => setMenuOpen(false)} />
                : <NavItem key={item.to} item={item} collapsed={collapsed} onClick={() => setMenuOpen(false)} />)}
            </nav>

            {/* Zona de Cerrar sesión en Desktop Sidebar */}
            <div className="relative z-10 p-2.5 pb-3 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
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
          className="hidden md:flex absolute -right-3 top-14 w-6 h-6 rounded-full items-center justify-center transition-all hover:scale-110 z-50"
          style={{ background: '#0d1f3c', border: '1px solid rgba(255,255,255,0.15)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)', color: 'rgba(255,255,255,0.5)' }}
          title={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
          aria-label={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        </button>
      </div>

      <main
        ref={mainRef}
        className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col pb-36 md:pb-8"
        style={{ paddingBottom: 'calc(8.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="w-full flex flex-col flex-1 min-h-0">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
          <div className="h-16 shrink-0 md:hidden" aria-hidden="true" />
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
          {NAV.map(item => {
            const Icon = item.icon
            if (itemBloqueado(item, candados)) {
              return <button
                key={item.to}
                type="button"
                aria-label={`${item.label} — bloqueado temporalmente`}
                aria-disabled="true"
                className="flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-xl min-w-[58px] text-white/30 cursor-not-allowed"
                style={{ touchAction: 'manipulation' }}
              >
                <div className="p-1.5 rounded-lg relative">
                  <Icon size={20} strokeWidth={2} />
                  <Lock size={10} className="absolute -top-0.5 -right-0.5 text-white/40" aria-hidden="true" />
                </div>
                <span className="text-[10px] font-bold">{item.label}</span>
              </button>
            }
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

      {/* Comando secreto de desbloqueo (teclado / toques en logo) */}
      <ComandoDesbloqueo />
    </div>
  )
}

export default function NominaApp() {
  const initialize = useAuthStore(state => state.initialize)
  const candados = useCandados()
  useEffect(() => {
    return initialize()
  }, [initialize])

  return (
    <Routes>
      <Route element={<Public />}><Route path="/login" element={<LoginPage />} /></Route>
      <Route element={<Protected />}><Route element={<Shell />}>
        {candados.nomina
          ? <Route path="/nomina" element={<ModuloBloqueado />} />
          : <Route path="/nomina" element={<NominaView />} />}
        <Route path="/finanzas" element={<FinanzasView />} />
        <Route path="/sistema" element={<SistemaView />} />
      </Route></Route>
      <Route path="*" element={<Navigate to={rutaPorDefecto()} replace />} />
    </Routes>
  )
}
