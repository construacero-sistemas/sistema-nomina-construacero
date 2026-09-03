// src/config/modulos.js
// ⚙️ INTERRUPTOR ÚNICO DEL LANZAMIENTO POR FASES.
//
// Para ACTIVAR Nómina: cambia `NOMINA_BLOQUEADA` a `false` y listo —
// navegación (drawer, bottom nav, sidebar), rutas y redirecciones,
// el banner de Sistema y las pestañas de configuración se restauran solos.
// Para volver a bloquearla: `true`. No hay nada más que tocar.
//
// Este archivo es el ÚNICO lugar autorizado para definir el estado del candado
// (lo vigila scripts/check-project.mjs: ningún otro módulo puede declararlo).

/** true = Nómina con candado (solo Finanzas y Sistema→Almacenamiento activos). */
export const NOMINA_BLOQUEADA = true

/** Las secciones de nómina dentro de Sistema siguen al mismo interruptor. */
export const SECCIONES_NOMINA_BLOQUEADAS = NOMINA_BLOQUEADA

/** Ruta de aterrizaje tras login y para rutas desconocidas. */
export function rutaPorDefecto() {
  return NOMINA_BLOQUEADA ? '/finanzas' : '/nomina'
}
