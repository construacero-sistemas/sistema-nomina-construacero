import { json, jsonError } from '../lib/utils.js'
import { verifyAuth, supaServiceHeaders } from '../lib/auth.js'

const PUBLIC_CONFIG_FIELDS = [
  'nombre_negocio',
  'rif_negocio',
  'logo_url',
  'telefono_negocio',
  'email_negocio',
  'nomina_factor_hora_extra',
  'nomina_factor_sabado',
  'nomina_factor_feriado',
  'nomina_tipo_periodo',
  'nomina_horas_extra_max_semana',
  'nomina_v2_enabled',
]

export async function handleGetConfig(request, env) {
  const user = await verifyAuth(request, env)
  if (!user?.id) return jsonError('No autenticado', 401, request)

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/configuracion_negocio?cuenta_id=eq.${user.id}` +
    '&select=nombre_negocio,rif_negocio,logo_url,telefono_negocio,email_negocio,' +
    'nomina_factor_hora_extra,nomina_factor_sabado,nomina_factor_feriado,' +
    'nomina_tipo_periodo,nomina_horas_extra_max_semana,nomina_v2_enabled&limit=1',
    { headers: supaServiceHeaders(env) },
  )
  if (!response.ok) return jsonError('Error al leer configuración', 500, request)

  const [config = {}] = await response.json()
  // Segunda barrera ante cambios de esquema: solo salen campos explícitamente
  // aprobados, aunque el upstream agregue columnas sensibles en el futuro.
  const safeConfig = Object.fromEntries(
    PUBLIC_CONFIG_FIELDS
      .filter(field => Object.prototype.hasOwnProperty.call(config, field))
      .map(field => [field, config[field]]),
  )
  return json(safeConfig, 200, request)
}

export function handlePing(request) {
  return json({ ok: true, service: 'nomina-construacero' }, 200, request)
}
