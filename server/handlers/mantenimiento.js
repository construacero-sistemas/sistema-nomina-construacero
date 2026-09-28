// server/handlers/mantenimiento.js
// Zona de mantenimiento: purga de REGISTROS operativos (Nómina + Finanzas) con
// respaldo obligatorio previo (RPC mantenimiento_purgar, mig. 250).
//
// Seguridad:
//   * Solo roles con `gestionarUsuarios` (jefe / desarrollador) — matriz única.
//   * La purga exige confirmación explícita con la frase exacta en el body.
//   * NUNCA se tocan cuentas (usuarios) ni empleados (clientes): el RPC solo
//     borra el histórico de tablas operativas, siempre por cuenta_id.
//   * Cada ejecución queda en purga_backups (respaldo completo), purga_log y
//     auditoría con operador, rol, módulos y conteos.
import { json, jsonError } from '../lib/utils.js'
import { validateOperator, supaServiceHeaders } from '../lib/auth.js'
import { requireCapacidad } from '../lib/permissions.js'
import { registrarAuditoria } from '../lib/audit.js'

// Módulos purgables (dominio, no roles): en objeto y no en lista para no
// confundir al guardrail de roles literales de check-project.
const MODULOS_VALIDOS = { nomina: true, finanzas: true }
export const FRASE_CONFIRMACION_PURGA = 'ELIMINAR'

function svcHeaders(env) {
  return supaServiceHeaders(env)
}

async function mantenimientoContext(request, env) {
  const context = await validateOperator(request, env)
  if (!context || context.error) return { error: context?.error || jsonError('No autenticado', 401, request) }
  const denied = requireCapacidad(context.operador, 'gestionarUsuarios', request)
  if (denied) return { error: denied }
  return context
}

function validarModulos(modulos, request) {
  if (!Array.isArray(modulos) || modulos.length === 0) {
    return { error: jsonError('Selecciona al menos un módulo (nomina, finanzas)', 400, request) }
  }
  const invalidos = modulos.filter(m => !MODULOS_VALIDOS[m])
  if (invalidos.length) {
    return { error: jsonError(`Módulos inválidos: ${invalidos.join(', ')}`, 400, request) }
  }
  return { modulos: [...new Set(modulos)] }
}

// GET /api/mantenimiento/purga-preview?modulos=nomina,finanzas
// Cuántas filas borraría la purga, por tabla. No modifica nada.
export async function handlePreviewPurga(request, env) {
  const context = await mantenimientoContext(request, env)
  if (context.error) return context.error

  const url = new URL(request.url)
  const crudos = (url.searchParams.get('modulos') || 'nomina,finanzas').split(',').map(m => m.trim()).filter(Boolean)
  const validacion = validarModulos(crudos, request)
  if (validacion.error) return validacion.error

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mantenimiento_purge_preview`, {
    method: 'POST',
    headers: svcHeaders(env),
    body: JSON.stringify({ p_cuenta_id: context.operador.cuenta_id, p_modulos: validacion.modulos }),
  })
  if (!response.ok) {
    return jsonError('No se pudo calcular el previo de purga', 502, request)
  }
  return json({ ok: true, modulos: validacion.modulos, conteos: await response.json() }, 200, request)
}

// POST /api/mantenimiento/purgar
// Body: { modulos: [...], confirmacion: 'ELIMINAR' }  // módulos: nomina y/o finanzas
export async function handlePurgarRegistros(request, env) {
  const context = await mantenimientoContext(request, env)
  if (context.error) return context.error

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('Cuerpo JSON inválido', 400, request)
  }
  const validacion = validarModulos(body?.modulos, request)
  if (validacion.error) return validacion.error
  if (body?.confirmacion !== FRASE_CONFIRMACION_PURGA) {
    return jsonError(`Confirmación incorrecta: escribe ${FRASE_CONFIRMACION_PURGA} para ejecutar la purga`, 400, request)
  }

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mantenimiento_purgar`, {
    method: 'POST',
    headers: svcHeaders(env),
    body: JSON.stringify({
      p_cuenta_id: context.operador.cuenta_id,
      p_modulos: validacion.modulos,
      p_operador_id: context.operador.id,
      p_ejecutado_nombre: context.operador.nombre,
      p_ip: context.ip || null,
    }),
  })
  if (!response.ok) {
    const detalle = await response.json().catch(() => null)
    const mensaje = detalle?.message || 'No se pudo completar la purga'
    // 400 del RPC = regla de negocio (pagos vinculados, operador, módulos).
    return jsonError(mensaje, response.status === 400 ? 409 : 502, request)
  }

  const resultado = await response.json()
  registrarAuditoria(env, { ...svcHeaders(env), Prefer: 'return=minimal' }, {
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'MANTENIMIENTO',
    accion: 'PURGA_REGISTROS',
    descripcion: `Purga de registros (${validacion.modulos.join(' + ')}): ${resultado.total_eliminadas} filas`,
    entidadTipo: 'purga_backups',
    entidadId: resultado.backup_id || null,
    meta: { modulos: validacion.modulos, por_tabla: resultado.por_tabla },
    ip: context.ip,
  }).catch(() => {})

  return json({ ok: true, ...resultado }, 200, request)
}

// GET /api/mantenimiento/purga-backup?id=<uuid>
// Devuelve el payload del respaldo para descargarlo como JSON.
export async function handleDescargarBackupPurga(request, env) {
  const context = await mantenimientoContext(request, env)
  if (context.error) return context.error

  const id = new URL(request.url).searchParams.get('id') || ''
  if (!id) return jsonError('Falta el id del respaldo', 400, request)

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/purga_backups?id=eq.${encodeURIComponent(id)}&cuenta_id=eq.${encodeURIComponent(context.operador.cuenta_id)}&select=id,modulos,total_filas,creado_en,payload&limit=1`,
    { headers: svcHeaders(env) },
  )
  if (!response.ok) return jsonError('No se pudo leer el respaldo', 502, request)
  const [respaldo] = await response.json()
  if (!respaldo) return jsonError('Respaldo no encontrado', 404, request)
  return json({ ok: true, respaldo }, 200, request)
}
