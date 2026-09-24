// compat/components/auth/LoginAvatar.jsx
// Recuadro de la LETRA del login: color PLANO por rol con volumen 3D (efecto
// tecla), cero degradados. Volumen = filo claro arriba + franja inferior ~10%
// mas oscura extruida + sombra suave de profundidad.
// El color es fijo por rol (identidad), no por usuario. Presentacion pura
// (literales de rol permitidos via EXENTOS_ROL_LITERAL en check-project).

const COLOR_ROL = {
  jefe: '#D4AF37',                  // oro
  finanzas: '#2563EB',              // azul
  nomina: '#14B8A6',                // turquesa
  desarrollador: '#8B5CF6',         // morado
  supervisor: '#F97316',            // naranja
  vendedor: '#22C55E',              // verde
  vendedor_sin_comision: '#84CC16', // lima
  logistica: '#0EA5E9',             // celeste
}

const COLOR_PLATEADO = '#CBD5E1' // administracion / respaldo
const COLOR_EXTERNO = '#D97706'  // vendedor externo (ambar)

// Luminancia relativa (WCAG) para decidir el color de la letra: oscura solo
// sobre colores claros (umbral 0.42).
function luminancia(hex) {
  const canal = (i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5)
}

// Franja inferior del efecto tecla: el color plano ~10% mas oscuro.
function franjaInferior(hex) {
  const canal = (i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.9)
  return `rgb(${canal(1)},${canal(3)},${canal(5)})`
}

export default function LoginAvatar({ user, size = 'lg', className = '' }) {
  const nombreFuente = user?.nombre || user?.email || user?.usuario || 'Administración'
  const inicial = nombreFuente.trim().charAt(0).toUpperCase() || 'A'

  // Plata para administracion (su identidad) y como respaldo; ambar para
  // vendedores externos; el resto, color solido fijo de su rol.
  const esPlateado = !user?.rol
  const esVendedorExterno = ['vendedor', 'vendedor_sin_comision'].includes(user?.rol) && (!!user?.es_externo || Number(user?.markup_pct) > 0)

  const color = esPlateado
    ? COLOR_PLATEADO
    : (esVendedorExterno
        ? COLOR_EXTERNO
        : (COLOR_ROL[user?.rol] ?? COLOR_PLATEADO))

  const darkText = luminancia(color) > 0.42

  const dim = size === 'lg'
    ? 'w-20 h-20 sm:w-[88px] sm:h-[88px] text-3xl sm:text-4xl'
    : 'w-10 h-10 text-sm font-black'

  return (
    <div
      className={`${dim} rounded-2xl flex items-center justify-center font-black select-none transition-all shrink-0 ${className}`}
      style={{
        background: color,
        border: '1px solid rgba(255,255,255,0.16)',
        // Volumen 3D sin degradados: filo claro arriba (efecto tecla), franja
        // inferior 10% mas oscura extruida y sombra suave de profundidad.
        boxShadow: `inset 0 2px 0 rgba(255,255,255,0.35), 0 6px 0 ${franjaInferior(color)}, 0 14px 24px rgba(0,0,0,0.35)`,
      }}
    >
      <span
        className={`select-none ${darkText ? 'text-slate-800' : 'text-white'}`}
        style={{
          textShadow: darkText ? '0 1px 0 rgba(255,255,255,0.5)' : '0 1px 3px rgba(0,0,0,0.45)',
          letterSpacing: '-0.02em',
        }}
      >
        {inicial}
      </span>
    </div>
  )
}
