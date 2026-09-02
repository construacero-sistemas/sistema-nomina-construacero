import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import LoginAvatar from '../../components/auth/LoginAvatar'

const ROL_ACCENT = {
  administracion: { color: '#CBD5E1', glow: 'rgba(203,213,225,0.45)', chip: 'linear-gradient(135deg, #f1f5f9 0%, #94a3b8 50%, #475569 100%)', chipBorder: 'rgba(203,213,225,0.7)', chipText: '#1e293b', label: 'Cuenta' },
}

export default function UserCard({ user, onClick, index, disabled = false, loading = false }) {
  const [hovered, setHovered] = useState(false)
  const nombre = user?.nombre || 'Sesión activa'
  const acc = ROL_ACCENT[user?.rol] ?? ROL_ACCENT.administracion
  return (
    <div onClick={() => !disabled && onClick(user)} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} className={`operator-card${disabled ? ' operator-card-disabled' : ''}`} role="button" tabIndex={0} aria-label="Sesión activa" onKeyDown={event => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick(user) } }} style={{ animation: 'fadeSlideUp 0.5s ease forwards', animationDelay: `${index * 0.07}s`, opacity: 0 }}>
      <div className="operator-card-surface" style={{ background: hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)', border: `1px solid ${hovered ? acc.color + '60' : 'rgba(255,255,255,0.08)'}`, boxShadow: hovered ? `0 0 0 1px ${acc.color}30, 0 20px 60px rgba(0,0,0,0.4), 0 0 30px ${acc.glow}` : '0 8px 32px rgba(0,0,0,0.3)', backdropFilter: 'blur(10px)', transform: hovered ? 'translateY(-4px) scale(1.02)' : 'translateY(0) scale(1)' }}>
        <div className="absolute top-0 left-[15%] right-[15%] h-px rounded-full transition-opacity duration-300" style={{ background: `linear-gradient(to right, transparent, ${acc.color}, transparent)`, opacity: hovered ? 0.8 : 0.2 }} />
        <div className="operator-card-avatar-wrap relative"><div className="absolute inset-0 rounded-2xl blur-xl transition-opacity duration-300" style={{ background: acc.glow, opacity: hovered ? 1 : 0.4, transform: 'scale(1.3)' }} />{loading ? <Loader2 className="operator-card-avatar relative z-10 animate-spin p-6" aria-label="Abriendo sesión" /> : <LoginAvatar user={user} className="operator-card-avatar relative z-10" />}</div>
        <div className="operator-card-info">
          <p className="operator-card-name font-black text-white leading-tight line-clamp-2 break-words w-full" style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)', fontSize: nombre.length > 20 ? '11px' : nombre.length > 14 ? '12px' : '14px', letterSpacing: nombre.length > 16 ? '0' : '0.01em', wordBreak: 'break-word' }}>{nombre}</p>
          <span className="operator-card-role text-[10px] text-white/50">{acc.label}</span>
        </div>
      </div>
    </div>
  )
}
