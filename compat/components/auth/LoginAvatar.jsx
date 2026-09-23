// src/components/auth/LoginAvatar.jsx
// Paleta corporativa oscura — profesional/enterprise
const COLORES_ROL = {
  supervisor: {
    from: '#1e4a7a', to: '#0f2d52',
    border: 'rgba(59,130,246,0.5)',
    shadow: '#0a1f3a',
    shadowGlow: 'rgba(59,130,246,0.25)',
    accent: '#3b82f6',
  },
  vendedor: {
    from: '#0f4a42', to: '#062e28',
    border: 'rgba(20,184,166,0.5)',
    shadow: '#041e1a',
    shadowGlow: 'rgba(20,184,166,0.2)',
    accent: '#14b8a6',
  },
  // Recuadro del avatar por rol: metal tintado del color del rol (centro claro
  // para la letra en oscuro, bordes saturados para leer el color de un vistazo).
  finanzas: {
    background: 'linear-gradient(135deg, #2563eb 0%, #dbeafe 45%, #60a5fa 70%, #1d4ed8 100%)',
    border: 'rgba(96,165,250,0.6)',
    shadow: '#1e3a8a',
    shadowGlow: 'rgba(59,130,246,0.35)',
    accent: '#3b82f6',
    darkText: true,
  },
  nomina: {
    background: 'linear-gradient(135deg, #0d9488 0%, #ccfbf1 45%, #5eead4 70%, #0f766e 100%)',
    border: 'rgba(94,234,212,0.6)',
    shadow: '#134e4a',
    shadowGlow: 'rgba(20,184,166,0.3)',
    accent: '#14b8a6',
    darkText: true,
  },
  desarrollador: {
    background: 'linear-gradient(135deg, #6d28d9 0%, #ede9fe 45%, #c4b5fd 70%, #5b21b6 100%)',
    border: 'rgba(196,181,253,0.6)',
    shadow: '#4c1d95',
    shadowGlow: 'rgba(139,92,246,0.3)',
    accent: '#8b5cf6',
    darkText: true,
  },
}

const COLOR_PLATEADO = '#E2E8F0'
const COLOR_DORADO = '#D4AF37'

function hexVariants(hex) {
  const r = parseInt(hex.slice(1,3), 16)
  const g = parseInt(hex.slice(3,5), 16)
  const b = parseInt(hex.slice(5,7), 16)
  const darker  = `rgb(${Math.max(r-50,0)},${Math.max(g-50,0)},${Math.max(b-50,0)})`
  const darkest = `rgb(${Math.max(r-80,0)},${Math.max(g-80,0)},${Math.max(b-80,0)})`
  const glow    = `rgba(${r},${g},${b},0.25)`
  const border  = `rgba(${Math.min(r+40,255)},${Math.min(g+40,255)},${Math.min(b+40,255)},0.5)`
  return { from: darker, to: darkest, border, shadow: darkest, shadowGlow: glow, accent: hex }
}

export default function LoginAvatar({ user, size = 'lg', className = '' }) {
  const nombreFuente = user?.nombre || user?.email || user?.usuario || 'Administración'
  const inicial = nombreFuente.trim().charAt(0).toUpperCase() || 'A'

  // Plata para administración (su identidad) y como respaldo; el resto lleva
  // el metal del color de su rol.
  const esPlateado = !user?.rol
  const esDorado = user?.rol === 'jefe'
  const esVendedorExterno = ['vendedor', 'vendedor_sin_comision'].includes(user?.rol) && (!!user?.es_externo || Number(user?.markup_pct) > 0)

  const v = esPlateado 
    ? {
        background: 'linear-gradient(135deg, #FFFFFF 0%, #E2E8F0 25%, #CBD5E1 50%, #94A3B8 75%, #64748B 100%)',
        border: 'rgba(226,232,240,0.85)',
        shadow: '#334155',
        shadowGlow: 'rgba(203,213,225,0.45)',
        accent: '#CBD5E1',
        darkText: true,
      }
    : (esDorado 
        ? {
            background: 'linear-gradient(135deg, #BF953F 0%, #FCF6BA 45%, #B38728 70%, #AA771C 100%)',
            border: 'rgba(184,134,11,0.6)',
            shadow: '#5e4406',
            shadowGlow: 'rgba(184,134,11,0.3)',
            accent: '#BF953F',
            darkText: true
          }
        : (esVendedorExterno
            ? {
                background: 'linear-gradient(135deg, #B45309 0%, #FCF6BA 45%, #D97706 70%, #78350F 100%)',
                border: 'rgba(217,119,6,0.6)',
                shadow: '#451a03',
                shadowGlow: 'rgba(217,119,6,0.3)',
                accent: '#D97706'
              }
            : (user?.color ? hexVariants(user.color) : (COLORES_ROL[user?.rol] ?? COLORES_ROL.vendedor))))

  const dim = size === 'lg'
    ? 'w-20 h-20 sm:w-[88px] sm:h-[88px] text-3xl sm:text-4xl'
    : 'w-10 h-10 text-sm font-black'

  return (
    <div
      className={`${dim} rounded-2xl flex items-center justify-center font-black select-none transition-all relative overflow-hidden shrink-0 ${className}`}
      style={{
        background: v.background || `linear-gradient(145deg, ${v.from}, ${v.to})`,
        border: `1px solid ${v.border}`,
        boxShadow: `0 3px 0 ${v.shadow}, 0 6px 20px ${v.shadowGlow}, inset 0 1px 1px rgba(255,255,255,0.4)`,
      }}
    >
      {/* Brillo interno sutil */}
      <div className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{ background: 'linear-gradient(145deg, rgba(255,255,255,0.25) 0%, transparent 60%)' }} />
      <span
        className={`relative z-10 select-none ${v.darkText ? 'text-slate-800' : 'text-white'}`}
        style={{
          textShadow: v.darkText ? '0 1px 0 rgba(255,255,255,0.7)' : '0 1px 3px rgba(0,0,0,0.6)',
          letterSpacing: '-0.02em',
        }}
      >
        {inicial}
      </span>
    </div>
  )
}
