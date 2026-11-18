// src/utils/porterosSesion.js
// Regla única de los dos «porteros» de rutas de NominaApp:
//   - el portero privado (Nómina, Finanzas, Configuración) y
//   - el portero público (/login).
// Antes cada uno decidía con su propia condición y, mientras la sesión cambiaba
// de estado muy rápido, se mandaban entre /login y /finanzas sin parar hasta que
// Safari cortaba con «history.replaceState() más de 100 veces en 10 segundos».
//
// Garantías:
//   1. Ambos usan la MISMA condición (`sesionAdmitida`): para un mismo estado,
//      a lo sumo uno de los dos redirige.
//   2. El portero privado solo redirige a /login cuando NO hay sesión abierta;
//      con sesión abierta (perfil cargando, error, acceso negado) muestra la
//      pantalla de acceso en el mismo lugar, sin cambiar la dirección.
import { accesoUI } from '../config/accesoModulos.js'

/** ¿La sesión puede entrar a los módulos? */
export function sesionAdmitida({ perfil, authStatus } = {}) {
  if (!perfil || authStatus !== 'authenticated') return false
  const acceso = accesoUI(perfil.rol)
  return Boolean(acceso.finanzas || acceso.nomina)
}

/**
 * Qué hace el portero privado.
 * @returns {'cargando'|'entrar'|'acceso-en-sitio'|'ir-login'}
 */
export function decisionPorteroPrivado(estado = {}) {
  if (!estado.initialized) return 'cargando'
  if (sesionAdmitida(estado)) return 'entrar'
  if (estado.user) return 'acceso-en-sitio'
  return 'ir-login'
}

/**
 * Qué hace el portero público (/login).
 * @returns {'cargando'|'ir-modulo'|'mostrar-login'}
 */
export function decisionPorteroPublico(estado = {}) {
  if (!estado.initialized) return 'cargando'
  if (sesionAdmitida(estado)) return 'ir-modulo'
  return 'mostrar-login'
}
