import { accesoUI } from './accesoModulos.js'

/** Filtra las rutas de navegación por las capacidades de módulo del rol. */
export function filtrarNavPorRol(nav, rol) {
  const acceso = accesoUI(rol)
  return nav.filter(item => acceso[item.to === '/nomina' ? 'nomina' : item.to === '/sistema' ? 'sistema' : 'finanzas'])
}
