// api/lib/auth.js
import { json, jsonError, isValidUuid, CODIGO_OPERADOR_INVALIDO } from './utils.js'
import { ROLES_OPERATIVOS, rolesConCapacidad } from '../../../server/lib/permissions.js'

// Roles con acceso operativo y roles de acceso total (migración 245).
// Los dos conjuntos DERIVAN de la matriz única (server/lib/permissions.js);
// aquí no se escribe ningún rol a mano.
const ROLES_TOTALES = new Set(rolesConCapacidad('gestionarUsuarios'));
const OPERATIONAL_ROLES = new Set(ROLES_OPERATIVOS);

// ─── Caché en memoria del isolate para verificación de auth ────────────────────
// Cada petición API pagaba 2-3 round-trips a Supabase solo para validar el token
// y el operador. Con TTL corto (60s) las ráfagas de peticiones reutilizan la
// verificación. El isolate de Cloudflare se recicla solo, así que el caché es
// naturalmente efímero. Límite de entradas para acotar memoria.
// No cachear decisiones de autorización: una revocación o un cambio de rol
// debe comprobarse en la siguiente petición, no al vencer el caché del isolate.
// Conservar el helper de invalidación para consumidores existentes.
const AUTH_CACHE_TTL_MS = 0;
const AUTH_CACHE_MAX = 500;
const _userCache = new Map();     // token → { user (raw), exp }
const _operatorCache = new Map(); // operatorId → { operador, exp }

function cacheGet(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { map.delete(key); return null; }
  return hit.value;
}

function cacheSet(map, key, value, ttlMs = AUTH_CACHE_TTL_MS) {
  if (ttlMs <= 0) return;
  if (map.size >= AUTH_CACHE_MAX) {
    // Evicción simple: borrar la entrada más antigua (primera insertada)
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  map.set(key, { value, exp: Date.now() + Math.min(AUTH_CACHE_TTL_MS, ttlMs) });
}

function tokenExpiresAt(token) {
  const encodedPayload = token.split('.')[1]
  if (!encodedPayload) return null
  try {
    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=')
    const payload = JSON.parse(atob(normalized))
    return Number.isFinite(Number(payload.exp)) ? Number(payload.exp) * 1000 : null
  } catch {
    return null
  }
}

// Invalidar caché de un operador (llamar tras cambios de rol/activo/PIN)
export function invalidateOperatorCache(operatorId) {
  if (!operatorId) return;
  for (const key of _operatorCache.keys()) {
    if (key === operatorId || key.endsWith(`:${operatorId}`)) _operatorCache.delete(key);
  }
}

// Obtiene headers Supabase con service key
export function supaServiceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

// Verifica el JWT del usuario autenticado contra Supabase
// Extrae operator_id/operator_rol de app_metadata si están presentes
export async function verifyAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token || token.length > 4096) return null;
  const expiresAt = tokenExpiresAt(token)
  if (expiresAt !== null && expiresAt <= Date.now()) return null

  // Verificar el token: caché 60s por token para evitar el round-trip repetido.
  // Nunca extender la autorización más allá del `exp` del JWT.
  let rawUser = cacheGet(_userCache, token);
  if (!rawUser) {
    if (!env.SUPABASE_URL) return null;
    // El anon key es la opción normal. En local es frecuente configurar solo
    // la service key del Worker; intentamos ambas claves sin exponer ninguna
    // al navegador. Un JWT válido sigue siendo obligatorio.
    const authApiKeys = [...new Set([
      env.SUPABASE_ANON_KEY,
      env.SUPABASE_SERVICE_KEY,
    ].map(value => String(value || '').trim()).filter(Boolean))]
    if (authApiKeys.length === 0) return null
    for (const apiKey of authApiKeys) {
      const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: apiKey,
        },
      })
      if (res.ok) {
        rawUser = await res.json()
        break
      }
      // Una clave vencida o de otro proyecto no debe impedir probar la otra
      // clave configurada. Nunca se relaja la comprobación del Bearer token.
      if (![401, 403].includes(res.status)) return null
    }
    if (!rawUser) return null
    const ttlMs = expiresAt === null
      ? AUTH_CACHE_TTL_MS
      : Math.max(0, Math.min(AUTH_CACHE_TTL_MS, expiresAt - Date.now()))
    cacheSet(_userCache, token, rawUser, ttlMs);
  }

  // Clonar antes de mutar — el objeto cacheado se comparte entre peticiones
  const user = { ...rawUser };
  // Seleccionar operador no depende de la metadata recién escrita: el endpoint
  // de selección solo necesita validar la cuenta autenticada. Las rutas de
  // negocio sí requieren metadata (o la cabecera verificada) mediante
  // validateOperator.
  user.operator_id = user.app_metadata?.operator_id || null;
  user.operator_rol = user.app_metadata?.operator_rol || null;
  user.operator_nombre = user.app_metadata?.operator_nombre || null;
  user.operator_es_externo = user.app_metadata?.operator_es_externo || null;

  // La identidad del operador SOLO puede salir de app_metadata, escrita por
  // handleSwitchOperator tras validar el PIN en el Worker. La cabecera
  // X-Operator-Id del navegador jamás decide el operador: hacerla autoridad
  // permitía operar como cualquier operador sin su PIN. validateOperator la
  // usa únicamente como comprobación de coherencia (si difiere → 401).
  return user;
}

// Obtiene el único rol operativo permitido; los roles heredados se tratan como null.
export async function getOperatorRole(operatorId, env, accountId) {
  // El rol nunca se resuelve por UUID aislado: el mismo Worker atiende varios
  // tenants y una consulta sin cuenta_id puede cruzar contexto entre cuentas.
  if (!operatorId || !isValidUuid(accountId)) return null;
  const operatorCacheKey = `${accountId}:${operatorId}`;
  const cached = cacheGet(_operatorCache, operatorCacheKey);
  if (cached) return cached.rol ?? null;
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${operatorId}&activo=eq.true&cuenta_id=eq.${accountId}&select=rol`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  const role = rows.length === 1 ? rows[0].rol : null;
  return ROLES_TOTALES.has(role) ? role : null;
}

// Este paquete tiene un único rol operativo. Se conservan ambos nombres de
// compatibilidad para consumidores antiguos, pero nunca amplían autorización.
export async function verifySupervisor(operatorId, env, accountId) {
  return ROLES_TOTALES.has(await getOperatorRole(operatorId, env, accountId));
}

export async function verifyPrivileged(operatorId, env, accountId) {
  return ROLES_TOTALES.has(await getOperatorRole(operatorId, env, accountId));
}

// Valida auth + operator_id, devuelve { user, operador, ip } o Response de error
// HELPERS para endpoints migrados de RPC
export async function validateOperator(request, env, { requireSupervisor = false } = {}) {
  const user = await verifyAuth(request, env);
  if (!user?.id) return { error: jsonError('No autenticado', 401, request) };
  if (!user.operator_id) return { error: jsonError('No hay operador seleccionado', 400, request) };

  const ip = request.headers.get('CF-Connecting-IP') || null;
  const requestedOperatorId = request.headers.get('X-Operator-Id');
  if (requestedOperatorId && requestedOperatorId !== user.operator_id) {
    return { error: jsonError('El operador seleccionado no coincide con la sesión. Vuelve a seleccionar operador.', 401, request) };
  }

  const h = supaServiceHeaders(env);
  try {
    // Caché 60s por operador — evita re-consultar usuarios en cada petición.
    // El filtro de rol se aplica en código para poder compartir la entrada
    // cacheada entre endpoints con y sin requireSupervisor.
    // La cuenta forma parte de la clave: un isolate puede atender peticiones
    // de varios tenants y nunca debe reutilizar contexto entre ellos.
    const operatorCacheKey = `${user.id}:${user.operator_id}`;
    let operador = cacheGet(_operatorCache, operatorCacheKey);
    if (!operador) {
      const res = await fetch(
        `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${user.operator_id}&activo=eq.true&cuenta_id=eq.${user.id}&select=id,nombre,rol,color,cuenta_id,markup_pct,es_externo`,
        { headers: h }
      );
      if (!res.ok) {
        const errText = await res.text();
        console.error('[auth] operator lookup failed', res.status, errText.slice(0, 300));
        return { error: jsonError('No se pudo validar el operador', 502, request) };
      }
      const rows = await res.json();
      operador = rows[0] ?? null;
      if (operador) cacheSet(_operatorCache, operatorCacheKey, operador);
    }

    if (!operador) {
      // 403 que invalida la sesión (marca CODIGO_OPERADOR_INVALIDO): sin este
      // operador activo ninguna petición puede funcionar. El cliente solo cierra
      // sesión con esta marca; los demás 403 son errores de acción.
      return { error: json({ error: 'Operador no encontrado o inactivo', code: CODIGO_OPERADOR_INVALIDO }, 403, request) };
    }
    // Roles operativos del sistema (migración 245 + matriz de permissions.js):
    // jefe/desarrollador = total; finanzas y nomina = módulo propio.
    // Qué puede HACER cada rol lo decide la matriz; aquí solo se exige que
    // el rol sea operativo (tenga entrada en la matriz con acceso).
    if (!OPERATIONAL_ROLES.has(operador.rol)) {
      // Rol revocado: también invalida la sesión (misma marca).
      return { error: json({ error: 'Este rol no tiene acceso operativo al sistema', code: CODIGO_OPERADOR_INVALIDO }, 403, request) };
    }
    if (requireSupervisor && !ROLES_TOTALES.has(operador.rol)) {
      return { error: jsonError('Se requiere un rol de acceso total (jefe)', 403, request) };
    }

    return { user, operador, headers: h, ip };
  } catch (err) {
    console.error('[auth] operator validation failed', err?.message || err);
    return { error: jsonError('No se pudo validar el operador', 500, request) };
  }
}
