// src/components/ModuloBloqueado.jsx
// Pantalla para módulos bloqueados temporalmente (lanzamiento por fases).
import { Lock } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function ModuloBloqueado() {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
        <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
          <Lock size={26} className="text-slate-400" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-black text-slate-800">Módulo no disponible</h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
          Nómina estará disponible próximamente. Por ahora puedes usar Finanzas para registrar movimientos y consultar la tesorería.
        </p>
        <Link
          to="/finanzas"
          className="mt-5 inline-flex items-center gap-1.5 px-4 py-2.5 min-h-11 rounded-xl bg-primary hover:bg-primary-hover text-white text-sm font-black shadow-xs transition-all active:scale-95"
          style={{ touchAction: 'manipulation' }}
        >
          Ir a Finanzas
        </Link>
      </div>
    </div>
  )
}
