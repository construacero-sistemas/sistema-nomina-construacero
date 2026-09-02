// src/views/NominaView.jsx
// Módulo de nómina: empleados, asistencia, períodos e historial.
import { useState } from 'react'
import { Wallet, Users, CalendarClock, ClipboardList, Archive } from 'lucide-react'
import useAuthStore from '../../compat/store/useAuthStore.js'
import PageHeader from '../../compat/components/ui/PageHeader.jsx'
import useTablistNav from '../../compat/hooks/useTablistNav.js'
import TabEmpleados from '../components/nomina/TabEmpleados.jsx'
import TabAsistencia from '../components/nomina/TabAsistencia.jsx'
import TabPeriodos from '../components/nomina/TabPeriodos.jsx'
import TabHistorial from '../components/nomina/TabHistorial.jsx'

const TABS = [
  { id: 'empleados', label: 'Empleados', short: 'Emple.', icon: Users },
  { id: 'asistencia', label: 'Asistencia', short: 'Asist.', icon: CalendarClock },
  { id: 'periodos', label: 'Períodos', short: 'Períod.', icon: ClipboardList, soloNomina: true },
  { id: 'historial', label: 'Historial', short: 'Hist.', icon: Archive, soloNomina: true },
]

export default function NominaView() {
  const perfil = useAuthStore(s => s.perfil)
  const esAdmin = perfil?.rol === 'administracion'
  const tabsVisibles = TABS.filter(t => !t.soloNomina || esAdmin)
  const [tab, setTab] = useState(esAdmin ? 'empleados' : 'asistencia')
  const tabActivo = tabsVisibles.some(t => t.id === tab) ? tab : tabsVisibles[0].id
  const navegarTabs = useTablistNav(tabsVisibles.map(t => t.id), tabActivo, setTab)

  return (
    <div className="p-3 sm:p-4 md:p-5 lg:p-6 space-y-3 sm:space-y-4 md:space-y-5 pb-12 md:pb-4">
      <PageHeader
        icon={Wallet}
        title="Nómina"
        subtitle="Gestión integral de salarios, asistencia y liquidaciones"
      />


      <div className="flex flex-wrap gap-1 sm:gap-1.5 pb-0.5" role="tablist" aria-label="Secciones de nómina" onKeyDown={navegarTabs}>
        {tabsVisibles.map(t => {
          const Icon = t.icon
          const activo = tabActivo === t.id
          return (
            <button key={t.id} id={t.id} onClick={() => setTab(t.id)} tabIndex={activo ? 0 : -1} role="tab" aria-selected={activo} aria-controls={`nomina-panel-${t.id}`}
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-bold whitespace-nowrap transition-all border shrink-0 ${activo ? 'bg-primary text-white border-primary shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
              <Icon size={12} className="sm:w-3.5 sm:h-3.5" aria-hidden="true" />
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      <div id={`nomina-panel-${tabActivo}`} role="tabpanel" aria-labelledby={tabActivo} tabIndex={-1}>
        {tabActivo === 'empleados' && <TabEmpleados esAdmin={esAdmin} />}
        {tabActivo === 'asistencia' && <TabAsistencia esAdmin={esAdmin} />}
        {tabActivo === 'periodos' && esAdmin && <TabPeriodos esAdmin={esAdmin} />}
        {tabActivo === 'historial' && esAdmin && <TabHistorial />}
      </div>
    </div>
  )
}
