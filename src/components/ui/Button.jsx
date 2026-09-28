// Kit UI compartido — Botón con tokens del sistema de diseño
// (Navy Institucional + Dorado Bronce, paridad con POS Cotizaciones).
// Uso: <Button variant="primary|accent|danger|ghost">…</Button>
// Props extra (aria-label, title, type, disabled…) se reenvían tal cual.
export default function Button({ variant = 'primary', className = '', children, ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-primary text-white hover:bg-primary-hover focus-visible:ring-2 ring-primary-focus',
    accent: 'bg-accent text-white hover:bg-accent-hover focus-visible:ring-2 ring-accent-focus',
    danger: 'bg-status-danger text-white hover:bg-red-700 focus-visible:ring-2 ring-red-300',
    ghost: 'bg-white text-content-main border border-border-subtle hover:bg-slate-50 focus-visible:ring-2 ring-primary-focus',
  }
  return (
    <button type="button" className={`${base} ${variants[variant] || variants.primary} ${className}`} {...props}>
      {children}
    </button>
  )
}
