// compat/modules/auth/UserCard.jsx
// Tarjeta de usuario estilo Netflix (Dark Premium) del sistema de referencia
// (listo-pos-cotizaciones): lift + glow por rol, hairline superior y capas 3D
// (translateZ) que sobresalen al inclinar la tarjeta. Renderizar dentro de
// <CardContainer> para tener el tilt 3D.
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import LoginAvatar from '../../components/auth/LoginAvatar'
import { CardItem } from '../../components/ui/3d-card.jsx'
import { etiquetaRol } from '../../../server/lib/permissions.js'

// Acento visual por rol (glow, hairline y chip), como ROL_ACCENT del proyecto
// de referencia. La etiqueta visible deriva de etiquetaRol (matriz única);  // `label` queda como respaldo para roles sin etiqueta conocida.
const ROL_ACCENT = {
  jefe: { color: '#B8860B', glow: 'rgba(184,134,11,0.5)', chip: 'linear-gradient(135deg, #FFD700 0%, #B8860B 50%, #8B6914 100%)', chipBorder: 'rgba(184,134,11,0.6)', chipText: '#451a03', label: 'Jefe' },
  finanzas: { color: '#3b82f6', glow: 'rgba(59,130,246,0.35)', chip: 'rgba(59,130,246,0.15)', chipBorder: 'rgba(59,130,246,0.3)', label: 'Finanzas' },
  nomina: { color: '#14b8a6', glow: 'rgba(20,184,166,0.3)', chip: 'rgba(20,184,166,0.12)', chipBorder: 'rgba(20,184,166,0.25)', label: 'Nómina' },
  desarrollador: { color: '#8b5cf6', glow: 'rgba(139,92,246,0.35)', chip: 'rgba(139,92,246,0.15)', chipBorder: 'rgba(139,92,246,0.3)', label: 'Desarrollo' },
}

export default function UserCard({ user, onClick, index = 0, disabled = false, loading = false, ariaLabel }) {
  const [hovered, setHovered] = useState(false)
  const nombre = user?.nombre || 'Sesión activa'
  const acc = ROL_ACCENT[user?.rol] ?? ROL_ACCENT.jefe
  const chipLabel = (user?.rol && etiquetaRol(user.rol)) || acc.label

  return (
    <div
      onClick={() => !disabled && onClick(user)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`operator-card${disabled ? ' operator-card-disabled' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel || 'Sesión activa'}
      onKeyDown={event => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick(user) } }}
      style={{ animation: 'fadeSlideUp 0.5s ease both', animationDelay: `${index * 0.07}s` }}
    >
      <div
        className="operator-card-surface"
        style={{
          background: hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${hovered ? acc.color + '60' : 'rgba(255,255,255,0.08)'}`,
          boxShadow: hovered
            ? `0 0 0 1px ${acc.color}30, 0 20px 60px rgba(0,0,0,0.4), 0 0 30px ${acc.glow}`
            : '0 8px 32px rgba(0,0,0,0.3)',
          transform: hovered ? 'translateY(-4px) scale(1.02)' : 'translateY(0) scale(1)',
        }}
      >
        <div
          className="absolute top-0 left-[15%] right-[15%] h-px rounded-full transition-opacity duration-300"
          style={{ background: `linear-gradient(to right, transparent, ${acc.color}, transparent)`, opacity: hovered ? 0.8 : 0.2 }}
        />
        <CardItem translateZ={50} className="operator-card-avatar-wrap relative">
          <div className="absolute inset-0 rounded-2xl blur-xl transition-opacity duration-300" style={{ background: acc.glow, opacity: hovered ? 1 : 0.4, transform: 'scale(1.3)' }} />
          {loading
            ? <Loader2 className="operator-card-avatar relative z-10 animate-spin p-6" aria-label="Abriendo sesión" />
            : <LoginAvatar user={user} className="operator-card-avatar relative z-10" />}
        </CardItem>
        <CardItem translateZ={25} className="operator-card-info" style={{ width: '100%' }}>
          <p
            className="operator-card-name font-black text-white leading-tight line-clamp-2 break-words w-full"
            style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)', fontSize: nombre.length > 20 ? '11px' : nombre.length > 14 ? '12px' : '14px', letterSpacing: nombre.length > 16 ? '0' : '0.01em', wordBreak: 'break-word' }}
          >
            {nombre}
          </p>
          <span
            className="operator-card-role"
            style={{ background: acc.chip, border: `1px solid ${acc.chipBorder}`, color: acc.chipText || acc.color }}
          >
            {chipLabel}
          </span>
        </CardItem>
      </div>
    </div>
  )
}
