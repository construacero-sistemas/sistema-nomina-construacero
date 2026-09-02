// server/handlers/cuentasCustodia.js
// CRUD de cuentas de custodia persistentes en Supabase.
// Reemplaza el almacenamiento en localStorage: las cuentas ahora se comparten
// entre dispositivos. Borrado lógico (activo=false) para no perder historial.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator, supaServiceHeaders } from '../lib/auth.js'
import { requireAdmin } from '../lib/permissions.js'
import { registrarAuditoria } from '../lib/audit.js'
import { clearEgressCache } from '../lib/egressCache.js'
import {
  CUENTAS_DEFAULT,
  normalizeCuentaCustodia,
  cuentaCustodiaResponse,
} from '../lib/cuentasCustodiaUtils.js'

const SELECT = [
  'id', 'codigo', 'nombre', 'tipo', 'cartera', 'moneda', 'banco',
  'numero_cuenta', 'titular', 'identificacion', 'subcuenta_id',
  'predeterminada', 'activo', 'creado_en',
].join(',')

function svcHeaders(env, prefer = 'return=representation') {
  return { ...supaServiceHeaders(env), Prefer: prefer }
}

async function adminContext(request, env) {
  const result = await validateOperator(request, env)
  if (result.error) return result
  const denied = requireAdmin(result.operador, request)
  if (denied) return { error: denied }
  if (!isValidUuid(result.operador.cuenta_id)) {
    return { error: jsonError('Cuenta inválida', 403, request) }
  }
  return result
}

function accountFilter(cuentaId) {
  return `cuenta_id=eq.${encodeURIComponent(cuentaId)}`
}

async function readBody(request) {
  try {
    return { body: await request.json() }
  } catch {
    return { error: jsonError('Body inválido', 400, request) }
  }
}

// GET /api/finanzas/cuentas-custodia
// Devuelve las cuentas ACTIVAS del tenant. Si aún no hay filas (tenant nuevo o
// migración recién aplicada), siembra las cuentas por defecto y las retorna.
export async function handleGetCuentasCustodia(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const { operador } = context
  const headers = svcHeaders(env, 'return=minimal')

  const fetchCuentas = async () => {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cuentas_custodia?${accountFilter(operador.cuenta_id)}` +
        `&activo=eq.true&select=${SELECT}&order=predeterminada.desc,creado_en.asc`,
      { headers },
    )
    if (!res.ok) return null
    return res.json()
  }

  let rows = await fetchCuentas()
  if (rows === null) return jsonError('No se pudieron cargar las cuentas de custodia', 500, request)

  // Sembrar SOLO en el primer acceso real del tenant (cero filas, activas o no).
  // Si el tenant eliminó todas sus cuentas (quedan filas con activo=false), se
  // respeta esa decisión y NO se vuelven a sembrar los ejemplos.
  if (rows.length === 0) {
    const anyRow = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cuentas_custodia?${accountFilter(operador.cuenta_id)}&select=id&limit=1`,
      { headers },
    )
    const existing = anyRow.ok ? await anyRow.json() : null
    if (!Array.isArray(existing)) return jsonError('No se pudieron cargar las cuentas de custodia', 500, request)

    if (existing.length === 0) {
      const seed = await seedDefaults(env, operador, headers)
      if (!seed.ok) return jsonError('No se pudieron inicializar las cuentas de custodia', 500, request)
      rows = await fetchCuentas()
      if (rows === null) return jsonError('No se pudieron cargar las cuentas de custodia', 500, request)
    }
  }

  return json({ cuentas: rows.map(cuentaCustodiaResponse) }, 200, request)
}

async function seedDefaults(env, operador, headers) {
  const payload = CUENTAS_DEFAULT.map((c, i) => ({
    cuenta_id: operador.cuenta_id,
    codigo: c.codigo,
    nombre: c.nombre,
    tipo: c.tipo,
    cartera: c.cartera,
    moneda: c.moneda,
    banco: c.banco,
    numero_cuenta: c.numeroCuenta ?? null,
    titular: c.titular ?? null,
    identificacion: c.identificacion ?? null,
    subcuenta_id: c.subcuentaId,
    predeterminada: true,
    activo: true,
    creado_por: operador.id,
  }))
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_custodia`, {
    method: 'POST',
    headers: svcHeaders(env, 'return=minimal'),
    body: JSON.stringify(payload),
  })
  return { ok: res.ok, status: res.status }
}

// POST /api/finanzas/cuentas-custodia/crear
export async function handleCrearCuentaCustodia(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const { operador } = context
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  let cuenta
  try {
    cuenta = normalizeCuentaCustodia(parsed.body)
  } catch (error) {
    return jsonError(error.message || 'Cuenta inválida', 400, request)
  }

  const payload = {
    cuenta_id: operador.cuenta_id,
    codigo: cuenta.codigo,
    nombre: cuenta.nombre,
    tipo: cuenta.tipo,
    cartera: cuenta.cartera,
    moneda: cuenta.moneda,
    banco: cuenta.banco,
    numero_cuenta: cuenta.numeroCuenta,
    titular: cuenta.titular,
    identificacion: cuenta.identificacion,
    subcuenta_id: cuenta.subcuentaId,
    predeterminada: false,
    activo: true,
    creado_por: operador.id,
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_custodia`, {
    method: 'POST',
    headers: svcHeaders(env),
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const detail = (await res.text()).toLowerCase()
    const conflict = detail.includes('uq_cuentas_custodia_cuenta_nombre_activa') || detail.includes('unique')
    return jsonError(conflict ? 'Ya existe una cuenta con ese nombre' : 'No se pudo crear la cuenta', conflict ? 409 : 500, request)
  }
  const [row] = await res.json()
  if (!row) return jsonError('No se pudo crear la cuenta', 500, request)

  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'CUENTA_CREADA',
    entidadTipo: 'cuentas_custodia',
    entidadId: row.id,
    meta: { nombre: row.nombre, tipo: row.tipo },
    ip: context.ip,
  }).catch(() => {})
  clearEgressCache()

  return json({ ok: true, cuenta: cuentaCustodiaResponse(row) }, 201, request)
}

// POST /api/finanzas/cuentas-custodia/actualizar
export async function handleActualizarCuentaCustodia(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const { operador } = context
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  const id = String(parsed.body?.id || '').trim()
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)

  let cuenta
  try {
    cuenta = normalizeCuentaCustodia(parsed.body)
  } catch (error) {
    return jsonError(error.message || 'Cuenta inválida', 400, request)
  }

  const payload = {
    nombre: cuenta.nombre,
    tipo: cuenta.tipo,
    cartera: cuenta.cartera,
    moneda: cuenta.moneda,
    banco: cuenta.banco,
    numero_cuenta: cuenta.numeroCuenta,
    titular: cuenta.titular,
    identificacion: cuenta.identificacion,
    subcuenta_id: cuenta.subcuentaId,
    actualizado_en: new Date().toISOString(),
  }

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/cuentas_custodia?id=eq.${encodeURIComponent(id)}` +
      `&${accountFilter(operador.cuenta_id)}&activo=eq.true`,
    { method: 'PATCH', headers: svcHeaders(env), body: JSON.stringify(payload) },
  )
  if (!res.ok) {
    const detail = (await res.text()).toLowerCase()
    const conflict = detail.includes('uq_cuentas_custodia_cuenta_nombre_activa') || detail.includes('unique')
    return jsonError(conflict ? 'Ya existe una cuenta con ese nombre' : 'No se pudo actualizar la cuenta', conflict ? 409 : 500, request)
  }
  const [row] = await res.json()
  if (!row) return jsonError('Cuenta no encontrada', 404, request)

  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'CUENTA_ACTUALIZADA',
    entidadTipo: 'cuentas_custodia',
    entidadId: row.id,
    meta: { nombre: row.nombre },
    ip: context.ip,
  }).catch(() => {})
  clearEgressCache()

  return json({ ok: true, cuenta: cuentaCustodiaResponse(row) }, 200, request)
}

// POST /api/finanzas/cuentas-custodia/eliminar
// Borrado LÓGICO (activo=false). No se destruye el historial de movimientos.
export async function handleEliminarCuentaCustodia(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const { operador } = context
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  const id = String(parsed.body?.id || '').trim()
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/cuentas_custodia?id=eq.${encodeURIComponent(id)}` +
      `&${accountFilter(operador.cuenta_id)}&activo=eq.true`,
    { method: 'PATCH', headers: svcHeaders(env, 'return=minimal'), body: JSON.stringify({ activo: false, actualizado_en: new Date().toISOString() }) },
  )
  if (!res.ok) return jsonError('No se pudo eliminar la cuenta', 500, request)

  registrarAuditoria(env, svcHeaders(env, 'return=minimal'), {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'CUENTA_ELIMINADA',
    entidadTipo: 'cuentas_custodia',
    entidadId: id,
    meta: { logico: true },
    ip: context.ip,
  }).catch(() => {})
  clearEgressCache()

  return json({ ok: true, id }, 200, request)
}

// POST /api/finanzas/cuentas-custodia/restaurar
// Restaura las cuentas semilla por defecto (las desactivadas se reactivan por codigo).
export async function handleRestaurarCuentasCustodia(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const { operador } = context
  const headers = svcHeaders(env, 'return=minimal')

  // Reactivar por codigo si existe, o insertar si no (idempotente).
  for (const c of CUENTAS_DEFAULT) {
    const lookup = await fetch(
      `${env.SUPABASE_URL}/rest/v1/cuentas_custodia?${accountFilter(operador.cuenta_id)}` +
        `&codigo=eq.${encodeURIComponent(c.codigo)}&select=id&limit=1`,
      { headers },
    )
    const existing = lookup.ok ? await lookup.json() : []
    if (Array.isArray(existing) && existing.length > 0) {
      const patch = await fetch(
        `${env.SUPABASE_URL}/rest/v1/cuentas_custodia?id=eq.${encodeURIComponent(existing[0].id)}`,
        { method: 'PATCH', headers, body: JSON.stringify({ activo: true, actualizado_en: new Date().toISOString() }) },
      )
      if (!patch.ok) return jsonError('No se pudieron restaurar las cuentas', 500, request)
    } else {
      const insert = await fetch(`${env.SUPABASE_URL}/rest/v1/cuentas_custodia`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          cuenta_id: operador.cuenta_id,
          codigo: c.codigo,
          nombre: c.nombre,
          tipo: c.tipo,
          cartera: c.cartera,
          moneda: c.moneda,
          banco: c.banco,
          numero_cuenta: c.numeroCuenta ?? null,
          titular: c.titular ?? null,
          identificacion: c.identificacion ?? null,
          subcuenta_id: c.subcuentaId,
          predeterminada: true,
          activo: true,
          creado_por: operador.id,
        }),
      })
      if (!insert.ok) return jsonError('No se pudieron restaurar las cuentas', 500, request)
    }
  }

  // Recargar la lista activa completa.
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/cuentas_custodia?${accountFilter(operador.cuenta_id)}` +
      `&activo=eq.true&select=${SELECT}&order=predeterminada.desc,creado_en.asc`,
    { headers },
  )
  if (!res.ok) return jsonError('No se pudieron cargar las cuentas', 500, request)
  const rows = await res.json()

  registrarAuditoria(env, headers, {
    usuarioId: operador.id,
    usuarioNombre: operador.nombre,
    usuarioRol: operador.rol,
    cuentaId: operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'CUENTAS_RESTAURADAS',
    entidadTipo: 'cuentas_custodia',
    entidadId: null,
    meta: { cuentas: rows.length },
    ip: context.ip,
  }).catch(() => {})
  clearEgressCache()

  return json({ ok: true, cuentas: rows.map(cuentaCustodiaResponse) }, 200, request)
}
