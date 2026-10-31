// server/handlers/finanzas.categorias.js
// Handlers de gestión de categorías financieras (listar / crear / baja / restaurar).
// Extraídos de finanzas.js para mantener el archivo bajo el guardrail de 600 líneas.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator, supaServiceHeaders } from '../lib/auth.js'
import { registrarAuditoria } from '../lib/audit.js'
import { requireCapacidad } from '../lib/permissions.js'
import { DEFAULT_CATEGORIES, normalizeCategory } from '../lib/finanzasUtils.js'

function serviceHeaders(env, prefer = 'return=representation') {
  return { ...supaServiceHeaders(env), Prefer: prefer }
}

function accountFilter(accountId) {
  return `cuenta_id=eq.${encodeURIComponent(accountId)}`
}

// Gestionar categorías/motivos es parte de OPERAR el libro (registrar
// ingresos/egresos exige elegir motivo): rol finanzas y jefe/admin pueden.
// El rol nomina no toca finanzas.
function adminContext(request, env) {
  return validateOperator(request, env).then(result => {
    if (result.error) return result
    const denied = requireCapacidad(result.operador, 'operarFinanzas', request)
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

// La baja lógica deja la fila con activo=false y la restricción única
// (cuenta_id, nombre) sigue ocupada. Si el nombre pertenece a una categoría
// archivada, se reactiva en vez de responder "ya existe" (no visible).
async function reactivarArchivadaOConflicto(request, env, context, category) {
  const cuenta = accountFilter(context.operador.cuenta_id)
  const lookup = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?${cuenta}` +
      `&nombre=eq.${encodeURIComponent(category.nombre)}&select=id,nombre,tipo,activo&limit=1`,
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  const [existing] = lookup.ok ? await lookup.json().catch(() => []) : []
  if (!existing || existing.activo) return jsonError('La categoría ya existe', 409, request)

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?id=eq.${encodeURIComponent(existing.id)}&${cuenta}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify({ activo: true, tipo: category.tipo }),
    },
  )
  if (!response.ok) return jsonError('No se pudo crear la categoría', 500, request)
  const [row] = await response.json().catch(() => [])
  if (!row) return jsonError('No se pudo crear la categoría', 500, request)

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'CATEGORIA_RESTAURADA',
    entidadTipo: 'finanzas_categorias',
    entidadId: row.id,
    meta: { nombre: row.nombre, tipo: category.tipo, via: 'creacion' },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, categoria: row, reactivada: true }, 200, request)
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
    if (!detail.includes('unique')) return jsonError('No se pudo crear la categoría', 500, request)
    return reactivarArchivadaOConflicto(request, env, context, category)
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

// Renombra solo el catálogo: los movimientos históricos conservan su texto
// original (preservación contable), igual que en la baja lógica.
export async function handleRenombrarFinanzasCategoria(request, env) {
  const context = await adminContext(request, env)
  if (context.error) return context.error
  const parsed = await readBody(request)
  if (parsed.error) return parsed.error

  const id = String(parsed.body?.id || '').trim()
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)
  let nuevoNombre
  try {
    nuevoNombre = normalizeCategory({ nombre: parsed.body?.nombre, tipo: 'ambos' }).nombre
  } catch (error) {
    return jsonError(error.message || 'Nombre inválido', 400, request)
  }

  const cuenta = accountFilter(context.operador.cuenta_id)
  const lookup = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?id=eq.${encodeURIComponent(id)}` +
      `&${cuenta}&select=id,nombre,tipo,activo&limit=1`,
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!lookup.ok) return jsonError('No se pudo validar la categoría', 500, request)
  const [row] = await lookup.json().catch(() => [])
  if (!row) return jsonError('Categoría no encontrada', 404, request)
  if (DEFAULT_CATEGORIES.some(c => c.nombre.toLowerCase() === String(row.nombre).toLowerCase())) {
    return jsonError('Las categorías predeterminadas no se pueden renombrar', 400, request)
  }
  if (!row.activo) return jsonError('Restaura la categoría antes de renombrarla', 400, request)
  if (row.nombre === nuevoNombre) return json({ ok: true, idempotente: true, categoria: row }, 200, request)

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/finanzas_categorias?id=eq.${encodeURIComponent(id)}&${cuenta}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify({ nombre: nuevoNombre }),
    },
  )
  if (!response.ok) {
    const detail = (await response.text()).toLowerCase()
    if (detail.includes('unique')) {
      return jsonError('Ya existe una categoría con ese nombre (revisa las archivadas)', 409, request)
    }
    return jsonError('No se pudo renombrar la categoría', 500, request)
  }
  const [actualizada] = await response.json().catch(() => [])
  if (!actualizada) return jsonError('Categoría no encontrada', 404, request)

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'FINANZAS',
    accion: 'CATEGORIA_RENOMBRADA',
    entidadTipo: 'finanzas_categorias',
    entidadId: id,
    meta: { anterior: row.nombre, nuevo: nuevoNombre },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, categoria: actualizada }, 200, request)
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
