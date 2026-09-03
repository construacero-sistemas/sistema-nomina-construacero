import { Settings2, Users, Lock } from 'lucide-react'
import PageHeader from '../../compat/components/ui/PageHeader.jsx'
import TabConfiguracion from '../components/nomina/TabConfiguracion.jsx'
import { NOMINA_BLOQUEADA } from '../config/modulos.js'

export default function SistemaView() {
  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-4 md:space-y-5 pb-12 md:pb-4">
      <PageHeader
        icon={Settings2}
        title="Sistema"
        subtitle="Configuración general, calendario laboral, reglas de recargos y tasas"
      />

      {/* Banner informativo: personal centralizado en Nómina */}
      <section
        className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/[0.06] to-amber-500/[0.04] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-700 shadow-xs"
        aria-label="Información de personal"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Users size={16} />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-800">Gestión de Personal Centralizada</p>
            <p className="text-[11px] text-slate-500">
              El alta de trabajadores, asignación de cargos, sueldos fijos y comisiones se realiza en el módulo de Nómina.
            </p>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 self-start sm:self-auto px-3.5 py-2 rounded-xl font-bold text-xs shrink-0 ${NOMINA_BLOQUEADA ? 'border border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed' : 'border-primary/25 bg-primary/5 text-primary'}`}
          aria-disabled={NOMINA_BLOQUEADA || undefined}
          title={NOMINA_BLOQUEADA ? 'Disponible próximamente' : 'Ir a Personal'}
        >
          {NOMINA_BLOQUEADA && <Lock size={13} aria-hidden="true" />}
          <span>{NOMINA_BLOQUEADA ? 'Gestión de personal — próximamente' : 'Gestión de personal en Nómina'}</span>
        </span>
      </section>

      {/* Panel de Configuración General, Horarios, Tasas y Recargos */}
      <div className="pt-1">
        <TabConfiguracion />
      </div>
    </div>
  )
}
