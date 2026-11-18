// Kit UI compartido — Interruptor accesible (role="switch").
// El área táctil es de 44×44 (WCAG), pero la pista visible es la de un interruptor
// estándar (48×28 con perilla de 24). Antes la pista ocupaba todo el área táctil y
// se veía como una píldora gruesa. `disabled` lo bloquea de verdad (antes el
// llamador solo ignoraba el clic y el control parecía activo).
export default function Switch({ checked, onChange, label, id, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className="group inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      style={{ touchAction: 'manipulation' }}
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-primary/40 group-focus-visible:ring-offset-2 ${checked ? 'bg-primary' : 'bg-slate-300'}`}
      >
        <span className={`absolute left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </span>
    </button>
  )
}
