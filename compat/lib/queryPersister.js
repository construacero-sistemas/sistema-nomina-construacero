// Hasta aprobar la política offline, no restaurar datos protegidos desde disco.
// Conserva la interfaz del persister para retirar de forma segura cachés antiguas.
import { get, set, del } from 'idb-keyval'

const LEGACY_KEY = 'CONSTRUACERO_RQ_CACHE'
const buildVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'local'
export const CACHE_BUSTER = buildVersion

export function createAccountQueryPersister(accountId, { enabled = false } = {}) {
  const key = accountId ? `CONSTRUACERO_RQ_CACHE_V2:${accountId}` : null
  return {
    async persistClient(client) {
      if (enabled && key) await set(key, client)
    },
    async restoreClient() {
      await del(LEGACY_KEY)
      if (!enabled || !key) return undefined
      return get(key)
    },
    async removeClient() {
      await del(LEGACY_KEY)
      if (key) await del(key)
    },
  }
}

export const indexedDbPersister = createAccountQueryPersister(null)
