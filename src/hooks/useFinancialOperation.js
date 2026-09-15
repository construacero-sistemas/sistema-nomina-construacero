import { useState } from 'react'
import { authFetch } from '../../compat/services/authFetch.js'
import useAuthStore from '../../compat/store/useAuthStore.js'
import { useAccountQueryClient } from '../../compat/lib/accountQueries.js'

const PREFIX = 'nomina-operation:'
const memory = new Map()
const locks = new Set()
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const identity = state => state.accountId || state.perfil?.cuenta_id || state.user?.id || null
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]))
  return value
}
function load(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null')
    if (uuid(value?.operationId) && /^[a-f0-9]{64}$/.test(value?.fingerprint)) return value
  } catch { /* Fallback only stores an ID and fingerprint, never the payload. */ }
  return memory.get(key) || null
}
function confirmed(result, record, type) {
  return result?.ok === true && result.estado === 'confirmada' && result.tipo === type &&
    uuid(result.operationId) && result.idempotencyKey === record.operationId && result.resultado && typeof result.resultado === 'object' && !Array.isArray(result.resultado)
}

// Only identity and SHA-256 persist in this tab. Retries keep the original key.
export default function useFinancialOperation(type, path) {
  const account = useAuthStore(identity)
  const generation = useAuthStore(s => s.sessionGeneration)
  const key = `${PREFIX}${account}:${type}`
  const owner = `${key}:${generation}`
  const qc = useAccountQueryClient()
  const [state, setState] = useState(() => ({ owner, pending: load(key), busy: false, error: null }))
  if (state.owner !== owner) setState({ owner, pending: load(key), busy: false, error: null })
  const active = () => identity(useAuthStore.getState()) === account && useAuthStore.getState().sessionGeneration === generation
  const ensureCurrent = () => { if (!active()) throw new DOMException('La sesi\u00f3n cambi\u00f3', 'AbortError') }
  const update = patch => { if (active()) setState(s => s.owner === owner ? { ...s, ...patch } : s) }
  const store = value => {
    ensureCurrent()
    if (value) memory.set(key, value); else memory.delete(key)
    try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key) } catch { /* ID remains in memory. */ }
    update({ pending: value })
  }
  async function refresh() {
    ensureCurrent()
    await Promise.all([qc.invalidateQueries({ queryKey: ['finanzas'] }), qc.invalidateQueries({ queryKey: ['nomina'] })])
    ensureCurrent()
  }
  async function lookup(record) {
    ensureCurrent()
    const response = await authFetch(`/api/operaciones/estado?tipo=${type}&operationId=${encodeURIComponent(record.operationId)}`)
    const result = await response.json()
    ensureCurrent()
    if (!response.ok) throw Object.assign(new Error(result.error || 'No se pudo consultar la operaci\u00f3n.'), { status: response.status, code: result.code })
    if (!confirmed(result, record, type) && !(result?.estado === 'no_encontrada' && result.tipo === type && result.idempotencyKey === record.operationId)) {
      throw new Error('Respuesta de estado no verificable. Conserva la clave de la operaci\u00f3n.')
    }
    return result
  }
  const begin = () => {
    ensureCurrent()
    if (!account) throw new Error('Inicia sesi\u00f3n antes de continuar.')
    if (locks.has(key)) throw new Error('Esta operaci\u00f3n ya se est\u00e1 procesando.')
    locks.add(key); update({ busy: true, error: null })
  }
  async function checkStatus() {
    const record = load(key)
    if (!record) return null
    begin()
    try {
      const result = await lookup(record)
      if (confirmed(result, record, type)) { store(null); await refresh(); return result }
      update({ error: new Error('Todav\u00eda no hay confirmaci\u00f3n. Reintenta los mismos datos con esta clave; no crees otra operaci\u00f3n.') })
      return result
    } catch (error) { update({ error }); throw error }
    finally { locks.delete(key); update({ busy: false }) }
  }
  async function mutateAsync(fields) {
    begin()
    let record = load(key)
    try {
      const normalized = canonical({ ...fields, ...(fields.lineaIds ? { lineaIds: [...new Set(fields.lineaIds)].sort() } : {}) })
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(normalized)))), byte => byte.toString(16).padStart(2, '0')).join('')
      ensureCurrent()
      if (record && record.fingerprint !== fingerprint) {
        const known = await lookup(record)
        if (confirmed(known, record, type)) { store(null); await refresh(); throw new Error('La operaci\u00f3n anterior ya qued\u00f3 registrada. Revisa el resultado antes de crear otra.') }
        throw new Error(`Hay una operaci\u00f3n pendiente (${record.operationId}). Conserva los datos originales o solicita conciliaci\u00f3n.`)
      }
      if (!record) record = { operationId: crypto.randomUUID(), fingerprint }
      store(record)
      const response = await authFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...normalized, operationId: record.operationId }) })
      const result = await response.json().catch(() => ({}))
      ensureCurrent()
      if (!response.ok) {
        if (['PT400', 'PT403', 'PT404', 'PT402', 'PT422', 'INVALID_OPERATION', 'OPERATION_KEY_REQUIRED', 'FINANCIAL_UPDATE_REQUIRED'].includes(result.code)) store(null)
        throw Object.assign(new Error(result.error || 'No se confirm\u00f3 la operaci\u00f3n. Comprueba su estado.'), { code: result.code, status: response.status })
      }
      if (!confirmed(result, record, type)) throw new Error('Respuesta no verificable. Conserva la clave y comprueba el estado.')
      store(null); await refresh(); return result
    } catch (error) { update({ error }); throw error }
    finally { locks.delete(key); update({ busy: false }) }
  }
  return { mutateAsync, isPending: state.owner === owner && state.busy, error: state.owner === owner ? state.error : null,
    operationId: state.owner === owner ? state.pending?.operationId || null : null, checkStatus }
}
