// Kit UI compartido — Interruptor accesible (role="switch", WCAG 44×44).
export default function Switch({ checked, onChange, label, id }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`min-h-11 min-w-[3.5rem] rounded-full px-1 transition-colors ${checked ? 'bg-primary' : 'bg-slate-300'}`}
    >
      <span className={`block h-8 w-8 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  )
}
