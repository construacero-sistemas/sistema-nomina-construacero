// src/components/layout/MobileDrawerContent.jsx
// Contenido del drawer móvil (módulos por rol + tasas + cierre de sesión).
// Extraído de NominaApp.jsx por el guardrail de 600 líneas.
import { useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import { ChevronRight, Lock, LogOut, TrendingUp, UserCog, X } from 'lucide-react'
import useAuthStore from '../../../compat/store/useAuthStore.js'
import { useCandados } from '../../config/candadosRuntime.js'
import { filtrarNavPorRol } from '../../config/navModulos.js'
import useTasaCambioNomina from '../../hooks/useTasaCambioNomina.js'

// NAV e itemBloqueado viven en NominaApp y se pasan por props para evitar
// dependencia circular; el filtro por rol se aplica aquí con accesoUI.
export default function MobileDrawerContent({ nav, estaBloqueado, onClose, onLogout, onChangeUser }) {
  const candados = useCandados()
  const perfil = useAuthStore(useCallback(state => state.perfil, []))
  const navVisible = filtrarNavPorRol(nav, perfil?.rol)
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
            {navVisible.map(item => {
              if (estaBloqueado(item, candados)) {
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
        {onChangeUser && (
          <button
            onClick={onChangeUser}
            className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white font-bold text-xs transition-all active:scale-[0.98]"
            style={{ touchAction: 'manipulation' }}
          >
            <UserCog size={16} />
            <span>Cambiar de usuario</span>
          </button>
        )}
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
