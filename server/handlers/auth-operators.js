import { json, jsonError, isRateLimited, isValidUuid } from '../lib/utils.js'
import { verifyAuth, invalidateOperatorCache, supaServiceHeaders } from '../lib/auth.js'
import { verifyPinPBKDF2 } from '../lib/crypto.js'
import { registrarAuditoria } from '../lib/audit.js'

const OPERATOR_ROLES = new Set(['administracion'])

function pinLengthForRole() {
  return 6
}

function serviceHeaders(env, prefer = 'return=representation') {
  return {
    ...supaServiceHeaders(env),
    Prefer: prefer,
  }
}

async function readJson(request) {
  try {
    return { body: await request.json() }
  } catch {
    return { error: jsonError('Body inválido', 400, request) }
  }
}

async function loadOperator(env, accountId, operatorId) {
  const url = `${env.SUPABASE_URL}/rest/v1/usuarios` +
    `?id=eq.${operatorId}&cuenta_id=eq.${accountId}&activo=eq.true` +
    '&select=id,nombre,rol,pin_hash,pin_salt,color,markup_pct,comision_pct,comision_pct_cabilla,es_externo&limit=1'
  const response = await fetch(url, { headers: serviceHeaders(env) })
  if (!response.ok) return { error: true, operator: null }
  const [operator] = await response.json()
  return { error: false, operator: operator || null }
}

function publicOperator(operator) {
  if (!operator) return null
  return {
    id: operator.id,
    nombre: operator.nombre,
    rol: operator.rol,
    color: operator.color ?? null,
    markup_pct: operator.markup_pct ?? null,
    comision_pct: operator.comision_pct ?? null,
    comision_pct_cabilla: operator.comision_pct_cabilla ?? null,
    es_externo: !!operator.es_externo,
  }
}

async function setOperatorMetadata(env, userId, operator) {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: serviceHeaders(env),
    body: JSON.stringify({
      app_metadata: {
        operator_id: operator?.id ?? null,
        operator_rol: operator?.rol ?? null,
        operator_nombre: operator?.nombre ?? null,
        operator_es_externo: operator ? !!operator.es_externo : null,
      },
    }),
  })
  return response.ok
}

export async function handleSwitchOperator(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  if (isRateLimited(`switch:${ip}`)) {
    return jsonError('Demasiados intentos. Intenta en un minuto.', 429, request)
  }

  const user = await verifyAuth(request, env)
  if (!user?.id) return jsonError('No autenticado', 401, request)

  const parsed = await readJson(request)
  if (parsed.error) return parsed.error
  const { operator_id: operatorId, pin } = parsed.body || {}
  if (!isValidUuid(operatorId) || typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
    return jsonError('operator_id y pin son inválidos', 400, request)
  }

  const loaded = await loadOperator(env, user.id, operatorId)
  if (loaded.error) return jsonError('Error al buscar operador', 500, request)
  const operator = loaded.operator
  if (!operator) return jsonError('Operador no encontrado o inactivo', 404, request)
  if (!OPERATOR_ROLES.has(operator.rol)) return jsonError('Este sistema solo admite el rol administración', 403, request)

  const expectedLength = pinLengthForRole(operator.rol)
  const masterEnabled = env.ENABLE_DEV_MASTER_PIN === 'true'
  const masterPin = masterEnabled && (
    (expectedLength === 4 && env.DEV_MASTER_PIN_4) ||
    (expectedLength === 6 && env.DEV_MASTER_PIN_6)
  )
  const isMasterPin = masterPin && pin === masterPin
  const isValid = isMasterPin || (
    pin.length === expectedLength &&
    !!operator.pin_hash && !!operator.pin_salt &&
    await verifyPinPBKDF2(pin, operator.pin_hash, operator.pin_salt)
  )

  if (!isValid) {
    registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
      usuarioId: operator.id,
      usuarioNombre: operator.nombre,
      usuarioRol: operator.rol,
      cuentaId: user.id,
      categoria: 'AUTH',
      accion: 'LOGIN_FALLIDO',
      descripcion: 'Intento de PIN inválido',
      entidadTipo: 'usuario',
      entidadId: operator.id,
      meta: { ip },
      ip,
    }).catch(() => {})
    return jsonError('PIN incorrecto', 401, request)
  }

  if (!await setOperatorMetadata(env, user.id, operator)) {
    return jsonError('Error al establecer operador', 500, request)
  }
  invalidateOperatorCache(operator.id)

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: operator.id,
    usuarioNombre: operator.nombre,
    usuarioRol: operator.rol,
    categoria: 'AUTH',
    accion: isMasterPin ? 'LOGIN_MASTER_PIN' : 'LOGIN_EXITOSO',
    descripcion: `${operator.nombre} inició sesión`,
    entidadTipo: 'usuario',
    entidadId: operator.id,
    meta: { ip },
    ip,
  }).catch(() => {})

  return json({ ok: true, operator: publicOperator(operator) }, 200, request)
}

export async function handleClearOperator(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.id) return jsonError('No autenticado', 401, request)
  if (!await setOperatorMetadata(env, user.id, null)) {
    return jsonError('No se pudo cerrar el operador', 500, request)
  }
  return json({ ok: true }, 200, request)
}

// Publica únicamente datos de presentación. pin_hash y pin_salt nunca salen del Worker.
export async function handleGetOperators(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.id) return jsonError('No autenticado', 401, request)

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?activo=eq.true&rol=eq.administracion&cuenta_id=eq.${user.id}` +
    '&select=id,nombre,rol,color,markup_pct,comision_pct,comision_pct_cabilla,es_externo&order=nombre.asc',
    { headers: serviceHeaders(env) },
  )
  if (!response.ok) return jsonError('Error al obtener operadores', 500, request)

  const operators = (await response.json()).map(publicOperator)
  return json({ operators }, 200, request)
}
