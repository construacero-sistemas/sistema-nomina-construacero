// src/services/apiBase.js
// Resuelve la URL base del Worker API.
// En Cloudflare Workers las rutas /api/* son same-origin.
// En Vercel, vercel.json proxy /api/* al Worker de Cloudflare.
// En otros hosts, VITE_WORKER_ORIGIN permite apuntar manualmente.

import supabase from './supabase/client'
import useAuthStore from '../store/useAuthStore'

const WORKER_ORIGIN = String(import.meta.env.VITE_WORKER_ORIGIN || '').replace(/\/+$/, '')
const LOCAL_WORKER_ORIGINS = new Set(['http://localhost:8788', 'http://127.0.0.1:8788'])

// Vite solo puede resolver /api/* mediante el Worker de Wrangler local cuando
// se ejecuta `npm run dev` y existe un `.dev.vars` válido.
export const isLocalApi = import.meta.env.DEV && (
  !WORKER_ORIGIN || LOCAL_WORKER_ORIGINS.has(WORKER_ORIGIN)
)

export function apiUrl(path) {
  if (!WORKER_ORIGIN) return path
  return `${WORKER_ORIGIN}${path}`
}

/** Returns auth headers including X-Operator-Id to avoid JWT refresh delay issues */
export async function getAuthHeaders(extra = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const perfil = useAuthStore.getState().perfil
  return {
    ...(extra['Content-Type'] ? {} : { 'Content-Type': 'application/json' }),
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...(perfil?.id ? { 'X-Operator-Id': perfil.id } : {}),
    ...extra,
  }
}
