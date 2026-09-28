// server/handlers/gestionar-operadores.js
// Panel de gestión de usuarios (F5 del plan de roles): crear operadores con PIN,
// listar todos (activos e inactivos), activar/desactivar y cambiar rol o PIN.
//
// Seguridad:
//   * Solo roles con `gestionarUsuarios` (jefe / desarrollador).
//   * El PIN se recibe en texto plano por HTTPS y se guarda SOLO como PBKDF2
//     (100k iteraciones + salt de 16 bytes); jamás se devuelve al cliente.
//   * Cada mutación queda en auditoría con operador, rol y meta.
//   * Reglas del negocio: la cuenta mantiene UN único usuario operativo activo
//     por rol de módulo (finanzas, nomina); jefe/admin no se duplican.
import { json, jsonError, isValidUuid } from '../lib/utils.js'
import { validateOperator, verifyAuth, supaServiceHeaders } from '../lib/auth.js'
import { hashPinPBKDF2, generateSalt } from '../lib/crypto.js'
import { registrarAuditoria } from '../lib/audit.js'
import { requireCapacidad, ROLES_OPERATIVOS, ROLES_VALIDOS, ROLES_ASIGNABLES, ROLES_CREABLES, longitudPin } from '../lib/permissions.js'

// ROLES_CREABLES y ROLES_OPERATIVOS derivan de la matriz única: aquí no se
// escribe ninguna lista de roles a mano. La longitud del PIN por rol también
// (finanzas/nomina: 4 dígitos; el resto: 6).

// Máximo de usuarios operativos activos por rol (regla de negocio simple).
const MAX_ACTIVOS_POR_ROL = Object.freeze({
  jefe: 2,
  finanzas: 1,
  nomina: 1,
})

function serviceHeaders(env, prefer = 'return=representation') {
  return {
    ...supaServiceHeaders(env),
    Prefer: prefer,
  }
}

function publicUsuario(row) {
  if (!row) return null
  return {
    id: row.id,
    nombre: row.nombre,
    rol: row.rol,
    color: row.color ?? null,
    activo: row.activo !== false,
    tiene_pin: !!row.pin_hash,
    creado_en: row.creado_en ?? null,
  }
}

async function fetchUsuarios(env, cuentaId, { soloActivos = false } = {}) {
  const activo = soloActivos ? '&activo=eq.true' : ''
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?cuenta_id=eq.${encodeURIComponent(cuentaId)}${activo}` +
      '&select=id,nombre,rol,color,activo,pin_hash,pin_salt,creado_en&order=nombre.asc&limit=50',
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!response.ok) return { error: true }
  const rows = await response.json()
  return { rows: Array.isArray(rows) ? rows : [] }
}

function auditContext(user, operador, ip) {
  return {
    usuarioId: operador?.id ?? user.id,
    usuarioNombre: operador?.nombre ?? 'sistema',
    usuarioRol: operador?.rol ?? 'desconocido',
    cuentaId: user.id,
    ip,
  }
}

async function gestionContext(request, env) {
  // Mismo patrón que el resto de handlers: validateOperator carga el operador
  // real desde la tabla usuarios (la BD es la autoridad, no la metadata JWT).
  const result = await validateOperator(request, env)
  if (!result || result.error) {
    return { error: result?.error || jsonError('No autenticado', 401, request) }
  }
  const denied = requireCapacidad(result.operador, 'gestionarUsuarios', request)
  if (denied) return { error: denied }
  return { user: result.user, operador: result.operador, ip: result.ip }
}

async function readJson(request) {
  try {
    return { body: await request.json() }
  } catch {
    return { error: jsonError('Body inválido', 400, request) }
  }
}

function validarNombre(nombre) {
  const limpio = String(nombre || '').trim().replace(/\s+/g, ' ')
  if (limpio.length < 3 || limpio.length > 60) return null
  return limpio
}

// El largo del PIN lo decide la matriz única por rol (finanzas/nomina: 4).
function validarPin(rol, pin) {
  const largo = longitudPin(rol)
  return typeof pin === 'string' && pin.length === largo && /^\d+$/.test(pin)
}

// GET /api/gestion/operadores — lista completa (activos + inactivos).
export async function handleListarOperadores(request, env) {
  const context = await gestionContext(request, env)
  if (context.error) return context.error
  const result = await fetchUsuarios(env, context.user.id)
  if (result.error) return jsonError('No se pudo cargar la lista de usuarios', 502, request)
  const usuarios = result.rows
    .filter(row => ROLES_OPERATIVOS.includes(row.rol))
    .map(publicUsuario)
  return json({ usuarios }, 200, request)
}

// POST /api/gestion/operadores/crear — { nombre, rol, pin, color? }
export async function handleCrearOperador(request, env) {
  const context = await gestionContext(request, env)
  if (context.error) return context.error
  const parsed = await readJson(request)
  if (parsed.error) return parsed.error

  const nombre = validarNombre(parsed.body?.nombre)
  const rol = String(parsed.body?.rol || '').trim()
  const pin = parsed.body?.pin
  const color = typeof parsed.body?.color === 'string' ? parsed.body.color.slice(0, 20) : null

  if (!nombre) return jsonError('El nombre debe tener entre 3 y 60 caracteres', 400, request)
  if (!ROLES_CREABLES.includes(rol)) {
    return jsonError(`Rol inválido. Permitidos: ${ROLES_CREABLES.join(', ')}`, 400, request)
  }
  if (!validarPin(rol, pin)) {
    return jsonError(`El PIN debe ser de ${longitudPin(rol)} dígitos`, 400, request)
  }

  // Regla: máximo de activos por rol.
  const existentes = await fetchUsuarios(env, context.user.id, { soloActivos: true })
  if (existentes.error) return jsonError('No se pudo validar los usuarios existentes', 502, request)
  const activosDelRol = existentes.rows.filter(row => row.rol === rol)
  if (activosDelRol.length >= (MAX_ACTIVOS_POR_ROL[rol] ?? 1)) {
    return jsonError(`Ya existe el máximo permitido de usuarios activos con rol ${rol}. Desactiva uno primero.`, 409, request)
  }
  // Regla: nombre único dentro de la cuenta.
  if (existentes.rows.some(row => row.nombre.toLowerCase() === nombre.toLowerCase())) {
    return jsonError('Ya existe un usuario con ese nombre', 409, request)
  }

  const pin_salt = generateSalt()
  const pin_hash = await hashPinPBKDF2(pin, pin_salt)

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify({ cuenta_id: context.user.id, nombre, rol, color, pin_hash, pin_salt }),
  })
  if (!response.ok) {
    const detail = (await response.text()).toLowerCase()
    return jsonError(
      detail.includes('duplicate') || detail.includes('unique') ? 'Ya existe un usuario con ese nombre' : 'No se pudo crear el usuario',
      detail.includes('duplicate') || detail.includes('unique') ? 409 : 502,
      request,
    )
  }
  const [row] = await response.json()

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    ...auditContext(context.user, context.operador, context.ip),
    categoria: 'USUARIOS',
    accion: 'USUARIO_CREADO',
    descripcion: `Usuario ${nombre} (${rol}) creado`,
    entidadTipo: 'usuario',
    entidadId: row?.id || null,
    meta: { rol },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, usuario: publicUsuario(row) }, 201, request)
}

// POST /api/gestion/operadores/bootstrap — { nombre, pin, rol? }
// Arranque de cuenta: única puerta que se autoriza solo con la identidad de la
// CUENTA (JWT), porque no puede existir operador con PIN si la cuenta no tiene
// ninguno. Solo responde cuando NO hay operadores activos (también recupera la
// cuenta donde «desactivaron a todos»); el rol se fija en `jefe` para que el
// primer usuario pueda crear y administrar el resto — un primer
// finanzas/nómina recrearía el callejón sin salida. La entrada al sistema no
// ocurre aquí: el frontend pasa después por switch-operator con el PIN recién
// creado, que es quien valida el PIN y escribe la metadata de sesión.
export async function handleBootstrapOperador(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.id) return jsonError('No autenticado', 401, request)
  const parsed = await readJson(request)
  if (parsed.error) return parsed.error

  const rol = 'jefe'
  const nombre = validarNombre(parsed.body?.nombre)
  const pin = parsed.body?.pin
  const rolSolicitado = parsed.body?.rol == null ? rol : String(parsed.body.rol).trim()
  if (!nombre) return jsonError('El nombre debe tener entre 3 y 60 caracteres', 400, request)
  if (rolSolicitado !== rol) {
    return jsonError('El primer usuario debe ser jefe para poder administrar el resto', 400, request)
  }
  if (!validarPin(rol, pin)) {
    return jsonError(`El PIN debe ser de ${longitudPin(rol)} dígitos`, 400, request)
  }

  // Puerta única: cero operadores activos. El histórico (inactivos) se respeta:
  // el nombre sigue siendo único y nada se reactiva por aquí.
  const existentes = await fetchUsuarios(env, user.id)
  if (existentes.error) return jsonError('No se pudo validar los usuarios existentes', 502, request)
  const hayActivos = existentes.rows.some(row => row.activo !== false && ROLES_OPERATIVOS.includes(row.rol))
  if (hayActivos) {
    return jsonError('La cuenta ya tiene usuarios activos. Gestiónalos desde Usuarios y accesos.', 409, request)
  }
  if (existentes.rows.some(row => row.nombre.toLowerCase() === nombre.toLowerCase())) {
    return jsonError('Ya existe un usuario con ese nombre', 409, request)
  }

  const pin_salt = generateSalt()
  const pin_hash = await hashPinPBKDF2(pin, pin_salt)

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/usuarios`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify({ cuenta_id: user.id, nombre, rol, color: null, pin_hash, pin_salt }),
  })
  if (!response.ok) {
    const detail = (await response.text()).toLowerCase()
    return jsonError(
      detail.includes('duplicate') || detail.includes('unique') ? 'Ya existe un usuario con ese nombre' : 'No se pudo crear el usuario',
      detail.includes('duplicate') || detail.includes('unique') ? 409 : 502,
      request,
    )
  }
  const [row] = await response.json()

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    usuarioId: row?.id || user.id,
    usuarioNombre: nombre,
    usuarioRol: rol,
    cuentaId: user.id,
    categoria: 'USUARIOS',
    accion: 'BOOTSTRAP_PRIMER_USUARIO',
    descripcion: `Arranque de cuenta: primer usuario ${nombre} (${rol}) creado`,
    entidadTipo: 'usuario',
    entidadId: row?.id || null,
    meta: { rol, bootstrap: true },
    ip,
  }).catch(() => {})

  return json({ ok: true, usuario: publicUsuario(row) }, 201, request)
}

// POST /api/gestion/operadores/estado — { id, activo } (activar/desactivar).
export async function handleCambiarEstadoOperador(request, env) {
  const context = await gestionContext(request, env)
  if (context.error) return context.error
  const parsed = await readJson(request)
  if (parsed.error) return parsed.error
  const id = String(parsed.body?.id || '')
  const activo = parsed.body?.activo
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)
  if (typeof activo !== 'boolean') return jsonError('activo debe ser booleano', 400, request)

  // Nadie puede desactivar su propio usuario desde su sesión: dejaría su
  // operador inactivo y el siguiente request recibiría el 403 de operador
  // inválido, que sí cierra la sesión («No pudimos abrir tu cuenta») hasta
  // que otro jefe lo reactive.
  if (!activo && String(id) === String(context.operador?.id || '')) {
    return jsonError('No puedes desactivar tu propio usuario. Pídeselo a otro jefe.', 409, request)
  }

  const lookup = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(id)}` +
      `&cuenta_id=eq.${encodeURIComponent(context.user.id)}&select=id,nombre,rol,activo&limit=1`,
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!lookup.ok) return jsonError('No se pudo validar el usuario', 502, request)
  const [row] = await lookup.json().catch(() => [])
  if (!row) return jsonError('Usuario no encontrado', 404, request)
  if (row.activo === activo) return json({ ok: true, idempotente: true }, 200, request)

  // Al reactivar, respetar el máximo por rol.
  if (activo) {
    const existentes = await fetchUsuarios(env, context.user.id, { soloActivos: true })
    const activosDelRol = (existentes.rows || []).filter(r => r.rol === row.rol)
    if (activosDelRol.length >= (MAX_ACTIVOS_POR_ROL[row.rol] ?? 1)) {
      return jsonError(`Ya existe el máximo permitido de usuarios activos con rol ${row.rol}`, 409, request)
    }
  }

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(id)}` +
      `&cuenta_id=eq.${encodeURIComponent(context.user.id)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify({ activo }),
    },
  )
  if (!response.ok) return jsonError('No se pudo cambiar el estado del usuario', 502, request)

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    ...auditContext(context.user, context.operador, context.ip),
    categoria: 'USUARIOS',
    accion: activo ? 'USUARIO_ACTIVADO' : 'USUARIO_DESACTIVADO',
    descripcion: `Usuario ${row.nombre} ${activo ? 'activado' : 'desactivado'}`,
    entidadTipo: 'usuario',
    entidadId: id,
    meta: { rol: row.rol },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, id }, 200, request)
}

// POST /api/gestion/operadores/pin — { id, pin } (restablecer PIN).
export async function handleCambiarPinOperador(request, env) {
  const context = await gestionContext(request, env)
  if (context.error) return context.error
  const parsed = await readJson(request)
  if (parsed.error) return parsed.error
  const id = String(parsed.body?.id || '')
  const pin = parsed.body?.pin
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)
  // El largo se valida contra el rol del usuario destino (se conoce tras el lookup).
  if (typeof pin !== 'string' || !/^\d+$/.test(pin)) return jsonError('El PIN debe ser numérico', 400, request)

  const lookup = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(id)}` +
      `&cuenta_id=eq.${encodeURIComponent(context.user.id)}&select=id,nombre,rol,activo&limit=1`,
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!lookup.ok) return jsonError('No se pudo validar el usuario', 502, request)
  const [row] = await lookup.json().catch(() => [])
  if (!row) return jsonError('Usuario no encontrado', 404, request)
  if (row.activo === false) return jsonError('No se puede cambiar el PIN de un usuario inactivo', 400, request)
  if (!validarPin(row.rol, pin)) {
    return jsonError(`El PIN debe ser de ${longitudPin(row.rol)} dígitos`, 400, request)
  }

  const pin_salt = generateSalt()
  const pin_hash = await hashPinPBKDF2(pin, pin_salt)
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(id)}` +
      `&cuenta_id=eq.${encodeURIComponent(context.user.id)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify({ pin_hash, pin_salt }),
    },
  )
  if (!response.ok) return jsonError('No se pudo actualizar el PIN', 502, request)

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    ...auditContext(context.user, context.operador, context.ip),
    categoria: 'USUARIOS',
    accion: 'USUARIO_PIN_RESTABLECIDO',
    descripcion: `PIN restablecido para ${row.nombre}`,
    entidadTipo: 'usuario',
    entidadId: id,
    meta: { rol: row.rol },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, id }, 200, request)
}

// POST /api/gestion/operadores/rol — { id, rol } (cambiar rol de un usuario activo).
export async function handleCambiarRolOperador(request, env) {
  const context = await gestionContext(request, env)
  if (context.error) return context.error
  const parsed = await readJson(request)
  if (parsed.error) return parsed.error
  const id = String(parsed.body?.id || '')
  const rol = String(parsed.body?.rol || '').trim()
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)
  if (!ROLES_CREABLES.includes(rol)) {
    return jsonError(`Rol inválido. Permitidos: ${ROLES_CREABLES.join(', ')}`, 400, request)
  }

  const lookup = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(id)}` +
      `&cuenta_id=eq.${encodeURIComponent(context.user.id)}&select=id,nombre,rol,activo&limit=1`,
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!lookup.ok) return jsonError('No se pudo validar el usuario', 502, request)
  const [row] = await lookup.json().catch(() => [])
  if (!row) return jsonError('Usuario no encontrado', 404, request)
  if (row.activo === false) return jsonError('No se puede cambiar el rol de un usuario inactivo', 400, request)
  if (row.rol === rol) return json({ ok: true, idempotente: true }, 200, request)

  // Al ocupar el cupo del rol destino, respetar el máximo.
  const existentes = await fetchUsuarios(env, context.user.id, { soloActivos: true })
  const activosDelRol = (existentes.rows || []).filter(r => r.rol === rol && r.id !== id)
  if (activosDelRol.length >= (MAX_ACTIVOS_POR_ROL[rol] ?? 1)) {
    return jsonError(`Ya existe el máximo permitido de usuarios activos con rol ${rol}`, 409, request)
  }

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(id)}` +
      `&cuenta_id=eq.${encodeURIComponent(context.user.id)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify({ rol }),
    },
  )
  if (!response.ok) return jsonError('No se pudo cambiar el rol', 502, request)

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    ...auditContext(context.user, context.operador, context.ip),
    categoria: 'USUARIOS',
    accion: 'USUARIO_ROL_CAMBIADO',
    descripcion: `Rol de ${row.nombre}: ${row.rol} → ${rol}`,
    entidadTipo: 'usuario',
    entidadId: id,
    meta: { rolAnterior: row.rol, rolNuevo: rol },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, id, rol }, 200, request)
}

// POST /api/gestion/operadores/nombre — { id, nombre } (renombrar usuario).
// A diferencia de PIN/rol, también renombra usuarios INACTIVOS: corrige el
// histórico y libera un nombre para reutilizarlo (la unicidad es por cuenta
// incluyendo desactivados, igual que al crear). No toca el acceso.
export async function handleCambiarNombreOperador(request, env) {
  const context = await gestionContext(request, env)
  if (context.error) return context.error
  const parsed = await readJson(request)
  if (parsed.error) return parsed.error
  const id = String(parsed.body?.id || '')
  const nombre = validarNombre(parsed.body?.nombre)
  if (!isValidUuid(id)) return jsonError('id inválido', 400, request)
  if (!nombre) return jsonError('El nombre debe tener entre 3 y 60 caracteres', 400, request)

  const lookup = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(id)}` +
      `&cuenta_id=eq.${encodeURIComponent(context.user.id)}&select=id,nombre,rol,activo&limit=1`,
    { headers: serviceHeaders(env, 'return=minimal') },
  )
  if (!lookup.ok) return jsonError('No se pudo validar el usuario', 502, request)
  const [row] = await lookup.json().catch(() => [])
  if (!row) return jsonError('Usuario no encontrado', 404, request)
  if (row.nombre === nombre) return json({ ok: true, idempotente: true }, 200, request)

  // Nombre único dentro de la cuenta, incluido el histórico (igual que al crear).
  const existentes = await fetchUsuarios(env, context.user.id)
  if (existentes.error) return jsonError('No se pudo validar los usuarios existentes', 502, request)
  if (existentes.rows.some(r => r.id !== id && r.nombre.toLowerCase() === nombre.toLowerCase())) {
    return jsonError('Ya existe un usuario con ese nombre', 409, request)
  }

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(id)}` +
      `&cuenta_id=eq.${encodeURIComponent(context.user.id)}`,
    {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify({ nombre }),
    },
  )
  if (!response.ok) {
    const detail = (await response.text()).toLowerCase()
    const duplicado = detail.includes('duplicate') || detail.includes('unique')
    return jsonError(
      duplicado ? 'Ya existe un usuario con ese nombre' : 'No se pudo cambiar el nombre',
      duplicado ? 409 : 502,
      request,
    )
  }

  registrarAuditoria(env, serviceHeaders(env, 'return=minimal'), {
    ...auditContext(context.user, context.operador, context.ip),
    categoria: 'USUARIOS',
    accion: 'USUARIO_NOMBRE_CAMBIADO',
    descripcion: `Nombre: ${row.nombre} → ${nombre}`,
    entidadTipo: 'usuario',
    entidadId: id,
    meta: { rol: row.rol, nombreAnterior: row.nombre, nombreNuevo: nombre },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, id, nombre }, 200, request)
}

export { ROLES_ASIGNABLES, ROLES_CREABLES }
