// api/lib/auth.js
import { jsonError, isValidUuid } from './utils.js'

// UUID especial para Super Admin virtual (easter egg del logo)
export const SUPER_ADMIN_UUID = '00000000-0000-0000-0000-000000000000'

// ─── Caché en memoria del isolate para verificación de auth ────────────────────
// Cada petición API pagaba 2-3 round-trips a Supabase solo para validar el token
// y el operador. Con TTL corto (60s) las ráfagas de peticiones reutilizan la
// verificación. El isolate de Cloudflare se recicla solo, así que el caché es
// naturalmente efímero. Límite de entradas para acotar memoria.
const AUTH_CACHE_TTL_MS = 60_000;
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
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_ANON_KEY,
      },
    });
    if (!res.ok) return null;
    rawUser = await res.json();
    const ttlMs = expiresAt === null
      ? AUTH_CACHE_TTL_MS
      : Math.max(0, Math.min(AUTH_CACHE_TTL_MS, expiresAt - Date.now()))
    cacheSet(_userCache, token, rawUser, ttlMs);
  }

  // Clonar antes de mutar — el objeto cacheado se comparte entre peticiones
  const user = { ...rawUser };
  // Attach operator context from app_metadata (set by switch-operator)
  user.operator_id = user.app_metadata?.operator_id || null;
  user.operator_rol = user.app_metadata?.operator_rol || null;
  user.operator_nombre = user.app_metadata?.operator_nombre || null;
  user.operator_es_externo = user.app_metadata?.operator_es_externo || null;

  // Allow frontend to override operator_id via header (handles JWT refresh delay)
  const headerOpId = request.headers.get('X-Operator-Id');
  if (headerOpId && isValidUuid(headerOpId) && headerOpId !== user.operator_id) {
    // Verify the operator exists and is active before trusting the header
    const checkRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/usuarios?id=eq.${headerOpId}&activo=eq.true&cuenta_id=eq.${user.id}&select=id,nombre,rol,es_externo`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
    );
    if (checkRes.ok) {
      const [op] = await checkRes.json();
      if (op) {
        user.operator_id = op.id;
        user.operator_rol = op.rol;
        user.operator_nombre = op.nombre;
        user.operator_es_externo = op.es_externo;
      }
    }
  }

  return user;
}

// Obtiene el rol del operador (supervisor | vendedor | administracion | desarrollador | null)
export async function getOperatorRole(operatorId, env, accountId) {
  // El rol nunca se resuelve por UUID aislado: el mismo Worker atiende varios
  // tenants y una consulta sin cuenta_id puede cruzar contexto entre cuentas.
  if (!operatorId || !isValidUuid(accountId)) return null;
  if (operatorId === SUPER_ADMIN_UUID) return 'desarrollador';
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
  return rows.length === 1 ? rows[0].rol : null;
}

// Verifica que el operador sea supervisor consultando la tabla usuarios.
export async function verifySupervisor(operatorId, env, accountId) {
  const rol = await getOperatorRole(operatorId, env, accountId);
  return rol === 'supervisor' || rol === 'jefe' || rol === 'administracion' || rol === 'desarrollador';
}

// Verifica supervisor O administracion O jefe (para endpoints compartidos como reportes).
export async function verifyPrivileged(operatorId, env, accountId) {
  const rol = await getOperatorRole(operatorId, env, accountId);
  return rol === 'supervisor' || rol === 'jefe' || rol === 'administracion' || rol === 'desarrollador';
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

  // Desarrollador virtual — no existe en tabla usuarios
  if (user.operator_id === SUPER_ADMIN_UUID) {
    // El operador virtual debe conservar la cuenta autenticada para que las
    // operaciones multi-tenant del desarrollador no queden sin contexto.
    const operador = {
      id: SUPER_ADMIN_UUID,
      nombre: 'Desarrollador',
      rol: 'desarrollador',
      color: '#8b5cf6',
      cuenta_id: user.id,
      markup_pct: null,
      es_externo: false,
    };
    return { user, operador, headers: supaServiceHeaders(env), ip };
  }

  const h = supaServiceHeaders(env);
  const ROLES_PRIVILEGIADOS = ['supervisor', 'jefe', 'logistica', 'administracion', 'desarrollador'];
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
      return { error: jsonError('Operador no encontrado o inactivo', 403, request) };
    }
    if (requireSupervisor && !ROLES_PRIVILEGIADOS.includes(operador.rol)) {
      return { error: jsonError('Solo supervisores, logistica o administracion pueden realizar esta acción', 403, request) };
    }

    return { user, operador, headers: h, ip };
  } catch (err) {
    console.error('[auth] operator validation failed', err?.message || err);
    return { error: jsonError('No se pudo validar el operador', 500, request) };
  }
}
