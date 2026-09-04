import { json, jsonError } from '../lib/utils.js'
import { verifyAuth, supaServiceHeaders } from '../lib/auth.js'
import { clearEgressCache } from '../lib/egressCache.js'

const PUBLIC_CONFIG_FIELDS = [
  'nombre_negocio',
  'rif_negocio',
  'logo_url',
  'telefono_negocio',
  'email_negocio',
  'nomina_factor_hora_extra',
  'nomina_factor_sabado',
  'nomina_factor_feriado',
  'nomina_monto_hora_extra_usd',
  'nomina_monto_sabado_usd',
  'nomina_monto_feriado_usd',
  'nomina_feriado_modo',
  'nomina_tipo_periodo',
  'nomina_horas_extra_max_semana',
  'nomina_v2_enabled',
  'nomina_hora_inicio',
  'nomina_hora_fin',
  'nomina_horas_jornada',
  'nomina_horas_descanso',
]

export async function handleGetConfig(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.id) return jsonError('No autenticado', 401, request)

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${user.id}&select=*&limit=1`,
    { headers: supaServiceHeaders(env) },
  )
  if (!response.ok) return jsonError('Error al leer configuración', 500, request)

  let [config = null] = await response.json()
  if (!config) {
    // Si la fila aún no existe para esta cuenta, inicializarla por defecto
    const initRes = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio`, {
      method: 'POST',
      headers: { ...supaServiceHeaders(env), Prefer: 'return=representation' },
      body: JSON.stringify({ cuenta_id: user.id }),
    })
    if (initRes.ok) {
      const created = await initRes.json().catch(() => [])
      config = created[0] || {}
    } else {
      config = {}
    }
  }

  const safeConfig = Object.fromEntries(
    PUBLIC_CONFIG_FIELDS
      .filter(field => Object.prototype.hasOwnProperty.call(config, field))
      .map(field => [field, config[field]]),
  )
  return json(safeConfig, 200, request)
}

export async function handleUpdateConfig(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.id) return jsonError('No autenticado', 401, request)
  let body
  try { body = await request.json() } catch { return jsonError('Body inválido', 400, request) }
  const fields = {}

  for (const field of ['nomina_factor_hora_extra', 'nomina_factor_sabado', 'nomina_factor_feriado']) {
    if (body?.[field] !== undefined) {
      const value = Number(body[field])
      if (!Number.isFinite(value) || value < 1 || value > 10) return jsonError(`${field} inválido`, 400, request)
      fields[field] = value
    }
  }

  // Montos fijos USD: opcionales; null/vacío limpia el monto y activa el respaldo por factor.
  const MAX_MONTO = 1_000_000
  for (const field of ['nomina_monto_hora_extra_usd', 'nomina_monto_sabado_usd', 'nomina_monto_feriado_usd']) {
    if (body?.[field] === undefined) continue
    if (body[field] === null || body[field] === '') {
      fields[field] = null
      continue
    }
    const value = Number(body[field])
    if (!Number.isFinite(value) || value <= 0 || value > MAX_MONTO) return jsonError(`${field} inválido`, 400, request)
    fields[field] = value
  }

  if (body?.nomina_feriado_modo !== undefined) {
    if (!['factor', 'monto_fijo'].includes(body.nomina_feriado_modo)) {
      return jsonError('nomina_feriado_modo inválido', 400, request)
    }
    fields.nomina_feriado_modo = body.nomina_feriado_modo
  }

  if (body?.nomina_tipo_periodo !== undefined) {
    if (!['semanal', 'quincenal', 'mensual'].includes(body.nomina_tipo_periodo)) {
      return jsonError('nomina_tipo_periodo inválido', 400, request)
    }
    fields.nomina_tipo_periodo = body.nomina_tipo_periodo
  }

  if (body?.nomina_horas_extra_max_semana !== undefined) {
    const value = Number(body.nomina_horas_extra_max_semana)
    if (!Number.isFinite(value) || value < 0) return jsonError('nomina_horas_extra_max_semana inválido', 400, request)
    fields.nomina_horas_extra_max_semana = value
  }

  const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/

  if (body?.nomina_hora_inicio !== undefined) {
    const raw = String(body.nomina_hora_inicio || '').trim()
    if (!TIME_REGEX.test(raw)) {
      return jsonError('nomina_hora_inicio inválida (formato HH:mm esperado)', 400, request)
    }
    fields.nomina_hora_inicio = raw.slice(0, 5)
  }

  if (body?.nomina_hora_fin !== undefined) {
    const raw = String(body.nomina_hora_fin || '').trim()
    if (!TIME_REGEX.test(raw)) {
      return jsonError('nomina_hora_fin inválida (formato HH:mm esperado)', 400, request)
    }
    fields.nomina_hora_fin = raw.slice(0, 5)
  }

  if (body?.nomina_horas_jornada !== undefined) {
    const value = Number(body.nomina_horas_jornada)
    if (!Number.isFinite(value) || value <= 0 || value > 24) {
      return jsonError('nomina_horas_jornada inválida (debe estar entre 1 y 24 horas)', 400, request)
    }
    fields.nomina_horas_jornada = Math.round(value * 100) / 100
  }

  if (body?.nomina_horas_descanso !== undefined) {
    const value = Number(body.nomina_horas_descanso)
    if (!Number.isFinite(value) || value < 0 || value > 12) {
      return jsonError('nomina_horas_descanso inválida (debe estar entre 0 y 12 horas)', 400, request)
    }
    fields.nomina_horas_descanso = Math.round(value * 100) / 100
  }

  for (const strField of ['nombre_negocio', 'rif_negocio', 'logo_url', 'telefono_negocio', 'email_negocio']) {
    if (body?.[strField] !== undefined) {
      fields[strField] = body[strField] ? String(body[strField]).trim() : null
    }
  }

  if (body?.nomina_v2_enabled !== undefined) {
    fields.nomina_v2_enabled = Boolean(body.nomina_v2_enabled)
  }

  if (!Object.keys(fields).length) return jsonError('No hay cambios válidos para actualizar', 400, request)

  let fieldsToSave = { ...fields }
  let config = null
  const MAX_RETRIES = 6

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (!Object.keys(fieldsToSave).length) break

    // 1. Intentar PATCH sobre fila existente
    const patchRes = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${user.id}`, {
      method: 'PATCH',
      headers: { ...supaServiceHeaders(env), Prefer: 'return=representation' },
      body: JSON.stringify({ ...fieldsToSave, actualizado_en: new Date().toISOString() }),
    })

    if (patchRes.ok) {
      const updated = await patchRes.json().catch(() => [])
      if (updated.length > 0) {
        config = updated[0]
        break
      }

      // Si 0 filas actualizadas (aún no existía registro para esta cuenta), insertar
      const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/configuracion_negocio`, {
        method: 'POST',
        headers: { ...supaServiceHeaders(env), Prefer: 'return=representation' },
        body: JSON.stringify({ cuenta_id: user.id, ...fieldsToSave }),
      })

      if (insertRes.ok) {
        const inserted = await insertRes.json().catch(() => [])
        config = inserted[0] || {}
        break
      }

      // Si el INSERT falla porque falta alguna columna opcional en el esquema remoto
      const insertErr = await insertRes.json().catch(() => ({}))
      const missingColMatch = String(insertErr?.message || '').match(/Could not find the '([^']+)' column/i)
      if (missingColMatch && missingColMatch[1] && fieldsToSave[missingColMatch[1]] !== undefined) {
        delete fieldsToSave[missingColMatch[1]]
        continue
      }
      return jsonError(`Error al guardar configuración: ${insertErr?.message || insertRes.statusText}`, 500, request)
    }

    // Si el PATCH falla porque la base de datos remota no tiene la columna (PGRST204)
    const patchErr = await patchRes.json().catch(() => ({}))
    const missingColMatch = String(patchErr?.message || '').match(/Could not find the '([^']+)' column/i)
    if (missingColMatch && missingColMatch[1] && fieldsToSave[missingColMatch[1]] !== undefined) {
      delete fieldsToSave[missingColMatch[1]]
      continue
    }

    return jsonError(`Error al guardar configuración: ${patchErr?.message || patchRes.statusText}`, 500, request)
  }

  // Limpiar caché de egress para que las lecturas subsiguientes no reciban datos obsoletos
  clearEgressCache()

  return json(Object.fromEntries(Object.keys(fields).map(field => [field, config?.[field] ?? fields[field]])), 200, request)
}

export function handlePing(request) {
  return json({ ok: true, service: 'nomina-construacero' }, 200, request)
}
