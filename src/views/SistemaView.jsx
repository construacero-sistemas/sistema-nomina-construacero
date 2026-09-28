import { Settings2, Users, UserCog } from 'lucide-react'
import { useState } from 'react'
import PageHeader from '../../compat/components/ui/PageHeader.jsx'
import TabConfiguracion from '../components/nomina/TabConfiguracion.jsx'
import UsuariosPanel from '../components/sistema/UsuariosPanel.jsx'
import useAuthStore from '../../compat/store/useAuthStore.js'
import { tieneCapacidad } from '../config/accesoModulos.js'

function GestionPersonalBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3.5 py-2 rounded-xl font-bold text-xs shrink-0 border-primary/25 bg-primary/5 text-primary"
      title="Ir a Personal"
    >
      <span>Gestión de personal en Nómina</span>
    </span>
  )
}

export default function SistemaView() {
  const [usuariosOpen, setUsuariosOpen] = useState(false)
  const perfil = useAuthStore(state => state.perfil)
  // Gestión de usuarios: capacidad de la matriz única, no una lista local.
  const puedeGestionar = tieneCapacidad(perfil, 'gestionarUsuarios')

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-4 md:space-y-5 pb-4">
      <PageHeader
        icon={Settings2}
        title="Configuración"
        subtitle="Ajustes de empresa y accesos: calendario laboral, reglas de recargos, tasas y usuarios"
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

        <GestionPersonalBadge />
      </section>

      {/* Panel de gestión de usuarios (solo jefe/administración) */}
      {puedeGestionar && (
        <section className="rounded-2xl border border-slate-200 bg-white p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
              <UserCog size={16} />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-slate-800 text-sm">Usuarios y accesos</p>
              <p className="text-[11px] text-slate-500">Crea cuentas con rol (jefe, finanzas, nómina), PIN y actívalas o desactívalas.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setUsuariosOpen(true)}
            className="min-h-11 self-start sm:self-auto inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 font-bold text-white text-sm shrink-0"
          >
            <Users size={16} />
            Gestionar usuarios
          </button>
        </section>
      )}

      {/* Panel de Configuración General, Horarios, Tasas y Recargos */}
      <div className="pt-1">
        <TabConfiguracion />
      </div>

      <UsuariosPanel open={usuariosOpen} onClose={() => setUsuariosOpen(false)} />
    </div>
  )
}
