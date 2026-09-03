// src/config/candadosRuntime.js
// 🔓 Estado de runtime de los candados de lanzamiento por fases.
//
// Los flags de `modulos.js` son la fuente de verdad ESTATICA (lo que sigue
// bloqueado tras recargar). Este store mantiene el estado EN VIVO de la
// sesión: el comando secreto (ComandoDesbloqueo) puede levantar los candados
// sin recargar ni tocar código. Nada aquí se persiste: al recargar, mandan
// los interruptores de modulos.js.
//
// Consumo: `useCandados()` devuelve { nomina, syncPos, cualquiera }.
// Los componentes se suscriben con useSyncExternalStore y se re-renderizan
// al desbloquear, sin tocar `modulos.js` ni duplicar el flag (guardrail).

import { useSyncExternalStore } from 'react'
import { NOMINA_BLOQUEADA, SYNC_POS_BLOQUEADO } from './modulos.js'

// El runtime NACE de los flags estáticos: el día del lanzamiento (flags en
// false) la app arranca desbloqueada y el comando sobra.
let nominaBloqueadaRuntime = NOMINA_BLOQUEADA
let syncPosBloqueadoRuntime = SYNC_POS_BLOQUEADO

const listeners = new Set()

function emitir() {
  for (const l of listeners) l()
}

/**
 * Levanta los candados de la sesión (runtime).
 * @param {{ nomina?: boolean, syncPos?: boolean }} parciales — por defecto ambos.
 */
export function desbloquearSesion({ nomina = true, syncPos = true } = {}) {
  nominaBloqueadaRuntime = !nomina
  syncPosBloqueadoRuntime = !syncPos
  emitir()
}

/** Vuelve al estado de los interruptores estáticos y notifica. */
export function bloquearSesion() {
  nominaBloqueadaRuntime = NOMINA_BLOQUEADA
  syncPosBloqueadoRuntime = SYNC_POS_BLOQUEADO
  emitir()
}

function suscribir(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return `${nominaBloqueadaRuntime ? '1' : '0'}${syncPosBloqueadoRuntime ? '1' : '0'}`
}

/** Hook reactivo: { nomina, syncPos, cualquiera } — estado en vivo de los candados. */
export function useCandados() {
  useSyncExternalStore(suscribir, getSnapshot)
  return {
    nomina: nominaBloqueadaRuntime,
    syncPos: syncPosBloqueadoRuntime,
    cualquiera: nominaBloqueadaRuntime || syncPosBloqueadoRuntime,
  }
}
