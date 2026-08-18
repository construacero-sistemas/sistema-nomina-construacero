import { useEffect, useCallback } from 'react'
import { Navigate, Outlet, Route, Routes, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Wallet, LogOut } from 'lucide-react'
import useAuthStore from '../compat/store/useAuthStore.js'
import LoginPage from '../compat/modules/auth/LoginPage.jsx'
import NominaView from './views/NominaView.jsx'

const NAV = [
  { to: '/nomina', label: 'Nómina', icon: Wallet },
]

function Loading() {
  return <div className="min-h-screen flex items-center justify-center bg-slate-100"><div className="w-7 h-7 border-[3px] border-sky-200 border-t-sky-600 rounded-full animate-spin" /></div>
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
  const current = NAV.find(item => location.pathname.startsWith(item.to)) || NAV[0]

  async function salir() {
    await switchOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-screen h-[100dvh] pt-12 md:pt-14 overflow-hidden bg-slate-100">
      <header className="fixed top-0 left-0 right-0 z-40 h-12 md:h-14 px-4 flex items-center gap-3 text-white" style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0d1f3c 100%)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <Wallet size={18} className="text-amber-300" />
        <strong className="text-sm tracking-wide">Nómina Construacero</strong>
        <span className="hidden sm:inline text-xs text-white/45">· {current.label}</span>
        <div className="flex-1" />
        <span className="hidden sm:inline text-xs text-white/60">{perfil?.nombre || 'Usuario'}</span>
        <button onClick={salir} className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10" title="Salir" aria-label="Salir"><LogOut size={16} /></button>
      </header>

      <aside className="hidden md:flex md:w-64 shrink-0 flex-col pt-3 px-3 gap-2" style={{ background: 'linear-gradient(180deg, #0a1628 0%, #0d1f3c 60%, #0a1a0f 100%)' }}>
        <div className="px-3 py-4 mb-2 border-b border-white/10">
          <div className="text-[10px] uppercase tracking-[0.18em] text-amber-400/75 font-bold">Sistema independiente</div>
          <div className="text-white font-black mt-1">Nómina Construacero</div>
        </div>
        {NAV.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold ${isActive ? 'text-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`} style={({ isActive }) => isActive ? { background: 'linear-gradient(135deg, rgba(27,54,93,0.9), rgba(184,134,11,0.7))' } : undefined}><Icon size={18} /><span>{label}</span></NavLink>)}
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto"><Outlet /></main>
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
