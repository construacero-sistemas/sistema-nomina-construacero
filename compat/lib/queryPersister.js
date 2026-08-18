// src/lib/queryPersister.js
// Persists React Query cache to IndexedDB via idb-keyval
import { get, set, del } from 'idb-keyval'

const IDB_KEY = 'CONSTRUACERO_RQ_CACHE'

const buildVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'local'

export const indexedDbPersister = {
  persistClient: async (client) => { await set(IDB_KEY, client) },
  restoreClient: async () => await get(IDB_KEY),
  removeClient: async () => { await del(IDB_KEY) },
}

// Build hash — invalidates persisted cache on each deploy
export const CACHE_BUSTER = buildVersion
