// server/lib/permissions.js
// ─────────────────────────────────────────────────────────────────────────────
// MATRIZ DE CAPACIDADES POR ROL — única fuente de verdad de autorización.
//
// Reglas del negocio (definidas con el jefe):
//   * jefe / desarrollador → todo (nómina + finanzas + saldos).
//   * finanzas → solo módulo Finanzas: registra ingresos/egresos y traspasos,
//     ve el libro de movimientos, pero NUNCA ve saldos ni acumulados.
//   * nomina → solo módulo Nómina: empleados, asistencia, períodos y pagos;
//     NUNCA ve finanzas (ni siquiera el libro).
//
// Este archivo es el ÚNICO lugar del proyecto donde se escriben roles. Toda
// compuerta —handler, hook, vista o sesión— deriva de aquí:
//   * servidor: capacidadesDe / tieneCapacidad / requireCapacidad / rolesConCapacidad
//   * frontend: src/config/accesoModulos.js reexporta este módulo, de modo que
//     la interfaz y el Worker usan exactamente las mismas reglas.
// Ningún otro archivo debe comparar `rol === '…'` ni mantener listas de roles.
// El guardrail (scripts/check-project.mjs) vigila este archivo.
// ─────────────────────────────────────────────────────────────────────────────

import { json, CODIGO_CAPACIDAD_INSUFICIENTE } from './utils.js'

// Alias de compatibilidad: el único rol administrativo vigente es `jefe`.
export const ADMIN_ROLE = 'jefe'

/** Todos los roles válidos del sistema (coincide con usuarios_rol_check, migración 245). */
export const ROLES_VALIDOS = Object.freeze([
  'supervisor', 'vendedor', 'vendedor_sin_comision',
  'logistica', 'desarrollador', 'jefe', 'finanzas', 'nomina',
])

/** Nombres canónicos de las capacidades; el orden es el de la matriz. */
export const CAPACIDADES = Object.freeze([
  'verNomina', 'administrarNomina', 'verFinanzas', 'operarFinanzas',
  'verSaldos', 'gestionarUsuarios', 'administrarSistema',
])

/** Capacidades de acceso total (jefe y desarrollador). */
function capacidadesTotales() {
  return Object.freeze({
    verNomina: true,
    administrarNomina: true,
    verFinanzas: true,
    operarFinanzas: true,
    verSaldos: true,
    gestionarUsuarios: true,
    administrarSistema: true,
  })
}

/** Capacidades del rol finanzas: opera el libro, jamás ve acumulados. */
function capacidadesFinanzas() {
  return Object.freeze({
    verNomina: false,
    administrarNomina: false,
    verFinanzas: true,
    operarFinanzas: true,
    // El secreto del negocio: saldos y KPIs agregados solo para jefe/desarrollador.
    verSaldos: false,
    gestionarUsuarios: false,
    administrarSistema: false,
  })
}

/** Capacidades del rol nomina: módulo nómina completo, finanzas invisible. */
function capacidadesNomina() {
  return Object.freeze({
    verNomina: true,
    administrarNomina: true,
    verFinanzas: false,
    operarFinanzas: false,
    // Pagar recibos usa una cuenta de custodia elegida (el RPC valida fondos),
    // pero el rol nomina nunca consulta saldos.
    verSaldos: false,
    gestionarUsuarios: false,
    administrarSistema: false,
  })
}

const MATRIZ = Object.freeze({
  jefe: capacidadesTotales(),
  desarrollador: capacidadesTotales(),
  finanzas: capacidadesFinanzas(),
  nomina: capacidadesNomina(),
})

/** Capacidades de un rol sin entrada en la matriz (heredado o desconocido). */
const SIN_ACCESO = Object.freeze({
  verNomina: false, administrarNomina: false,
  verFinanzas: false, operarFinanzas: false,
  verSaldos: false, gestionarUsuarios: false, administrarSistema: false,
})

/**
 * Devuelve las capacidades de un operador (objeto inmutable).
 * Roles sin entrada en la matriz (supervisor, vendedor, logistica…) no tienen
 * acceso operativo a este sistema: capacidades vacías.
 * @param {{ rol?: string }|string} operador
 */
export function capacidadesDe(operador) {
  const rol = typeof operador === 'string' ? operador : operador?.rol
  return MATRIZ[rol] || SIN_ACCESO
}

/** ¿El operador tiene esa capacidad? */
export function tieneCapacidad(operador, capacidad) {
  return capacidadesDe(operador)[capacidad] === true
}

/**
 * Roles (de ROLES_VALIDOS) que tienen una capacidad. Es la forma correcta de
 * construir cualquier conjunto de roles: nunca se escribe la lista a mano.
 * @param {string} capacidad clave de CAPACIDADES
 */
export function rolesConCapacidad(capacidad) {
  return ROLES_VALIDOS.filter(rol => tieneCapacidad({ rol }, capacidad))
}

/**
 * Roles con acceso operativo a algún módulo (excluye supervisor, vendedor,
 * vendedor_sin_comision y logistica, que no operan este sistema).
 */
export const ROLES_OPERATIVOS = Object.freeze(
  ROLES_VALIDOS.filter(rol => CAPACIDADES.some(capacidad => tieneCapacidad({ rol }, capacidad))),
)

/**
 * Roles que el panel de usuarios puede crear o asignar: todos los operativos
 * menos la cuenta técnica (desarrollador solo existe como acceso de soporte).
 */
export const ROLES_ASIGNABLES = Object.freeze(
  ROLES_OPERATIVOS.filter(rol => rol !== 'desarrollador'),
)

/**
 * Roles que el panel de usuarios OFRECE al crear o cambiar rol: los asignables
 * sin el rol técnico `desarrollador`, que se reserva para soporte.
 */
export const ROLES_CREABLES = Object.freeze(ROLES_ASIGNABLES)

// ── Longitud del PIN de acceso por rol (requisito del negocio) ───────────────
// Los roles de módulo (finanzas, nomina) usan PIN corto de 4 dígitos; el resto
// usan 6. Única fuente: el login, el panel de usuarios y el Worker derivan de
// aquí su validación (guardrail: scripts/check-project.mjs).
const LONGITUD_PIN_POR_ROL = Object.freeze({
  finanzas: 4,
  nomina: 4,
})

/** Longitud del PIN de acceso de un rol (6 por defecto). */
export function longitudPin(rol) {
  return LONGITUD_PIN_POR_ROL[rol] ?? 6
}

/** ¿El operador (o rol) tiene acceso a algún módulo del sistema? */
export function tieneAccesoOperativo(operador) {
  const rol = typeof operador === 'string' ? operador : operador?.rol
  return ROLES_OPERATIVOS.includes(rol)
}

// ── Compuertas de interfaz (derivadas de la misma matriz) ────────────────────
// El frontend las consume vía src/config/accesoModulos.js; no llevan lógica
// propia para que no puedan divergir del servidor.

/** Módulos visibles y ruta de aterrizaje de un rol. */
export function accesoUI(rol) {
  const capacidades = capacidadesDe(rol)
  return {
    nomina: capacidades.verNomina,
    finanzas: capacidades.verFinanzas,
    sistema: capacidades.administrarSistema,
  }
}

const ETIQUETAS_ROL = Object.freeze({
  jefe: 'Jefe',
  desarrollador: 'Desarrollador',
  finanzas: 'Finanzas',
  nomina: 'Nómina',
})

/** Etiqueta legible del rol (para el sidebar y el menú de sesión). */
export function etiquetaRol(rol) {
  return ETIQUETAS_ROL[rol] || rol || '—'
}

/**
 * Ruta de aterrizaje según el rol. Respeta los candados de lanzamiento
 * (si nómina está bloqueada, el rol nomina aterriza igual — la ruta
 * mostrará el módulo bloqueado hasta que el lanzamiento lo habilite).
 */
export function rutaParaRol(rol) {
  const acceso = accesoUI(rol)
  if (acceso.finanzas) return '/finanzas'
  if (acceso.nomina) return '/nomina'
  return '/finanzas'
}

/**
 * Devuelve un Response de error 403 si al operador le falta la capacidad;
 * null si está autorizado.
 * @param {object} operador
 * @param {string} capacidad clave de la matriz (ej. 'operarFinanzas')
 * @param {Request} request
 */
export function requireCapacidad(operador, capacidad, request) {
  if (tieneCapacidad(operador, capacidad)) return null
  // El `code` distingue «no puedes hacer ESTA acción» de «tu rol ya no vale»: el
  // segundo caso lo emite validateOperator y SÍ invalida la sesión en el cliente.
  return json({ error: 'Acceso denegado: no tienes permiso para esta acción', code: CODIGO_CAPACIDAD_INSUFICIENTE }, 403, request)
}

// ── Compatibilidad con el código existente ───────────────────────────────────

export function isAdminOperator(operator) {
  return tieneCapacidad(operator, 'gestionarUsuarios')
}

/** Acceso administrativo completo: gestionar usuarios/sistema. */
export function requireAdmin(operator, request) {
  return requireCapacidad(operator, 'gestionarUsuarios', request)
}

export function assertAdminRole(role) {
  return tieneCapacidad({ rol: role }, 'gestionarUsuarios')
}
