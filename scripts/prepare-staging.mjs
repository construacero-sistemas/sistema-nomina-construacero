import fs from 'node:fs'
import path from 'node:path'
import { pbkdf2 as pbkdf2Callback, randomBytes, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

const pbkdf2 = promisify(pbkdf2Callback)
const STAGING_REF = 'wishglzpmcshyvlgpjxj'
const PRODUCTION_REF = 'wlxcclidnwketrghqaxs'
const STAGING_URL = `https://${STAGING_REF}.supabase.co`

function readEnv(file) {
  const values = {}
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index < 0) continue
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return values
}

async function runSql(token, query, readOnly = false) {
  return fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: readOnly }),
  })
}

async function readRows(token, query) {
  const response = await runSql(token, query, true)
  if (!response.ok) throw new Error(`Falló consulta de preparación (${response.status}).`)
  return response.json()
}

async function main() {
  if (!fs.existsSync('.env')) throw new Error('Falta .env con SUPABASE_ACCESS_TOKEN.')
  const token = readEnv('.env').SUPABASE_ACCESS_TOKEN
  if (!token) throw new Error('Falta SUPABASE_ACCESS_TOKEN en .env.')

  const [projectResponse, projectsResponse, keysResponse, historyResponse] = await Promise.all([
    fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch('https://api.supabase.com/v1/projects', { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/api-keys`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/database/migrations`, { headers: { Authorization: `Bearer ${token}` } }),
  ])
  if (![projectResponse, projectsResponse, keysResponse, historyResponse].every(response => response.ok)) {
    throw new Error(`No se pudo verificar staging (HTTP ${projectResponse.status}/${projectsResponse.status}/${keysResponse.status}/${historyResponse.status}).`)
  }
  const project = await projectResponse.json()
  const projects = await projectsResponse.json()
  const keys = await keysResponse.json()
  const history = await historyResponse.json()
  if ((project.id || project.ref) !== STAGING_REF || project.status !== 'ACTIVE_HEALTHY') {
    throw new Error('El ref o estado del proyecto no coincide con el staging aislado esperado.')
  }
  if (!projects.some(item => (item.id || item.ref) === PRODUCTION_REF)) {
    throw new Error('No se pudo verificar la separación con el proyecto operativo.')
  }
  const anonKey = keys.find(key => key.type === 'publishable')?.api_key
  const serviceKey = keys.find(key => key.type === 'secret')?.api_key
  if (!anonKey || !serviceKey) throw new Error('Faltan claves publishable/secret de staging.')

  const migrationDir = path.join('supabase', 'migrations')
  const migrations = fs.readdirSync(migrationDir).filter(file => /^\d+_.+\.sql$/.test(file)).sort()
  if (migrations.length !== 44 || migrations[0] !== '001_nomina_base_contract.sql' || migrations.at(-1) !== '250_mantenimiento_purga_registros.sql') {
    throw new Error(`Inventario inesperado de migraciones (${migrations.length}); cancelado.`)
  }
  const migrationNames = new Set(migrations.map(file => file.replace(/\.sql$/, '')))
  const applied = new Set(history.map(migration => migration.name))
  if (applied.size !== history.length || [...applied].some(name => !migrationNames.has(name))) {
    throw new Error('El historial staging contiene versiones duplicadas/desconocidas; no se reparará automáticamente.')
  }
  for (const file of migrations) {
    const name = file.replace(/\.sql$/, '')
    if (applied.has(name)) continue
    if (applied.size && !applied.has('001_nomina_base_contract')) throw new Error('No se puede reanudar: falta la migración base.')
    const response = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/database/migrations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, query: fs.readFileSync(path.join(migrationDir, file), 'utf8') }),
    })
    if (!response.ok) throw new Error(`Falló ${name} (${response.status}): ${(await response.text()).replace(/\s+/g, ' ').slice(0, 600)}`)
    applied.add(name)
  }

  const usersResponse = await fetch(`${STAGING_URL}/auth/v1/admin/users`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
  if (!usersResponse.ok) throw new Error(`No se pudo inventariar Auth staging (${usersResponse.status}).`)
  const users = (await usersResponse.json()).users || []
  if (users.length !== 1 || users.some(user => user.user_metadata?.staging_only !== true)) {
    throw new Error('Staging debe contener solo la cuenta sintética ya creada; no se crea ni se altera otra cuenta.')
  }
  const account = users[0]

  const [operators, allEmployees, allPeriods, allHolidays] = await Promise.all([
    readRows(token, 'select id, cuenta_id, nombre, rol, activo from public.usuarios'),
    readRows(token, 'select id, cuenta_id, nombre from public.clientes'),
    readRows(token, 'select id, cuenta_id, nombre from public.nomina_periodos'),
    readRows(token, 'select id, cuenta_id, nombre from public.nomina_feriados'),
  ])
  for (const row of [...operators, ...allEmployees, ...allPeriods, ...allHolidays]) {
    if (row.cuenta_id !== account.id) throw new Error('Hay registros fuera del tenant sintético; no se cambia ningún dato.')
  }
  const employees = allEmployees.filter(row => row.nombre === 'Empleado Sintético Staging')
  const periods = allPeriods.filter(row => row.nombre === 'Período sintético staging')
  const holidays = allHolidays.filter(row => row.nombre === 'Feriado sintético staging')
  if (operators.some(row => row.nombre !== 'Operador QA Staging' || row.rol !== 'jefe')
    || allEmployees.some(row => row.nombre !== 'Empleado Sintético Staging')
    || allPeriods.some(row => row.nombre !== 'Período sintético staging')
    || allHolidays.some(row => row.nombre !== 'Feriado sintético staging')
    || operators.length > 1 || employees.length > 1 || periods.length > 1 || holidays.length > 1) {
    throw new Error('Se encontraron filas no sintéticas o duplicadas; no se modificó el tenant.')
  }

  const accountEmail = `staging-${randomBytes(8).toString('hex')}@example.invalid`
  const accountPassword = randomBytes(24).toString('base64url')
  const rotate = await fetch(`${STAGING_URL}/auth/v1/admin/users/${account.id}`, {
    method: 'PUT',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: accountEmail, password: accountPassword, email_confirm: true, user_metadata: { ...account.user_metadata, staging_only: true } }),
  })
  if (!rotate.ok) throw new Error(`No se pudo rotar la contraseña del usuario sintético (${rotate.status}).`)

  const operatorId = operators[0]?.id || randomUUID()
  const employeeId = employees[0]?.id || randomUUID()
  const periodId = periods[0]?.id || randomUUID()
  const salt = randomBytes(16).toString('hex')
  const pin = randomBytes(3).readUIntBE(0, 3).toString().padStart(6, '0')
  const pinHash = (await pbkdf2(pin, Buffer.from(salt), 100_000, 32, 'sha256')).toString('hex')
  const statements = [
    `insert into public.usuarios(id, cuenta_id, nombre, rol, activo, pin_hash, pin_salt)
      values('${operatorId}', '${account.id}', 'Operador QA Staging', 'jefe', true, '${pinHash}', '${salt}')
      on conflict (id) do update set pin_hash = excluded.pin_hash, pin_salt = excluded.pin_salt`,
    `insert into public.clientes(id, cuenta_id, nombre, tipo_cliente, activo)
      values('${employeeId}', '${account.id}', 'Empleado Sintético Staging', 'personal', true)
      on conflict (id) do nothing`,
    `insert into public.nomina_config_empleado(empleado_id, cargo, fecha_ingreso, salario_dia_usd, horas_jornada, hora_inicio, hora_fin, activo, cuenta_id, controla_asistencia)
      values('${employeeId}', 'QA Staging', '2026-01-05', 40, 8, '08:00', '17:00', true, '${account.id}', true)
      on conflict (empleado_id) do update set activo = true, controla_asistencia = true`,
    `insert into public.nomina_horarios(empleado_id, dia_semana, fecha_desde, hora_inicio, hora_fin, horas_jornada, trabaja, cuenta_id, creado_por)
      select '${employeeId}', d, '2000-01-01', '08:00', '17:00', 8, d between 1 and 6, '${account.id}', '${operatorId}'
      from generate_series(0, 6) d
      on conflict (empleado_id, dia_semana) where empleado_id is not null and semana_ciclo is null and fecha_hasta is null
      do update set trabaja = excluded.trabaja, fecha_desde = excluded.fecha_desde,
        hora_inicio = excluded.hora_inicio, hora_fin = excluded.hora_fin, horas_jornada = excluded.horas_jornada`,
    `insert into public.nomina_periodos(id, nombre, desde, hasta, tipo, estado, cuenta_id)
      values('${periodId}', 'Período sintético staging', '2026-09-21', '2026-09-27', 'semanal', 'abierto', '${account.id}')
      on conflict (id) do nothing`,
    ...(holidays.length ? [] : [`insert into public.nomina_feriados(fecha, nombre, tipo, laborable, cuenta_id, creado_por)
      values('2026-09-25', 'Feriado sintético staging', 'empresa', false, '${account.id}', '${operatorId}')`]),
  ]
  const seed = await runSql(token, statements.join(';'), false)
  if (!seed.ok) throw new Error(`Falló la carga sintética (${seed.status}): ${(await seed.text()).replace(/\s+/g, ' ').slice(0, 600)}`)
  const [createdOperator] = await readRows(token, `select id from public.usuarios where id = '${operatorId}' and cuenta_id = '${account.id}'`)
  if (!createdOperator) throw new Error('No se pudo verificar el operador sintético después del seed.')

  const json = value => JSON.stringify(value)
  fs.writeFileSync('.env.staging.local', [
    '# Staging only; ignored by Git. Do not copy to production .env.',
    `VITE_SUPABASE_URL=${json(STAGING_URL)}`,
    `VITE_SUPABASE_ANON_KEY=${json(anonKey)}`,
    'VITE_WORKER_ORIGIN=',
    `STAGING_TEST_EMAIL=${json(accountEmail)}`,
    `STAGING_TEST_PASSWORD=${json(accountPassword)}`,
    `STAGING_TEST_PIN=${json(pin)}`,
    '',
  ].join('\n'), { mode: 0o600 })
  fs.writeFileSync('.dev.vars.staging', [
    '# Worker-only keys for isolated staging.',
    `SUPABASE_URL=${json(STAGING_URL)}`,
    `SUPABASE_ANON_KEY=${json(anonKey)}`,
    `SUPABASE_SERVICE_KEY=${json(serviceKey)}`,
    'NOMINA_TIMEZONE=America/Caracas',
    'NOMINA_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173',
    '',
  ].join('\n'), { mode: 0o600 })

  console.log(`Proyecto aislado: ${project.name} (${STAGING_REF}).`)
  console.log(`Migraciones aplicadas: ${applied.size}/${migrations.length}.`)
  console.log('Cuenta sintética y fixtures listos; credenciales solamente en .env.staging.local.')
  console.log('Fixtures: empleado 40 USD/día; trabaja lunes-sábado; domingo libre; feriado no laborable; período abierto.')
}

main().catch(error => {
  console.error(`Staging no preparado: ${error.message}`)
  process.exitCode = 1
})
