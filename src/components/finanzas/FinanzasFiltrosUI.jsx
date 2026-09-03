// src/components/finanzas/FinanzasFiltrosUI.jsx
// Subcomponentes reutilizables de UI para filtros y estados de error del libro financiero
import CustomSelect from '../../../compat/components/ui/CustomSelect.jsx'

export function FilterField({ label, children }) {
  return (
    <label className="space-y-1 min-w-0">
      <span className="block text-[11px] font-bold text-slate-500">{label}</span>
      <span className="block [&>input]:w-full [&>input]:h-11 [&>input]:rounded-xl [&>input]:border [&>input]:border-slate-200 [&>input]:bg-slate-50 [&>input]:px-2.5 [&>input]:text-xs [&>input]:text-slate-700 [&>select]:w-full [&>select]:h-11 [&>select]:rounded-xl [&>select]:border [&>select]:border-slate-200 [&>select]:bg-slate-50 [&>select]:px-2.5 [&>select]:text-xs [&>select]:text-slate-700">
        {children}
      </span>
    </label>
  )
}

export function Choice({ value, onChange, placeholder, options }) {
  return <CustomSelect value={value} onChange={onChange} placeholder={placeholder} options={options} clearable />
}

export function InlineError({ message, onRetry }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700" role="alert">
      {message} <button type="button" onClick={onRetry} className="underline font-black cursor-pointer">Volver a intentar</button>
    </div>
  )
}
