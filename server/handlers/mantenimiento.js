// server/handlers/mantenimiento.js
// Zona de mantenimiento: purga de REGISTROS operativos (Nómina + Finanzas) con
// respaldo obligatorio previo (RPC mantenimiento_purgar, mig. 250).
//
// Seguridad:
//   * EXCLUSIVO del rol jefe: compuerta `purgarRegistros` de la matriz única
//     (requireCapacidad). Ni desarrollador, ni finanzas, ni nómina.
//   * La purga exige confirmación explícita con la frase exacta en el body.
//   * Opcionalmente se acota a un RANGO DE FECHAS (desde/hasta): solo se borra
//     lo que cae en el rango y lo que depende de ello (ver mig. 250).
//   * NUNCA se tocan cuentas (usuarios) ni empleados (clientes): el RPC solo
//     borra el histórico de tablas operativas, siempre por cuenta_id.
//   * Cada ejecución queda en purga_backups (respaldo completo), purga_log y
//     auditoría con operador, rol, módulos, rango y conteos.
import { json, jsonError } from '../lib/utils.js'
import { validateOperator, supaServiceHeaders } from '../lib/auth.js'
import { requireCapacidad } from '../lib/permissions.js'
import { registrarAuditoria } from '../lib/audit.js'

// Módulos purgables (dominio, no roles): en objeto y no en lista para no
// confundir al guardrail de roles literales de check-project.
const MODULOS_VALIDOS = { nomina: true, finanzas: true }
export const FRASE_CONFIRMACION_PURGA = 'ELIMINAR'

// Códigos de error de las RPC del núcleo financiero (PT4xx) → HTTP.
const ESTADOS_RPC = { PT400: 400, PT403: 403, PT404: 404, PT409: 409 }
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/

function svcHeaders(env) {
  return supaServiceHeaders(env)
}

async function mantenimientoContext(request, env) {
  const context = await validateOperator(request, env)
  if (!context || context.error) return { error: context?.error || jsonError('No autenticado', 401, request) }
  const denied = requireCapacidad(context.operador, 'purgarRegistros', request)
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

// Rango de fechas opcional (AAAA-MM-DD): ambas son opcionales, pero si llegan
// deben ser fechas reales y coherentes (desde <= hasta). Sin fechas = modo total.
function validarFechas(desde, hasta, request) {
  for (const [nombre, valor] of [['desde', desde], ['hasta', hasta]]) {
    if (valor == null || valor === '') continue
    // Ida y vuelta: descarta tanto el formato como fechas imposibles
    // (2026-02-31 no puede desbordar a marzo).
    const fecha = (typeof valor === 'string' && FORMATO_FECHA.test(valor)) ? new Date(`${valor}T00:00:00Z`) : null
    const valida = fecha && !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor
    if (!valida) return { error: jsonError(`Fecha ${nombre} inválida: usa el formato AAAA-MM-DD`, 400, request) }
  }
  if (desde && hasta && desde > hasta) {
    return { error: jsonError('Rango de fechas inválido: desde es posterior a hasta', 400, request) }
  }
  return { desde: desde || null, hasta: hasta || null }
}

function errorRpc(response, detalle, request, fallback) {
  const mensaje = detalle?.message || fallback
  const estado = ESTADOS_RPC[detalle?.code] || (response.status === 400 ? 409 : 502)
  return jsonError(mensaje, estado, request)
}

function etiquetaRango(desde, hasta) {
  return desde || hasta ? ` (${desde || '…'} → ${hasta || '…'})` : ''
}

// GET /api/mantenimiento/purga-preview?modulos=nomina,finanzas&desde=&hasta=
// Cuántas filas borraría la purga, por tabla. No modifica nada.
export async function handlePreviewPurga(request, env) {
  const context = await mantenimientoContext(request, env)
  if (context.error) return context.error

  const url = new URL(request.url)
  const crudos = (url.searchParams.get('modulos') || 'nomina,finanzas').split(',').map(m => m.trim()).filter(Boolean)
  const validacion = validarModulos(crudos, request)
  if (validacion.error) return validacion.error
  const rango = validarFechas(url.searchParams.get('desde'), url.searchParams.get('hasta'), request)
  if (rango.error) return rango.error

  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/mantenimiento_purge_preview`, {
    method: 'POST',
    headers: svcHeaders(env),
    body: JSON.stringify({
      p_cuenta_id: context.operador.cuenta_id,
      p_modulos: validacion.modulos,
      p_desde: rango.desde,
      p_hasta: rango.hasta,
    }),
  })
  if (!response.ok) {
    const detalle = await response.json().catch(() => null)
    return errorRpc(response, detalle, request, 'No se pudo calcular el previo de purga')
  }
  return json({ ok: true, modulos: validacion.modulos, rango, conteos: await response.json() }, 200, request)
}

// POST /api/mantenimiento/purgar
// Body: { modulos: [...], confirmacion: 'ELIMINAR', desde?, hasta? }
//   módulos: nomina y/o finanzas; desde/hasta (AAAA-MM-DD) acotan el borrado.
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
  const rango = validarFechas(body?.desde, body?.hasta, request)
  if (rango.error) return rango.error
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
      p_desde: rango.desde,
      p_hasta: rango.hasta,
    }),
  })
  if (!response.ok) {
    const detalle = await response.json().catch(() => null)
    // PT4xx del RPC = regla de negocio (pagos vinculados, operador, módulos).
    return errorRpc(response, detalle, request, 'No se pudo completar la purga')
  }

  const resultado = await response.json()
  registrarAuditoria(env, { ...svcHeaders(env), Prefer: 'return=minimal' }, {
    usuarioId: context.operador.id,
    usuarioNombre: context.operador.nombre,
    usuarioRol: context.operador.rol,
    cuentaId: context.operador.cuenta_id,
    categoria: 'MANTENIMIENTO',
    accion: 'PURGA_REGISTROS',
    descripcion: `Purga de registros (${validacion.modulos.join(' + ')}${etiquetaRango(rango.desde, rango.hasta)}): ${resultado.total_eliminadas} filas`,
    entidadTipo: 'purga_backups',
    entidadId: resultado.backup_id || null,
    meta: { modulos: validacion.modulos, por_tabla: resultado.por_tabla, desde: rango.desde, hasta: rango.hasta },
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
    `${env.SUPABASE_URL}/rest/v1/purga_backups?id=eq.${encodeURIComponent(id)}&cuenta_id=eq.${encodeURIComponent(context.operador.cuenta_id)}&select=id,modulos,desde,hasta,total_filas,creado_en,payload&limit=1`,
    { headers: svcHeaders(env) },
  )
  if (!response.ok) return jsonError('No se pudo leer el respaldo', 502, request)
  const [respaldo] = await response.json()
  if (!respaldo) return jsonError('Respaldo no encontrado', 404, request)
  return json({ ok: true, respaldo }, 200, request)
}
