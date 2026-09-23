// Campo de PIN numérico compartido (gestión de usuarios y arranque de cuenta).
// El largo nunca vive aquí: lo decide la matriz única (longitudPin) en cada uso.
export default function PinInput({ value, onChange, disabled, length = 6, autoComplete = 'new-password', dark = false }) {
  const skin = dark
    ? 'border-white/25 bg-white/10 text-white placeholder:text-white/40'
    : 'border-slate-300 text-slate-800 placeholder:text-slate-400'
  return (
    <input
      type="password"
      inputMode="numeric"
      autoComplete={autoComplete}
      value={value}
      onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
      placeholder={`${length} dígitos`}
      disabled={disabled}
      className={`min-h-11 w-full rounded-xl border px-3 py-2 tracking-[0.4em] font-bold placeholder:tracking-normal placeholder:font-normal ${skin}`}
    />
  )
}
