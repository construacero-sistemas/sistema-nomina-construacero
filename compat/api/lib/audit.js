// api/lib/audit.js

// ── System Logging ─────────────────────────────────────────────────────────
// Inserta logs persistentes en system_logs via service_role
export async function logToSystem(env, { nivel = 'error', origen = 'worker', categoria, mensaje, stack, endpoint, usuario_id, usuario_nombre, meta }) {
  // Solo imprimir en consola para desarrollo/soporte en Cloudflare, evitando consumir espacio en Supabase
  const msg = `[SYSTEM_LOG:${nivel.toUpperCase()}] [${origen}] [${categoria}] ${mensaje}${stack ? `\nStack: ${stack}` : ''}${meta ? `\nMeta: ${JSON.stringify(meta)}` : ''}`;
  if (nivel === 'error') {
    console.error(msg);
  } else if (nivel === 'warn') {
    console.warn(msg);
  } else {
    console.log(msg);
  }
}

// Registra auditoría via REST.
// Los handlers la lanzan sin esperarla (no deben demorar la respuesta), pero en Cloudflare
// una promesa suelta puede cancelarse al terminar la petición: cada envío queda anotado
// en `pendientes` y el Worker lo sostiene con ctx.waitUntil(auditoriasPendientes()).
// Un fallo ya no es silencioso: se deja constancia en el log del Worker.
const pendientes = new Set();

export function auditoriasPendientes() {
  return Promise.allSettled([...pendientes]);
}

async function enviarAuditoria(env, headers, { usuarioId, usuarioNombre, usuarioRol, categoria, accion, descripcion, entidadTipo, entidadId, meta, ip, cuentaId }) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/auditoria`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      usuario_id: usuarioId,
      usuario_nombre: usuarioNombre,
      usuario_rol: usuarioRol,
      cuenta_id: cuentaId || null,
      categoria: categoria,
      accion: accion,
      descripcion: descripcion || null,
      entidad_tipo: entidadTipo,
      entidad_id: entidadId,
      meta: meta || null,
      ip_origen: ip || null,
    }),
  });
  if (!response.ok) {
    console.error(`[AUDITORIA_FALLIDA] ${accion} (${categoria}) respondió ${response.status}`);
    throw new Error(`Auditoría no registrada (${response.status})`);
  }
}

export function registrarAuditoria(env, headers, datos) {
  const promesa = enviarAuditoria(env, headers, datos);
  const liberar = () => pendientes.delete(promesa);
  pendientes.add(promesa);
  promesa.then(liberar, liberar);
  return promesa;
}
