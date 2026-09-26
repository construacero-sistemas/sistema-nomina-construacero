// src/hooks/nominaApi.js
// Claves de caché y helper de fetch compartidos por los hooks de nómina. Vive
// aparte para que useNomina.js no concentre todo el módulo en un solo archivo.
import { authFetch } from '../../compat/services/authFetch.js'

export const KEY_EMPLEADOS = ['nomina', 'empleados']
export const KEY_CONFIG = ['nomina', 'config-empleados']
export const KEY_CONFIG_BAJAS = ['nomina', 'config-empleados-bajas']
export const KEY_ASISTENCIA = ['nomina', 'asistencia']
export const KEY_MARCAJE = ['nomina', 'marcaje-hoy']
export const KEY_PERIODOS = ['nomina', 'periodos']
export const KEY_LINEAS = ['nomina', 'lineas']

// ── Helper de fetch con manejo de error uniforme ───────────────────────────────
// authFetch refresca la sesión y reintenta automáticamente en 401.

// El payload completo viaja en el error (además del mensaje) para que la UI pueda
// reaccionar a rechazos que traen datos: p. ej. el 409 de calcular período incluye
// `jornadas_abiertas` y la pantalla abre el diálogo de confirmación con esa lista.
function errorDeRespuesta(res, payload) {
  const error = new Error(payload.error || `Error ${res.status}`)
  error.status = res.status
  error.payload = payload
  return error
}

export async function apiGet(path) {
  const res = await authFetch(path)
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw errorDeRespuesta(res, payload)
  return payload
}

export async function apiPost(path, body) {
  const res = await authFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw errorDeRespuesta(res, payload)
  return payload
}
