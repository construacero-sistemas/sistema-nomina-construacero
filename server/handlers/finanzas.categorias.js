// server/handlers/finanzas.categorias.js
// Handlers de gestión de categorías financieras (listar / crear / baja / restaurar).
// Extraídos de finanzas.js para mantener el archivo bajo el guardrail de 600 líneas.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator, supaServiceHeaders } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { requireAdmin } from '../lib/permissions.js'
import { DEFAULT_CATEGORIES, normalizeCategory } from '../lib/finanzasUtils.js'

function serviceHeaders(env, prefer = 'return=representation') {
  return { ...supaServiceHeaders(env), Prefer: prefer }
}

function accountFilter(accountId) {
  return `cuenta_id=eq.${encodeURIComponent(accountId)}`
}

function adminContext(request, env) {
  return validateOperator(request, env).then(result => {
    if (result.error) return result
    const denied = requireAdmin(result.operador, request)
    if (denied) return { error: denied }
    if (!isValidUuid(result.operador.cuenta_id)) {
      return { error: jsonError('Cuenta inválida', 403, request) }
    }
    return result
  })
}

async function readBody(request) {
  try {
    return { body: await request.json() }
  } catch {
    return { error: jsonError('Body inválido', 400, request) }
  }
}

export async function handleGetFinanzasCategorias(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?${accountFilter(context.operador.cuenta_id)}` +
      '&activo=eq.true&select=id,nombre,tipo,activo&order=nombre.asc&limit=100',
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!response.ok) return jsonError('No se pudieron cargar las categorías', 500, request)
  const stored = await response.json()
  const names = new Set(stored.map(category => category.nombre.toLowerCase()))
  const defaults = DEFAULT_CATEGORIES
    .filter(category => !names.has(category.nombre.toLowerCase()))
    .map(category => ({ ...category, id: null, activo: true, predeterminada: true }))

  // Papelera: categorías dadas de baja, recuperables desde el gestor.
  const eliminadasRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?${accountFilter(context.operador.cuenta_id)}` +
      '&activo=eq.false&select=id,nombre,tipo,activo&order=nombre.asc&limit=50',
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  const eliminadas = eliminadasRes.ok ? await eliminadasRes.json() : []

  // Conteo de movimientos históricos por categoría (Opción A: preservación contable)
  const movsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos?${accountFilter(context.operador.cuenta_id)}` +
      '&select=categoria',
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  const movRows = movsRes.ok ? await movsRes.json().catch(() => []) : []
  const conteos = {}
  if (Array.isArray(movRows)) {
    for (const m of movRows) {
      if (m.categoria) {
        const k = String(m.categoria).toLowerCase().trim()
        conteos[k] = (conteos[k] || 0) + 1
      }
    }
  }

  const mapConConteos = list => list.map(c => ({
    ...c,
    movimientos_count: conteos[String(c.nombre || '').toLowerCase().trim()] || 0,
  }))

  return json({
    categorias: mapConConteos([...stored, ...defaults]),
    eliminadas: mapConConteos(Array.isArray(eliminadas) ? eliminadas : []),
  }, 200, request)
}

export async function handleCrearFinanzasCategoria(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error
  let category
  try {
    category = normalizeCategory(parsed.body)
  } catch (error) {
    return jsonError(error.message || 'Categoría inválida', 400, request)
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/finanzas_categorias`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify({
      cuenta_id: context.operador.cuenta_id,
      nombre: category.nombre,
      tipo: category.tipo,
      creado_por: context.operador.id,
    }),
  })
  if (!response.ok) {
    const detail = (await response.text()).toLowerCase()
    return jsonError(detail.includes('unique') ? 'La categoría ya existe' : 'No se pudo crear la categoría', detail.includes('unique') ? 409 : 500, request)
  }
  const [row] = await response.json()
  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id, usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol, cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS', accion: 'CATEGORIA_CREADA', entidadTipo: 'finanzas_categorias',
    entidadId: row?.id || null, meta: { tipo: category.tipo }, ip: context.ip,
  }).catch(() => {})
  return json({ ok: true, categoria: row }, 201, request)
}

export async function handleEliminarFinanzasCategoria(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  const id = String(parsed.body?.id || '').trim()
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)

  const lookup = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?id=eq.${encodeURIComponent(id)}` +
      `&${accountFilter(context.operador.cuenta_id)}&select=id,nombre,activo&limit=1`,
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!lookup.ok) return jsonError('No se pudo validar la categoría', 500, request)
  const [row] = await lookup.json().catch(() => [])
  if (!row) return jsonError('Categoría no encontrada', 404, request)
  const esPredeterminada = DEFAULT_CATEGORIES.some(c => c.nombre.toLowerCase() === String(row.nombre).toLowerCase())
  if (esPredeterminada) return jsonError('Las categorías predeterminadas no se pueden eliminar', 400, request)
  if (!row.activo) return json({ ok: true, idempotente: true, id }, 200, request)

  // Baja lógica (preservación contable): la categoría se marca inactiva y los
  // movimientos históricos conservan su texto.
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?id=eq.${encodeURIComponent(id)}` +
      `&${accountFilter(context.operador.cuenta_id)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify({ activo: false }),
    },
  )
  if (!response.ok) return jsonError('No se pudo eliminar la categoría', 500, request)

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'CATEGORIA_ELIMINADA',
    entidadTipo: 'finanzas_categorias',
    entidadId: id,
    meta: { logico: true, nombre: row.nombre },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, id, nombre: row.nombre }, 200, request)
}

export async function handleRestaurarFinanzasCategoria(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  const id = String(parsed.body?.id || '').trim()
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?id=eq.${encodeURIComponent(id)}` +
      `&${accountFilter(context.operador.cuenta_id)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify({ activo: true }),
    },
  )
  if (!response.ok) return jsonError('No se pudo restaurar la categoría', 500, request)
  const [row] = await response.json().catch(() => [])
  if (!row) return jsonError('Categoría no encontrada', 404, request)

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'CATEGORIA_RESTAURADA',
    entidadTipo: 'finanzas_categorias',
    entidadId: id,
    meta: { nombre: row.nombre },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, categoria: row }, 200, request)
}
