import fs from 'node:fs'
import { pbkdf2 as pbkdf2Callback, randomBytes, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'

const pbkdf2 = promisify(pbkdf2Callback)
const REF = 'wishglzpmcshyvlgpjxj'
const URL = `https://${REF}.supabase.co`

function readEnv(path) {
  const values = {}
  if (!fs.existsSync(path)) return values
  for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index > 0) values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return values
}

async function management(token, endpoint, init = {}) {
  return fetch(`https://api.supabase.com/v1/projects/${REF}${endpoint}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
}

async function query(token, sql, readOnly = false) {
  return management(token, '/database/query', {
    method: 'POST', body: JSON.stringify({ query: sql, read_only: readOnly }),
  })
}

async function readRows(token, sql) {
  const response = await query(token, sql, true)
  if (!response.ok) throw new Error(`No se pudo consultar el preflight staging (${response.status}).`)
  return response.json()
}

async function main() {
  const local = readEnv('.env')
  const token = local.SUPABASE_ACCESS_TOKEN
  if (!token) throw new Error('Falta .env con SUPABASE_ACCESS_TOKEN.')

  const [projectResponse, projectsResponse, keyResponse, migrationResponse] = await Promise.all([
    management(token, ''),
    fetch('https://api.supabase.com/v1/projects', { headers: { Authorization: `Bearer ${token}` } }),
    management(token, '/api-keys'),
    management(token, '/database/migrations'),
  ])
  if (![projectResponse, projectsResponse, keyResponse, migrationResponse].every(response => response.ok)) {
    throw new Error('No se pudo verificar ref, organización, claves y migraciones de staging.')
  }
  const project = await projectResponse.json()
  const projects = await projectsResponse.json()
  const keys = await keyResponse.json()
  let migrations = await migrationResponse.json()
  if ((project.id || project.ref) !== REF || project.status !== 'ACTIVE_HEALTHY'
    || !projects.some(item => (item.id || item.ref) === 'wlxcclidnwketrghqaxs')) {
    throw new Error('El destino no es el proyecto staging aislado esperado.')
  }
  // Aplica al staging cualquier migración local pendiente (en orden) y exige
  // que el historial quede exactamente igual al inventario local.
  const localMigrations = fs.readdirSync('supabase/migrations').filter(f => /^\d+_.+\.sql$/.test(f)).sort()
  const appliedNames = new Set(migrations.map(m => m.name))
  for (const file of localMigrations) {
    const name = file.replace(/\.sql$/, '')
    if (appliedNames.has(name)) continue
    const applyResponse = await management(token, '/database/migrations', {
      method: 'POST',
      body: JSON.stringify({ name, query: fs.readFileSync(`supabase/migrations/${file}`, 'utf8') }),
    })
    if (!applyResponse.ok) throw new Error(`No se pudo aplicar la migración ${name} al staging (${applyResponse.status}).`)
    appliedNames.add(name)
    console.log(`Migración aplicada al staging: ${name}`)
  }
  const verifyResponse = await management(token, '/database/migrations')
  if (!verifyResponse.ok) throw new Error('No se pudo verificar el historial después de las migraciones de staging.')
  migrations = await verifyResponse.json()
  const lastName = localMigrations.at(-1).replace(/\.sql$/, '')
  if (migrations.length !== localMigrations.length || migrations.at(-1)?.name !== lastName) {
    throw new Error(`El esquema staging está incompleto o fuera de secuencia (${migrations.length}/${localMigrations.length} migraciones).`)
  }

  let secret = keys.find(key => key.name === 'nomina_staging_worker' && key.type === 'secret')?.api_key
  let publishable = keys.find(key => key.name === 'nomina_staging_web' && key.type === 'publishable')?.api_key
  if (!secret || !publishable) throw new Error('No encuentro las API keys nominativas recién creadas para staging.')

  // El API Management puede producir un secret key sin JWT compatible con el
  // endpoint /auth/v1/admin/users. Verificarlo; nunca respaldar service_role viejo.
  const authProbe = await fetch(`${URL}/auth/v1/admin/users`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
  })
  if (authProbe.status === 401) {
    const listResponse = await management(token, '/api-keys?reveal=true')
    if (!listResponse.ok) throw new Error(`No se pudo recuperar la secret key staging (${listResponse.status}).`)
    const revealed = await listResponse.json()
    secret = revealed.find(key => key.name === 'nomina_staging_worker' && key.type === 'secret')?.api_key
    if (!secret) throw new Error('Supabase no devolvió la secret key nominativa de staging.')
  } else if (!authProbe.ok) {
    throw new Error(`No se pudo verificar autorización de Auth staging (${authProbe.status}).`)
  }

  let authResponse = await fetch(`${URL}/auth/v1/admin/users`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
  })
  let legacySecretForAuth = false
  if (authResponse.status === 401) {
    const legacy = keys.find(key => key.name === 'service_role')?.api_key
    if (!legacy) throw new Error('No hay una clave compatible con Auth Admin en staging.')
    authResponse = await fetch(`${URL}/auth/v1/admin/users`, {
      headers: { apikey: legacy, Authorization: `Bearer ${legacy}` },
    })
    legacySecretForAuth = true
  }
  if (!authResponse.ok) throw new Error(`No se pudo listar Auth en staging (${authResponse.status}).`)
  const accounts = (await authResponse.json()).users || []
  if (accounts.length !== 1) throw new Error('Se esperaba exactamente una cuenta Auth sintética, no se creó ninguna adicional.')
  const account = accounts[0]

  const [operators, employees, periods, holidays, configs, schedules, attendance, lines] = await Promise.all([
    readRows(token, 'select id, cuenta_id, nombre, rol from public.usuarios'),
    readRows(token, 'select id, cuenta_id, nombre from public.clientes'),
    readRows(token, 'select id, cuenta_id, nombre, desde, hasta, estado from public.nomina_periodos'),
    readRows(token, 'select id, cuenta_id, nombre from public.nomina_feriados'),
    readRows(token, 'select empleado_id, cuenta_id from public.nomina_config_empleado'),
    readRows(token, 'select empleado_id, cuenta_id from public.nomina_horarios'),
    readRows(token, 'select id, cuenta_id, empleado_id, fecha, nota from public.registro_asistencia'),
    readRows(token, 'select id, cuenta_id, periodo_id, empleado_id, pagado from public.nomina_lineas'),
  ])
  if ([...operators, ...employees, ...periods, ...holidays, ...configs, ...schedules, ...attendance, ...lines]
    .some(row => row.cuenta_id !== account.id)) {
    throw new Error('Hay registros fuera del tenant sintético; aborté sin mutar datos.')
  }
  if (operators.some(row => row.nombre !== 'Operador QA Staging' || row.rol !== 'jefe')
    || employees.some(row => row.nombre !== 'Empleado Sintético Staging')
    || periods.some(row => row.nombre !== 'Período sintético staging')
    || holidays.some(row => row.nombre !== 'Feriado sintético staging')
    || operators.length > 1 || employees.length > 1 || periods.length > 1 || holidays.length > 1
    || configs.length > 1    || schedules.length > 7 || attendance.length > 7 || lines.length > 1) {
    throw new Error('Se detectaron datos no sintéticos o duplicados; aborté sin mutar datos.')
  }
  const fixturePeriod = periods[0]
  const fixtureEmployeeId = employees[0]?.id
  if (fixturePeriod && (fixturePeriod.desde !== '2026-09-21' || fixturePeriod.hasta !== '2026-09-27'
    || fixturePeriod.estado !== 'abierto')) {
    throw new Error('El período sintético no coincide con la semana abierta esperada; aborté sin mutar datos.')
  }
  if (attendance.some(row => row.empleado_id !== fixtureEmployeeId
    || row.fecha < '2026-09-21' || row.fecha > '2026-09-27'
    || !String(row.nota || '').startsWith('staging-deterministic-'))) {
    throw new Error('Hay asistencias fuera de la semana sintética esperada; aborté sin mutar datos.')
  }
  if (lines.some(row => row.empleado_id !== fixtureEmployeeId
    || row.periodo_id !== fixturePeriod?.id || row.pagado !== false)) {
    throw new Error('Hay líneas ajenas, pagadas o fuera del período de prueba; aborté sin mutar datos.')
  }

  const email = `staging-${randomBytes(8).toString('hex')}@example.invalid`
  const password = randomBytes(24).toString('base64url')
  const authKey = legacySecretForAuth ? keys.find(key => key.name === 'service_role').api_key : secret
  const accountUpdate = await fetch(`${URL}/auth/v1/admin/users/${account.id}`, {
    method: 'PUT',
    headers: { apikey: authKey, Authorization: `Bearer ${authKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { ...account.user_metadata, staging_only: true },
    }),
  })
  if (!accountUpdate.ok) throw new Error(`No se pudo rotar/etiquetar Auth staging (${accountUpdate.status}).`)

  const operatorId = operators[0]?.id || randomUUID()
  const employeeId = fixtureEmployeeId || randomUUID()
  const periodId = fixturePeriod?.id || randomUUID()
  const quote = value => `'${String(value).replaceAll("'", "''")}'`
  if (attendance.length || lines.length) {
    const cleanupSql = [
      `delete from public.registro_asistencia where cuenta_id=${quote(account.id)} and empleado_id=${quote(employeeId)} and fecha between '2026-09-21' and '2026-09-27'`,
      ...(fixturePeriod ? [`delete from public.nomina_lineas where cuenta_id=${quote(account.id)} and periodo_id=${quote(periodId)} and empleado_id=${quote(employeeId)} and pagado=false`] : []),
    ].join(';')
    const cleanup = await query(token, cleanupSql)
    if (!cleanup.ok) throw new Error(`No se pudo limpiar exclusivamente la semana sintética anterior (${cleanup.status}).`)
  }

  const salt = randomBytes(16).toString('hex')
  const pin = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0')
  const hash = (await pbkdf2(pin, Buffer.from(salt), 100_000, 32, 'sha256')).toString('hex')
  const statements = [
    `insert into public.usuarios(id,cuenta_id,nombre,rol,activo,pin_hash,pin_salt)
      values(${quote(operatorId)},${quote(account.id)},'Operador QA Staging','jefe',true,${quote(hash)},${quote(salt)})
      on conflict(id) do update set pin_hash=excluded.pin_hash,pin_salt=excluded.pin_salt`,
    `insert into public.clientes(id,cuenta_id,nombre,tipo_cliente,activo)
      values(${quote(employeeId)},${quote(account.id)},'Empleado Sintético Staging','personal',true)
      on conflict(id) do nothing`,
    `insert into public.nomina_config_empleado(empleado_id,cargo,fecha_ingreso,salario_dia_usd,horas_jornada,hora_inicio,hora_fin,activo,cuenta_id,controla_asistencia)
      values(${quote(employeeId)},'QA Staging','2026-01-05',40,8,'08:00','17:00',true,${quote(account.id)},true)
      on conflict(empleado_id) do update set activo=true,controla_asistencia=true`,
    `insert into public.nomina_horarios(empleado_id,dia_semana,fecha_desde,hora_inicio,hora_fin,horas_jornada,trabaja,cuenta_id,creado_por)
      select ${quote(employeeId)},d,'2000-01-01','08:00','17:00',8,d between 1 and 6,${quote(account.id)},${quote(operatorId)}
      from generate_series(0,6) d
      on conflict(empleado_id,dia_semana) where empleado_id is not null and semana_ciclo is null and fecha_hasta is null
      do update set trabaja=excluded.trabaja,fecha_desde=excluded.fecha_desde,hora_inicio=excluded.hora_inicio,hora_fin=excluded.hora_fin,horas_jornada=excluded.horas_jornada`,
  ]
  if (!periods.length) statements.push(`insert into public.nomina_periodos(id,nombre,desde,hasta,tipo,estado,cuenta_id)
    values(${quote(periodId)},'Período sintético staging','2026-09-21','2026-09-27','semanal','abierto',${quote(account.id)})`)
  if (!holidays.length) statements.push(`insert into public.nomina_feriados(fecha,nombre,tipo,laborable,cuenta_id,creado_por)
    values('2026-09-25','Feriado sintético staging','empresa',false,${quote(account.id)},${quote(operatorId)})`)
  const seed = await query(token, statements.join(';'), false)
  if (!seed.ok) throw new Error(`Falló la escritura de fixtures sintéticas (${seed.status}): ${(await seed.text()).slice(0, 500)}`)

  const json = value => JSON.stringify(value)
  fs.writeFileSync('.env.staging.local', [
    '# Staging-only; ignored by Git.',
    `VITE_SUPABASE_URL=${json(URL)}`,
    `VITE_SUPABASE_ANON_KEY=${json(publishable)}`,
    'VITE_WORKER_ORIGIN=',
    `STAGING_TEST_EMAIL=${json(email)}`,
    `STAGING_TEST_PASSWORD=${json(password)}`,
    `STAGING_TEST_PIN=${json(pin)}`,
    '',
  ].join('\n'), { mode: 0o600 })
  fs.writeFileSync('.dev.vars.staging', [
    '# Worker-only keys for isolated staging.',
    `SUPABASE_URL=${json(URL)}`,
    `SUPABASE_ANON_KEY=${json(publishable)}`,
    `SUPABASE_SERVICE_KEY=${json(secret)}`,
    'NOMINA_TIMEZONE=America/Caracas',
    'NOMINA_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173',
    '',
  ].join('\n'), { mode: 0o600 })
  console.log(`Staging verified: ${project.name}; ${migrations.length}/${localMigrations.length} migrations.`)
  console.log('Synthetic account, employee, schedule, holiday and open period are ready.')
  console.log('Test credentials exist only in ignored .env.staging.local; Worker key is in .dev.vars.staging.')
}

main().catch(error => {
  console.error(`Staging setup failed: ${error.message}`)
  process.exitCode = 1
})
