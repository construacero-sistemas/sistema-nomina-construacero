// Motor PostgreSQL real embebido; fixtures locales, sin red ni credenciales.
// No sustituye concurrencia multi-conexión, grants desplegados o RLS de staging.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import {
  CAPACIDADES, ROLES_VALIDOS, ROLES_OPERATIVOS, tieneCapacidad, tieneAccesoOperativo,
  rolesConCapacidad,
} from '../server/lib/permissions.js'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const root = fileURLToPath(new URL('..', import.meta.url))
const db = new PGlite({ extensions: { pgcrypto } })
const result = { engine: 'PGlite PostgreSQL embebido', scope: 'SQL/transacciones/grants locales; no concurrencia multi-conexión ni producción', migrations: [], checks: [], passed: false }
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
async function check(name, run) {
  try { await run(); result.checks.push({ name, passed: true }); console.log(`[PASS] ${name}`) }
  catch (error) { result.checks.push({ name, passed: false, error: error.message }); throw error }
}
async function rejects(code, run) { await assert.rejects(run, e => e.code === code) }
const historical = {
  tenant: randomUUID(), actor: randomUUID(),
  entries: [
    { id: randomUUID(), wallet: randomUUID(), currency: 'VES', type: 'banco_ves', amount: 80481, rate: 1, backfilledRate: 804.81 },
    { id: randomUUID(), wallet: randomUUID(), currency: 'USDT', type: 'cripto_usdt', amount: 100, rate: 440, backfilledRate: 1 },
    { id: randomUUID(), wallet: randomUUID(), currency: 'USD', type: 'efectivo_usd', amount: 100, rate: 400, backfilledRate: 1 },
  ],
}
async function createWallet(account, currency) {
  const wallet = randomUUID()
  const type = { USD: 'efectivo_usd', VES: 'banco_ves', USDT: 'cripto_usdt' }[currency]
  await db.query('INSERT INTO cuentas_custodia(id,cuenta_id,nombre,tipo,cartera,moneda,subcuenta_id) VALUES($1,$2,$3,$4,$5,$6,$3)',
    [wallet, account, `QA ${wallet}`, type, currency === 'VES' ? 'VES' : 'USD', currency])
  return wallet
}
async function seedPre232History() {
  await db.query('INSERT INTO auth.users(id) VALUES($1)', [historical.tenant])
  await db.query("INSERT INTO usuarios(id,cuenta_id,nombre,rol) VALUES($1,$2,'Historical QA','administracion')", [historical.actor, historical.tenant])
  for (const entry of historical.entries) {
    await db.query('INSERT INTO cuentas_custodia(id,cuenta_id,nombre,tipo,cartera,moneda,subcuenta_id) VALUES($1,$2,$3,$4,$5,$6,$3)',
      [entry.wallet, historical.tenant, `Historical ${entry.currency}`, entry.type, entry.currency === 'VES' ? 'VES' : 'USD', entry.currency])
    await db.query(`INSERT INTO finanzas_movimientos(id,cuenta_id,fecha,tipo,categoria,concepto,monto,moneda,tasa_ves,tasa_usd_ves,fuente_tasa,idempotency_key)
      VALUES($1,$2,'2026-09-12','ingreso',$3,'Historical rate fixture',$4,$5,$6,NULL,'BCV',$7)`,
      [entry.id, historical.tenant, `QA legacy ${entry.currency}`, entry.amount, entry.currency, entry.rate, randomUUID()])
  }
}
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb DEFAULT '{}'::jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    CREATE PUBLICATION supabase_realtime;`)
  for (const name of (await readdir(`${root}/supabase/migrations`)).filter(n => n.endsWith('.sql')).sort()) {
    if (name === '232_finanzas_resumen_multimoneda.sql') await seedPre232History()
    await db.exec(await readFile(`${root}/supabase/migrations/${name}`, 'utf8'))
    result.migrations.push(name)
  }
  const tenant = randomUUID(), other = randomUUID(), actor = randomUUID(), otherActor = randomUUID()
  await db.query('INSERT INTO auth.users(id) VALUES($1),($2)', [tenant, other])
  await db.query("INSERT INTO usuarios(id,cuenta_id,nombre,rol) VALUES($1,$2,'QA A','jefe'),($3,$4,'QA B','jefe')", [actor, tenant, otherActor, other])
  const usd = randomUUID(), ves = randomUUID(), second = randomUUID(), usdt = randomUUID(), outside = randomUUID()
  for (const [id, account, moneda, tipo] of [[usd, tenant, 'USD', 'efectivo_usd'], [ves, tenant, 'VES', 'banco_ves'], [second, tenant, 'USD', 'zelle'], [usdt, tenant, 'USDT', 'cripto_usdt'], [outside, other, 'USD', 'efectivo_usd']]) {
    await db.query('INSERT INTO cuentas_custodia(id,cuenta_id,nombre,tipo,cartera,moneda,subcuenta_id) VALUES($1,$2,$3,$4,$5,$6,$3)', [id, account, `Cuenta ${id}`, tipo, moneda === 'VES' ? 'VES' : 'USD', moneda])
  }
  const period = randomUUID(), lines = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  await db.query("INSERT INTO nomina_periodos(id,cuenta_id,nombre,desde,hasta) VALUES($1,$2,'Período QA','2026-09-01','2026-09-07')", [period, tenant])
  for (let index = 0; index < lines.length; index++) {
    const employee = randomUUID(), amount = [100, 100, 50, 0][index]
    await db.query('INSERT INTO clientes(id,cuenta_id,nombre) VALUES($1,$2,$3)', [employee, tenant, `Empleado ${index}`])
    await db.query('INSERT INTO nomina_lineas(id,cuenta_id,periodo_id,empleado_id,total_bruto_usd,total_neto_usd) VALUES($1,$2,$3,$4,$5,$5)', [lines[index], tenant, period, employee, amount])
  }
  const rpc = async (type, payload, key = randomUUID(), account = tenant, user = actor) => (await one('SELECT finanzas_operar($1,$2,$3,$4,$5::jsonb,NULL) AS value', [account, user, type, key, JSON.stringify(payload)])).value
  const pay = ids => ({ lineaIds: ids, cuentaCustodiaId: usd, metodoPago: 'Efectivo $', tasaBcv: '400', tasaUsdVes: '400', fuenteTasa: 'MANUAL', observacionTasa: 'Tasa de prueba aprobada', referencia: 'QA', zonaHoraria: 'America/Caracas' })
  const balance = async () => (await one('SELECT finanzas_saldos($1) AS value', [tenant])).value
  const ledgerCounts = async () => one('SELECT (SELECT count(*)::int FROM finanzas_operaciones) AS operations,(SELECT count(*)::int FROM finanzas_movimientos) AS movements,(SELECT count(*)::int FROM finanzas_nomina_asignaciones) AS assignments')
  await check('Todas las migraciones compilan desde una base vacía', async () => {
    assert.ok(result.migrations.includes('240_custodia_asignacion_segura.sql'))
    assert.ok(result.migrations.includes('248_nomina_comisiones_atomicas.sql'))
  })
  await check('Importación de comisiones POS es atómica, tenant-scoped y exige capacidad administrativa', async () => {
    const commissionPeriod = randomUUID()
    const employeeA = randomUUID(), employeeB = randomUUID()
    const lineA = randomUUID(), lineB = randomUUID()
    await db.query("INSERT INTO nomina_periodos(id,cuenta_id,nombre,desde,hasta,estado) VALUES($1,$2,'Commission QA','2099-09-01','2099-09-07','abierto')", [commissionPeriod, tenant])
    await db.query('INSERT INTO clientes(id,cuenta_id,nombre) VALUES($1,$2,$3),($4,$2,$5)', [employeeA, tenant, 'Commission A', employeeB, 'Commission B'])
    await db.query(`INSERT INTO nomina_lineas(id,cuenta_id,periodo_id,empleado_id,monto_normal_usd,bonos_usd,deducciones_usd,total_bruto_usd,total_neto_usd)
      VALUES($1,$2,$3,$4,120,10,20,130,110),($5,$2,$3,$6,50,0,5,50,45)`, [lineA, tenant, commissionPeriod, employeeA, lineB, employeeB])
    const applyCommissions = async (account, user, applications, periodId = commissionPeriod) => (await one(
      'SELECT public.nomina_aplicar_comisiones_pos($1,$2,$3,$4::jsonb,NULL) AS value',
      [account, user, periodId, JSON.stringify(applications)],
    )).value
    const before = await db.query('SELECT id,comisiones_pos_usd,total_bruto_usd,total_neto_usd FROM nomina_lineas WHERE id=ANY($1::uuid[]) ORDER BY id', [[lineA, lineB]])
    await rejects('PT403', () => applyCommissions(tenant, otherActor, [{ empleadoId: employeeA, comisionesUsd: 10, despachosIds: ['d-1'] }]))
    await rejects('PT400', () => applyCommissions(tenant, actor, [
      { empleadoId: employeeA, comisionesUsd: 10, despachosIds: ['d-1'] },
      { empleadoId: employeeA, comisionesUsd: 20, despachosIds: ['d-2'] },
    ]))
    await rejects('PT404', () => applyCommissions(tenant, actor, [
      { empleadoId: employeeA, comisionesUsd: 10, despachosIds: ['d-1'] },
      { empleadoId: randomUUID(), comisionesUsd: 20, despachosIds: ['d-2'] },
    ]))
    assert.deepEqual((await db.query('SELECT id,comisiones_pos_usd,total_bruto_usd,total_neto_usd FROM nomina_lineas WHERE id=ANY($1::uuid[]) ORDER BY id', [[lineA, lineB]])).rows, before.rows)
    const applied = await applyCommissions(tenant, actor, [
      { empleadoId: employeeA, comisionesUsd: 85.5, despachosIds: ['d-1','d-2'] },
      { empleadoId: employeeB, comisionesUsd: 15, despachosIds: ['d-3'] },
    ])
    assert.equal(applied.ok, true); assert.equal(applied.actualizados, 2); assert.equal(Number(applied.total_comisiones_usd), 100.5)
    const updated = await db.query('SELECT empleado_id,comisiones_pos_usd,total_bruto_usd,total_neto_usd,comisiones_despachos_ids FROM nomina_lineas WHERE id=ANY($1::uuid[])', [[lineA, lineB]])
    assert.deepEqual(updated.rows.map(row => [Number(row.comisiones_pos_usd), Number(row.total_bruto_usd), Number(row.total_neto_usd)]).sort((a,b) => a[0]-b[0]), [[15,65,60],[85.5,215.5,195.5]])
    await db.query("UPDATE nomina_periodos SET estado='cerrado' WHERE id=$1", [commissionPeriod])
    await rejects('PT409', () => applyCommissions(tenant, actor, [
      { empleadoId: employeeA, comisionesUsd: 90, despachosIds: ['d-4'] },
      { empleadoId: employeeB, comisionesUsd: 30, despachosIds: ['d-5'] },
    ]))
    assert.equal(Number((await one('SELECT comisiones_pos_usd FROM nomina_lineas WHERE id=$1', [lineA])).comisiones_pos_usd), 85.5)
    assert.equal((await one("SELECT count(*)::int AS n FROM auditoria WHERE cuenta_id=$1 AND accion='APLICAR_COMISIONES_POS' AND entidad_id=$2", [tenant, commissionPeriod])).n, 1)
  })
  await check('RPCs privados: anon y authenticated sin EXECUTE; service autorizado', async () => {
    for (const signature of ['finanzas_resumen(uuid,date,date,text,text,text)', 'finanzas_operar(uuid,uuid,text,text,jsonb,text)', 'finanzas_saldos(uuid)', 'finanzas_operacion_estado(uuid,text,text)', 'finanzas_asignar_custodia(uuid,uuid,uuid[],uuid,text)', 'finanzas_movimientos_pagina(uuid,date,date,text,text,text,text,boolean,integer,integer,text)', 'finanzas_resumen_consistente(uuid,date,date,text,text,text,text)']) {
      const privileges = await one('SELECT has_function_privilege(\'anon\',$1,\'EXECUTE\') AS anon, has_function_privilege(\'authenticated\',$1,\'EXECUTE\') AS authenticated, has_function_privilege(\'service_role\',$1,\'EXECUTE\') AS service', [signature])
      assert.deepEqual(privileges, { anon: false, authenticated: false, service: true })
    }
  })
  await check('Pago con período abierto rechazado sin escrituras', async () => {
    const counts = await ledgerCounts(); await rejects('PT409', () => rpc('pagar_nomina', pay([lines[0]]))); assert.deepEqual(await ledgerCounts(), counts)
  })
  await db.query("UPDATE nomina_periodos SET estado='cerrado' WHERE id=$1", [period])
  await check('Tenant cruzado, recibo ajeno y tasa faltante rechazados', async () => {
    await rejects('PT403', () => rpc('pagar_nomina', pay([lines[0]]), randomUUID(), tenant, otherActor))
    await rejects('PT404', () => rpc('pagar_nomina', { ...pay([lines[0]]), cuentaCustodiaId: outside }))
    await rejects('PT404', () => rpc('pagar_nomina', pay([lines[0], randomUUID()])))
    await rejects('PT400', () => rpc('pagar_nomina', { ...pay([lines[0]]), tasaBcv: null }))
  })
  const firstKey = randomUUID()
  let paid
  await check('Lote de dos recibos: tasa/método/cuenta/asignaciones/asientos preservados', async () => {
    paid = await rpc('pagar_nomina', pay([lines[0], lines[1]]), firstKey)
    assert.equal(paid.estado, 'confirmada'); assert.equal(Number(paid.total_usd), 200)
    const entries = (await db.query('SELECT monto,moneda,tasa_ves,metodo_pago,cuenta_custodia_id FROM finanzas_movimientos WHERE operacion_id=$1', [paid.operationId])).rows
    assert.equal(entries.length, 2)
    assert.ok(entries.every(e => Number(e.monto) === 100 && Number(e.tasa_ves) === 400 && e.moneda === 'USD' && e.metodo_pago === 'Efectivo $' && e.cuenta_custodia_id === usd))
    assert.equal((await one('SELECT estado FROM nomina_periodos WHERE id=$1', [period])).estado, 'cerrado')
  })
  await check('Misma clave/cuerpo repite resultado, sin duplicar; distinto cuerpo da conflicto', async () => {
    const counts = await ledgerCounts()
    assert.deepEqual(await rpc('pagar_nomina', pay([lines[1], lines[0]]), firstKey), paid)
    assert.deepEqual(await ledgerCounts(), counts)
    await rejects('PT409', () => rpc('pagar_nomina', { ...pay([lines[0], lines[1]]), referencia: 'Otra' }, firstKey))
    await rejects('PT409', () => rpc('pagar_nomina', pay([lines[0]])))
  })
  await check('Reversión del segundo recibo: anula sólo USD100; repago el mismo día funciona', async () => {
    await rpc('revertir_nomina', { lineaId: lines[1], motivo: 'Duplicado comprobado' })
    const data = await one("SELECT sum(monto) FILTER(WHERE estado='activo') AS active, sum(monto) FILTER(WHERE estado='anulado') AS cancelled FROM finanzas_movimientos WHERE operacion_id=$1", [paid.operationId])
    assert.equal(Number(data.active), 100); assert.equal(Number(data.cancelled), 100)
    assert.equal((await one('SELECT pagado FROM nomina_lineas WHERE id=$1', [lines[0]])).pagado, true)
    const repaid = await rpc('pagar_nomina', pay([lines[1]]))
    assert.notEqual(repaid.operationId, paid.operationId)
  })
  await check('Reversión del primer recibo no toca el segundo repagado', async () => {
    await rpc('revertir_nomina', { lineaId: lines[0], motivo: 'Corrección autorizada' })
    assert.equal((await one('SELECT pagado FROM nomina_lineas WHERE id=$1', [lines[1]])).pagado, true)
    await rpc('pagar_nomina', pay([lines[0]]))
  })
  await check('Cero neto sin asiento inválido; período pasa a pagado al cerrar pendientes', async () => {
    const zero = await rpc('pagar_nomina', pay([lines[3]])); assert.equal(Number(zero.total_usd), 0); assert.equal(zero.movimientoIds.length, 0)
    await rpc('pagar_nomina', pay([lines[2]]))
    assert.equal((await one('SELECT estado FROM nomina_periodos WHERE id=$1', [period])).estado, 'pagado')
  })
  await check('Guards impiden modificar recibos pagados y asientos vinculados por ruta genérica', async () => {
    await rejects('PT409', () => db.query('UPDATE nomina_lineas SET total_neto_usd=1 WHERE id=$1', [lines[0]]))
    await rejects('PT409', () => db.query("UPDATE finanzas_movimientos SET estado='anulado',anulado_en=now(),anulado_por=$1,motivo_anulacion='Otra ruta' WHERE id=$2", [actor, paid.movimientoIds[0]]))
    await rejects('PT409', () => db.query("UPDATE nomina_periodos SET estado='abierto' WHERE id=$1", [period]))
  })
  const deposit = async (wallet, currency, amount, key = randomUUID()) => db.query(`INSERT INTO finanzas_movimientos(cuenta_id,fecha,tipo,categoria,concepto,monto,moneda,tasa_ves,tasa_usd_ves,fuente_tasa,idempotency_key,cuenta_custodia_id)
    VALUES($1,'2026-09-12','ingreso','Saldo inicial','Ingreso QA',$2,$3,$4,400,'BCV',$5,$6)`, [tenant, amount, currency, currency === 'VES' ? 1 : 400, key, wallet])
  await deposit(usd, 'USD', 10000)
  const transfer = { origenCuentaId: usd, destinoCuentaId: ves, montoOrigen: '10', tasaCambio: '400', tasaUsdVes: '400', fecha: '2026-09-12', referencia: 'QA', observaciones: 'Cambio aprobado' }
  await check('Traspaso único: exactamente dos asientos y balance nativo correcto', async () => {
    const before = await balance(); const op = await rpc('traspaso', transfer)
    const rows = (await db.query('SELECT tipo,moneda,monto FROM finanzas_movimientos WHERE operacion_id=$1', [op.operationId])).rows
    assert.equal(rows.length, 2); assert.equal(Number(rows.find(r => r.tipo === 'ingreso').monto), 4000)
    const after = await balance()
    assert.equal(Number(after.cuentas.find(c => c.cuentaCustodiaId === usd).saldoNativo), Number(before.cuentas.find(c => c.cuentaCustodiaId === usd).saldoNativo) - 10)
    assert.equal(Number(after.cuentas.find(c => c.cuentaCustodiaId === ves).saldoNativo), 4000)
  })
  await check('Fallo inyectado en crédito deja cero débitos y operaciones parciales', async () => {
    await db.exec(`CREATE FUNCTION qa_fail_transfer_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.categoria='Traspasos' AND NEW.tipo='ingreso' THEN RAISE EXCEPTION 'Fallo sintético'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER qa_failure BEFORE INSERT ON finanzas_movimientos FOR EACH ROW EXECUTE FUNCTION qa_fail_transfer_credit();`)
    const counts = await ledgerCounts(), key = randomUUID()
    await assert.rejects(() => rpc('traspaso', transfer, key), /Fallo sintético/)
    assert.deepEqual(await ledgerCounts(), counts)
    assert.equal((await one('SELECT count(*)::int AS n FROM finanzas_operacion_contexto')).n, 0)
    await db.exec('DROP TRIGGER qa_failure ON finanzas_movimientos; DROP FUNCTION qa_fail_transfer_credit();')
  })
  await check('Fondos insuficientes se rechazan; mismo traspaso no se duplica', async () => {
    await rejects('PT402', () => rpc('traspaso', { ...transfer, montoOrigen: '999999' }))
    const key = randomUUID(); const op = await rpc('traspaso', transfer, key); const counts = await ledgerCounts()
    assert.deepEqual(await rpc('traspaso', transfer, key), op); assert.deepEqual(await ledgerCounts(), counts)
    const status = (await one('SELECT finanzas_operacion_estado($1,$2,$3) AS value', [tenant, 'traspaso', key])).value
    assert.equal(status.estado, 'confirmada')
    assert.equal((await one('SELECT finanzas_operacion_estado($1,$2,$3) AS value', [other, 'traspaso', key])).value.estado, 'no_encontrada')
  })
  await check('Libro completo: más de75 filas y saldo no depende de páginas/filtros', async () => {
    for (let i = 0; i < 75; i++) await deposit(second, 'USD', 100)
    const full = await balance(); assert.equal(Number(full.cuentas.find(c => c.cuentaCustodiaId === second).saldoNativo), 7500)
    const args = [tenant, '2026-09-01', '2026-09-30', null, null, null, null, false, 50, 0, null]
    const query = 'SELECT finanzas_movimientos_pagina($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value'
    const page1 = (await one(query, args)).value
    assert.equal(page1.movimientos.length, 50); assert.ok(page1.paginacion.total > 75)
    args[9] = 50; args[10] = page1.versionLibro
    const page2 = (await one(query, args)).value
    const ids = new Set([...page1.movimientos, ...page2.movimientos].map(m => m.id))
    assert.equal(ids.size, page1.movimientos.length + page2.movimientos.length)
    await deposit(second, 'USD', 1)
    await rejects('PT409', () => one(query, args))
  })
  await check('Movimientos sin custodia quedan pendientes: no fondos ficticios ni escritura de conciliación', async () => {
    await deposit(null, 'USD', 12)
    const balances = await balance(); assert.equal(balances.conciliacionPendiente, true)
    assert.ok(balances.cuentas.every(c => !c.disponible)); assert.ok(balances.noAsignados.length > 0)
    await rejects('PT422', () => rpc('traspaso', transfer))
  })
  await check('Contexto protegido no se falsifica con GUC ni se concede acceso de tabla', async () => {
    assert.equal((await one("SELECT has_table_privilege('authenticated','finanzas_operacion_contexto','INSERT') AS allowed")).allowed, false)
    assert.equal((await one("SELECT has_table_privilege('service_role','finanzas_operacion_contexto','INSERT') AS allowed")).allowed, false)
    await db.query("SELECT set_config('app.operation_id',$1,false)", [paid.operationId])
    await rejects('PT409', () => db.query('UPDATE nomina_lineas SET total_neto_usd=1 WHERE id=$1', [lines[0]]))
  })
  const assign = async (ids, wallet = usd, account = tenant, user = actor) => (await one('SELECT finanzas_asignar_custodia($1,$2,$3::uuid[],$4,NULL) AS value', [account, user, ids, wallet])).value
  await check('Asignación 240: tenant, lote completo, moneda y reintento auditado', async () => {
    const unassigned = (await db.query('SELECT id,monto,tasa_ves,tasa_usd_ves FROM finanzas_movimientos WHERE cuenta_id=$1 AND cuenta_custodia_id IS NULL ORDER BY id', [tenant])).rows
    const ids = unassigned.map(row => row.id)
    assert.ok(ids.length > 0)
    await rejects('PT403', () => assign(ids, usd, tenant, otherActor))
    await rejects('PT404', () => assign(ids, outside))
    await rejects('PT404', () => assign([...ids, randomUUID()]))
    await rejects('PT409', () => assign(ids, ves))
    assert.equal((await one('SELECT count(*)::int AS n FROM finanzas_movimientos WHERE id=ANY($1::uuid[]) AND cuenta_custodia_id IS NOT NULL', [ids])).n, 0)
    const result = await assign(ids)
    assert.equal(result.actualizados, ids.length)
    assert.deepEqual((await db.query('SELECT id,monto,tasa_ves,tasa_usd_ves FROM finanzas_movimientos WHERE id=ANY($1::uuid[]) ORDER BY id', [ids])).rows, unassigned)
    const auditBefore = (await one("SELECT count(*)::int AS n FROM auditoria WHERE accion='CUSTODIA_ASIGNADA'")).n
    assert.equal((await assign(ids)).idempotente, true)
    assert.equal((await one("SELECT count(*)::int AS n FROM auditoria WHERE accion='CUSTODIA_ASIGNADA'")).n, auditBefore)
    assert.equal((await balance()).conciliacionPendiente, false)
  })
  await check('Custodia: renombrar conserva saldo; desactivar con fondos o mutar moneda se rechaza', async () => {
    const amount = (await balance()).cuentas.find(c => c.cuentaCustodiaId === usd).saldoNativo
    await db.query("UPDATE cuentas_custodia SET nombre='Caja renombrada QA' WHERE id=$1", [usd])
    assert.equal((await balance()).cuentas.find(c => c.cuentaCustodiaId === usd).saldoNativo, amount)
    await rejects('PT409', () => db.query('UPDATE cuentas_custodia SET activo=false WHERE id=$1', [usd]))
    await rejects('PT409', () => db.query("UPDATE cuentas_custodia SET moneda='VES' WHERE id=$1", [usd]))
    await db.query('UPDATE cuentas_custodia SET activo=false WHERE id=$1', [usdt])
    await rejects('PT400', () => deposit(usdt, 'USDT', 10))
    await db.query('UPDATE cuentas_custodia SET activo=true WHERE id=$1', [usdt])
  })
  await check('Un fallo en el asiento de nómina revierte recibo, asignación y auditoría juntos', async () => {
    await rpc('revertir_nomina', { lineaId: lines[2], motivo: 'Reintento QA' })
    await db.exec(`CREATE FUNCTION qa_fail_payroll_entry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.categoria='Nómina' THEN RAISE EXCEPTION 'Pago QA fallido'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER qa_payroll_failure BEFORE INSERT ON finanzas_movimientos FOR EACH ROW EXECUTE FUNCTION qa_fail_payroll_entry();`)
    const counts = await ledgerCounts(), audit = (await one('SELECT count(*)::int AS n FROM auditoria')).n
    await assert.rejects(() => rpc('pagar_nomina', pay([lines[2]])), /Pago QA fallido/)
    assert.deepEqual(await ledgerCounts(), counts)
    assert.equal((await one('SELECT pagado FROM nomina_lineas WHERE id=$1', [lines[2]])).pagado, false)
    assert.equal((await one('SELECT count(*)::int AS n FROM auditoria')).n, audit)
    await db.exec('DROP TRIGGER qa_payroll_failure ON finanzas_movimientos; DROP FUNCTION qa_fail_payroll_entry();')
    await rpc('pagar_nomina', pay([lines[2]]))
  })
  await check('USDT no paritario: todos los pares de divisas conservan tasas explícitas', async () => {
    await deposit(usdt, 'USDT', 200)
    await deposit(ves, 'VES', 10000)
    const wallets = [{ id: usd, moneda: 'USD', rate: 400 }, { id: ves, moneda: 'VES', rate: 1 }, { id: usdt, moneda: 'USDT', rate: 440 }]
    for (const source of wallets) for (const destination of wallets) {
      if (source.id === destination.id) continue
      const ratio = (source.rate / destination.rate).toFixed(8)
      const result = await rpc('traspaso', { ...transfer, origenCuentaId: source.id, destinoCuentaId: destination.id,
        montoOrigen: '10', tasaCambio: ratio, tasaUsdtVes: source.moneda === 'USDT' || destination.moneda === 'USDT' ? '440' : null })
      const entries = (await db.query('SELECT tipo,monto,moneda,tasa_ves,tasa_usd_ves FROM finanzas_movimientos WHERE operacion_id=$1', [result.operationId])).rows
      assert.equal(entries.length, 2)
      assert.equal(Number(entries.find(e => e.tipo === 'egreso').tasa_ves), source.rate)
      assert.equal(Number(entries.find(e => e.tipo === 'ingreso').tasa_ves), destination.rate)
      assert.ok(entries.every(e => Number(e.tasa_usd_ves) === 400))
    }
  })
  const historicalRows = async () => (await db.query(`SELECT id,monto,moneda,tasa_ves,tasa_usd_ves,tasa_registrada_en
    FROM finanzas_movimientos WHERE cuenta_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`,
    [historical.tenant, historical.entries.map(entry => entry.id)])).rows
  const summaryFor = async (account, currency, category) => one(
    "SELECT * FROM finanzas_resumen($1,'2026-09-01','2026-09-30',$2,NULL,$3)", [account, currency, category])
  const balancesFor = async account => (await one('SELECT finanzas_saldos($1) AS value', [account])).value

  await check('Historical 232 backfills remain numeric data, never rate provenance', async () => {
    const rows = await historicalRows()
    assert.equal(rows.length, historical.entries.length)
    for (const entry of historical.entries) {
      const row = rows.find(row => row.id === entry.id)
      assert.equal(Number(row.monto), entry.amount)
      assert.equal(Number(row.tasa_ves), entry.rate)
      assert.equal(Number(row.tasa_usd_ves), entry.backfilledRate)
      assert.equal(row.tasa_registrada_en, null)
      const summary = await summaryFor(historical.tenant, entry.currency, `QA legacy ${entry.currency}`)
      assert.equal(Number(summary.movimientos), 1)
      assert.equal(Number(summary.movimientos_sin_usd), entry.currency === 'USD' ? 0 : 1)
      if (entry.currency === 'USD') assert.equal(Number(summary.total_usd), entry.amount)
      else assert.equal(summary.total_usd, null)
    }
  })

  await check('Custody assignment and injected UPDATE timestamps cannot promote historical rates', async () => {
    const original = await historicalRows()
    for (const entry of historical.entries) {
      assert.equal((await assign([entry.id], entry.wallet, historical.tenant, historical.actor)).actualizados, 1)
      await db.query("UPDATE finanzas_movimientos SET tasa_registrada_en='2000-01-01T00:00:00Z',observaciones='Account classified, rates not reconciled' WHERE id=$1", [entry.id])
    }
    assert.deepEqual(await historicalRows(), original)
    const balances = await balancesFor(historical.tenant)
    assert.equal(balances.noAsignados.length, 0)
    for (const entry of historical.entries) {
      const wallet = balances.cuentas.find(wallet => wallet.cuentaCustodiaId === entry.wallet)
      assert.equal(Number(wallet.saldoNativo), entry.amount)
      assert.equal(wallet.valoracionCompleta, entry.currency === 'USD')
      if (entry.currency === 'USD') assert.equal(Number(wallet.valorUsd), entry.amount)
      else assert.equal(wallet.valorUsd, null)
      const summary = await summaryFor(historical.tenant, entry.currency, `QA legacy ${entry.currency}`)
      assert.equal(Number(summary.movimientos_sin_usd), entry.currency === 'USD' ? 0 : 1)
      if (entry.currency !== 'USD') assert.equal(summary.total_usd, null)
    }
    const page = (await one("SELECT finanzas_movimientos_pagina($1,'2026-09-01','2026-09-30') AS value", [historical.tenant])).value
    assert.equal(page.movimientos.length, historical.entries.length)
    assert.ok(page.movimientos.every(row => Object.hasOwn(row, 'tasa_registrada_en') && row.tasa_registrada_en === null))
  })

  const explicitRates = []
  await check('New explicit rates are stamped by PostgreSQL, including a legitimate 804.81 quote', async () => {
    for (const fixture of [
      { currency: 'VES', amount: '80481', rate: '1', usdRate: '804.81' },
      { currency: 'USDT', amount: '100', rate: '440', usdRate: '400' },
    ]) {
      const wallet = await createWallet(historical.tenant, fixture.currency), id = randomUUID()
      const category = `QA explicit ${fixture.currency}`
      const inserted = await one(`INSERT INTO finanzas_movimientos(id,cuenta_id,fecha,tipo,categoria,concepto,monto,moneda,
        tasa_ves,tasa_usd_ves,fuente_tasa,idempotency_key,cuenta_custodia_id,tasa_registrada_en)
        VALUES($1,$2,'2026-09-12','ingreso',$3,'Explicit recorded quote',$4,$5,$6,$7,'BCV',$8,$9,'2000-01-01T00:00:00Z')
        RETURNING tasa_registrada_en,tasa_registrada_en=statement_timestamp() AS server_stamped`,
      [id, historical.tenant, category, fixture.amount, fixture.currency, fixture.rate, fixture.usdRate, randomUUID(), wallet])
      assert.equal(inserted.server_stamped, true)
      assert.notEqual(inserted.tasa_registrada_en, null)
      explicitRates.push({ ...fixture, id, wallet, category, recordedAt: inserted.tasa_registrada_en })
      const summary = await summaryFor(historical.tenant, fixture.currency, category)
      const expectedUsd = fixture.currency === 'VES' ? 100 : 110
      assert.equal(Number(summary.total_usd), expectedUsd)
      assert.equal(Number(summary.movimientos_sin_usd), 0)
      const balance = (await balancesFor(historical.tenant)).cuentas.find(row => row.cuentaCustodiaId === wallet)
      assert.equal(balance.valoracionCompleta, true)
      assert.equal(Number(balance.valorUsd), expectedUsd)
    }
    const page = (await one("SELECT finanzas_movimientos_pagina($1,'2026-09-01','2026-09-30') AS value", [historical.tenant])).value
    for (const row of explicitRates) assert.ok(page.movimientos.find(entry => entry.id === row.id).tasa_registrada_en)
  })

  await check('INSERT with missing USD rate ignores injected provenance; native USD remains valid', async () => {
    for (const currency of ['VES', 'USD']) {
      const wallet = await createWallet(historical.tenant, currency), id = randomUUID(), category = `QA absent ${currency}`
      const inserted = await one(`INSERT INTO finanzas_movimientos(id,cuenta_id,fecha,tipo,categoria,concepto,monto,moneda,
        tasa_ves,tasa_usd_ves,fuente_tasa,idempotency_key,cuenta_custodia_id,tasa_registrada_en)
        VALUES($1,$2,'2026-09-12','ingreso',$3,'Missing valuation quote',100,$4,1,NULL,'BCV',$5,$6,now()) RETURNING tasa_registrada_en`,
      [id, historical.tenant, category, currency, randomUUID(), wallet])
      assert.equal(inserted.tasa_registrada_en, null)
      const summary = await summaryFor(historical.tenant, currency, category)
      const balance = (await balancesFor(historical.tenant)).cuentas.find(row => row.cuentaCustodiaId === wallet)
      assert.equal(Number(summary.movimientos_sin_usd), currency === 'USD' ? 0 : 1)
      assert.equal(balance.valoracionCompleta, currency === 'USD')
      if (currency === 'USD') {
        assert.equal(Number(summary.total_usd), 100)
        assert.equal(Number(balance.valorUsd), 100)
      } else {
        assert.equal(summary.total_usd, null)
        assert.equal(balance.valorUsd, null)
      }
    }
  })

  await check('Annotations retain provenance; changing either rate clears it permanently on UPDATE', async () => {
    for (const [index, entry] of explicitRates.entries()) {
      await db.query("UPDATE finanzas_movimientos SET referencia='Annotation only',tasa_registrada_en='2000-01-01T00:00:00Z' WHERE id=$1", [entry.id])
      const original = await one('SELECT monto,moneda,tasa_ves,tasa_usd_ves,tasa_registrada_en FROM finanzas_movimientos WHERE id=$1', [entry.id])
      assert.deepEqual(original.tasa_registrada_en, entry.recordedAt)
      const query = index === 0
        ? 'UPDATE finanzas_movimientos SET tasa_ves=tasa_ves+1,tasa_registrada_en=now() WHERE id=$1'
        : 'UPDATE finanzas_movimientos SET tasa_usd_ves=tasa_usd_ves+1,tasa_registrada_en=now() WHERE id=$1'
      await db.query(query, [entry.id])
      assert.equal((await one('SELECT tasa_registrada_en FROM finanzas_movimientos WHERE id=$1', [entry.id])).tasa_registrada_en, null)
      const summary = await summaryFor(historical.tenant, entry.currency, entry.category)
      assert.equal(summary.total_usd, null)
      assert.equal(Number(summary.movimientos_sin_usd), 1)
      const balance = (await balancesFor(historical.tenant)).cuentas.find(row => row.cuentaCustodiaId === entry.wallet)
      assert.equal(balance.valoracionCompleta, false)
      assert.equal(balance.valorUsd, null)
      await db.query('UPDATE finanzas_movimientos SET tasa_ves=$2,tasa_usd_ves=$3,tasa_registrada_en=now() WHERE id=$1', [entry.id, entry.rate, entry.usdRate])
      const restored = await one('SELECT monto,moneda,tasa_ves,tasa_usd_ves,tasa_registrada_en FROM finanzas_movimientos WHERE id=$1', [entry.id])
      assert.deepEqual(restored, { ...original, tasa_registrada_en: null })
    }
  })

  const inactivePeriod = randomUUID(), inactiveLine = randomUUID(), inactiveEmployee = randomUUID(), inactiveCredit = randomUUID()
  const inactiveReverseKey = randomUUID()
  const inactiveReverse = { lineaId: inactiveLine, motivo: 'Inactive custody reversal QA' }
  let inactivePayment
  const inactiveSnapshot = async () => one(`SELECT
    (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM finanzas_operaciones t WHERE cuenta_id=$1) AS operations,
    (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM finanzas_movimientos t WHERE cuenta_id=$1) AS movements,
    (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM finanzas_nomina_asignaciones t WHERE cuenta_id=$1) AS assignments,
    (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM nomina_lineas t WHERE cuenta_id=$1) AS receipts,
    (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM nomina_periodos t WHERE cuenta_id=$1) AS periods,
    (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM cuentas_custodia t WHERE cuenta_id=$1) AS custody,
    (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM auditoria t WHERE cuenta_id=$1) AS audits,
    (SELECT version::text FROM finanzas_libro_version WHERE cuenta_id=$1) AS version,
    (SELECT count(*)::int FROM finanzas_operacion_contexto WHERE cuenta_id=$1) AS contexts`, [other])
  const rejectsInactiveBalance = run => assert.rejects(run, error => error.code === 'PT409'
    && error.message.includes('Restore custody account before changing its balance'))
  await check('Inactive zero-balance custody rejects payroll reversal with complete rollback', async () => {
    await db.query(`INSERT INTO finanzas_movimientos(id,cuenta_id,fecha,tipo,categoria,concepto,monto,moneda,tasa_ves,tasa_usd_ves,
      fuente_tasa,idempotency_key,cuenta_custodia_id)
      VALUES($1,$2,'2026-09-12','ingreso','QA inactive','Funding before payroll',100,'USD',400,400,'BCV',$3,$4)`,
    [inactiveCredit, other, randomUUID(), outside])
    await db.query("INSERT INTO nomina_periodos(id,cuenta_id,nombre,desde,hasta) VALUES($1,$2,'Inactive custody QA','2026-09-01','2026-09-07')", [inactivePeriod, other])
    await db.query("INSERT INTO clientes(id,cuenta_id,nombre) VALUES($1,$2,'Inactive custody employee')", [inactiveEmployee, other])
    await db.query('INSERT INTO nomina_lineas(id,cuenta_id,periodo_id,empleado_id,total_bruto_usd,total_neto_usd) VALUES($1,$2,$3,$4,100,100)',
      [inactiveLine, other, inactivePeriod, inactiveEmployee])
    await db.query("UPDATE nomina_periodos SET estado='cerrado' WHERE id=$1", [inactivePeriod])
    inactivePayment = await rpc('pagar_nomina', { ...pay([inactiveLine]), cuentaCustodiaId: outside }, randomUUID(), other, otherActor)
    assert.equal(Number((await balancesFor(other)).cuentas.find(row => row.cuentaCustodiaId === outside).saldoNativo), 0)
    await db.query('UPDATE cuentas_custodia SET activo=false WHERE id=$1', [outside])
    const before = await inactiveSnapshot()
    await rejectsInactiveBalance(() => rpc('revertir_nomina', inactiveReverse, inactiveReverseKey, other, otherActor))
    assert.deepEqual(await inactiveSnapshot(), before)
    assert.equal(before.contexts, 0)
    assert.equal((await one('SELECT finanzas_operacion_estado($1,$2,$3) AS value', [other, 'revertir_nomina', inactiveReverseKey])).value.estado, 'no_encontrada')
  })

  await check('Inactive custody rejects generic annul/delete and all native-effect edits, but accepts annotations', async () => {
    const before = await inactiveSnapshot()
    const attempts = [
      ['UPDATE finanzas_movimientos SET monto=101 WHERE id=$1', [inactiveCredit]],
      ["UPDATE finanzas_movimientos SET tipo='egreso' WHERE id=$1", [inactiveCredit]],
      ["UPDATE finanzas_movimientos SET moneda='VES' WHERE id=$1", [inactiveCredit]],
      ['UPDATE finanzas_movimientos SET cuenta_custodia_id=NULL WHERE id=$1', [inactiveCredit]],
      ['UPDATE finanzas_movimientos SET cuenta_id=$2 WHERE id=$1', [inactiveCredit, tenant]],
      ["UPDATE finanzas_movimientos SET estado='anulado',anulado_en=now(),anulado_por=$2,motivo_anulacion='Generic annul QA' WHERE id=$1", [inactiveCredit, otherActor]],
      ['DELETE FROM finanzas_movimientos WHERE id=$1', [inactiveCredit]],
      ['DELETE FROM finanzas_movimientos WHERE id=$1', [inactivePayment.movimientoIds[0]]],
    ]
    for (const [sql, params] of attempts) {
      await rejectsInactiveBalance(() => db.query(sql, params))
      assert.deepEqual(await inactiveSnapshot(), before)
    }
    await db.query("UPDATE finanzas_movimientos SET observaciones='Annotation on inactive custody',referencia='NOTE ONLY' WHERE id=$1", [inactiveCredit])
    const annotated = await one('SELECT observaciones,referencia,monto,estado FROM finanzas_movimientos WHERE id=$1', [inactiveCredit])
    assert.equal(annotated.observaciones, 'Annotation on inactive custody')
    assert.equal(annotated.referencia, 'NOTE ONLY')
    assert.equal(Number(annotated.monto), 100)
    assert.equal(annotated.estado, 'activo')
    assert.equal(Number((await balancesFor(other)).cuentas.find(row => row.cuentaCustodiaId === outside).saldoNativo), 0)
    assert.equal((await one('SELECT activo FROM cuentas_custodia WHERE id=$1', [outside])).activo, false)
  })

  await check('Restoring custody permits the same previously rejected reversal key to confirm once', async () => {
    await db.query('UPDATE cuentas_custodia SET activo=true WHERE id=$1', [outside])
    const before = await inactiveSnapshot()
    const reversed = await rpc('revertir_nomina', inactiveReverse, inactiveReverseKey, other, otherActor)
    assert.equal(reversed.estado, 'confirmada')
    assert.equal(reversed.idempotencyKey, inactiveReverseKey)
    assert.equal(reversed.reversionContable, true)
    assert.equal(reversed.movimientoId, inactivePayment.movimientoIds[0])
    const after = await inactiveSnapshot()
    assert.equal(after.operations.length, before.operations.length + 1)
    assert.equal(after.audits.length, before.audits.length + 1)
    assert.equal(after.movements.length, before.movements.length)
    assert.equal(after.assignments.length, before.assignments.length)
    assert.equal(BigInt(after.version), BigInt(before.version) + 1n)
    assert.equal(after.contexts, 0)
    assert.equal(after.receipts.find(row => row.id === inactiveLine).pagado, false)
    assert.equal(after.periods.find(row => row.id === inactivePeriod).estado, 'cerrado')
    assert.equal(after.movements.find(row => row.id === inactivePayment.movimientoIds[0]).estado, 'anulado')
    assert.equal(after.assignments.find(row => row.linea_id === inactiveLine).revertida_por_operacion_id, reversed.operationId)
    assert.equal(Number((await balancesFor(other)).cuentas.find(row => row.cuentaCustodiaId === outside).saldoNativo), 100)
    assert.deepEqual(await rpc('revertir_nomina', inactiveReverse, inactiveReverseKey, other, otherActor), reversed)
    assert.deepEqual(await inactiveSnapshot(), after)
  })
  // ─── Paridad capacidad × rol: la matriz única contra PostgreSQL ─────────────
  // `server/lib/permissions.js` es la fuente de la verdad de la autorización.
  // Aquí se mide qué concede realmente el SQL a cada rol y se compara en las dos
  // direcciones:
  //   * privilegio de MÁS   → fallo duro SIEMPRE: nadie puede recibir acceso que
  //     la matriz no conceda;
  //   * privilegio de MENOS → se reporta como brecha mientras el SQL siga
  //     exigiendo 'administracion' (F0-A). Al aplicar la migración 243, la
  //     paridad completa pasa a exigirse sola.
  const PARIDAD_SQL_ALINEADA = result.migrations.some(nombre => nombre.startsWith('243'))
  const brechasParidad = []
  const sobrePrivilegios = []
  const operadoresParidad = ROLES_VALIDOS.map(rol => ({ rol, id: randomUUID() }))
  for (const operador of operadoresParidad) {
    await db.query('INSERT INTO usuarios(id,cuenta_id,nombre,rol) VALUES($1,$2,$3,$4)',
      [operador.id, tenant, `Paridad ${operador.rol}`, operador.rol])
  }
  // Supabase concede a `authenticated` los privilegios de tabla por defecto;
  // PGlite no los trae, así que el arnés replica ese privilegio para medir la
  // decisión REAL de RLS: el aislamiento por fila lo decide la política.
  await db.exec('GRANT SELECT ON public.nomina_periodos, public.nomina_lineas, public.finanzas_movimientos, public.cuentas_custodia TO authenticated')

  // Equivalencia directa: el espejo SQL (migración 243) y la fuente JS deben
  // declarar exactamente los mismos roles en cada capacidad. Es la comprobación
  // más fuerte de la paridad: si alguien toca un solo lado, falla aquí.
  await check('El espejo SQL de la matriz coincide capacidad por capacidad con la fuente JS', async () => {
    for (const capacidad of CAPACIDADES) {
      const rolesSql = (await one('SELECT public.roles_capacidad($1) AS roles', [capacidad])).roles || []
      assert.deepEqual([...rolesSql].sort(), [...rolesConCapacidad(capacidad)].sort(), `capacidad ${capacidad}`)
    }
    const operativos = (await one('SELECT public.roles_operativos() AS roles')).roles || []
    assert.deepEqual([...operativos].sort(), [...ROLES_OPERATIVOS].sort(), 'roles_operativos()')
    console.log(`[PASS] Espejo SQL verificado en ${CAPACIDADES.length} capacidades y en roles_operativos().`)
  })

  const conJwt = async (operadorId, tarea) => {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [tenant])
    await db.query("SELECT set_config('request.jwt.claims',$1,false)",
      [JSON.stringify({ app_metadata: { operator_id: operadorId } })])
    try { return await tarea() } finally {
      await db.query("SELECT set_config('request.jwt.claim.sub','',false)")
      await db.query("SELECT set_config('request.jwt.claims','',false)")
    }
  }

  // Filas del tenant visibles con la sesión de ese operador (RLS + restrictiva).
  const filasVisibles = (tabla, operador) => conJwt(operador.id, async () => {
    await db.exec('SET ROLE authenticated')
    try { return Number((await one(`SELECT count(*)::int AS n FROM public.${tabla} WHERE cuenta_id=$1`, [tenant])).n) > 0 }
    finally { await db.exec('RESET ROLE') }
  })

  const rolQueVeSql = operador => conJwt(operador.id, async () => (await one('SELECT public.get_rol_actual() AS rol')).rol)
  const apareceEnLogin = (operador, filas) => filas.some(fila => fila.id === operador.id)
  const usuariosDeLogin = operador => conJwt(operador.id,
    async () => (await db.query('SELECT id FROM public.listar_usuarios_login()')).rows)

  // Las RPC privadas se ejecutan con service_role y el guardián de actor vive
  // dentro. Se envía un sobre inválido a propósito: PT403 significa que el actor
  // no pasa y PT400 que el actor pasa y el payload falla — sin escribir nada.
  const actorAceptado = async (sql, params) => {
    try { await one(sql, params); return true }
    catch (error) { return error.code === 'PT400' }
  }
  const operaFinanzasSql = (operador, tipo) => actorAceptado(
    'SELECT finanzas_operar($1,$2,$3,$4,$5::jsonb,NULL) AS value',
    [tenant, operador.id, tipo, 'sobre-invalido', JSON.stringify({})])
  const asignaCustodiaSql = operador => actorAceptado(
    'SELECT finanzas_asignar_custodia($1,$2,$3::uuid[],$4,NULL) AS value',
    [tenant, operador.id, [], usd])
  // La purga de mantenimiento es destructiva y exclusiva del jefe: su guardián
  // de actor se mide igual (PT403 si el actor no pasa; PT400 si pasa y el sobre
  // es inválido — aquí un módulo inexistente, que falla antes de escribir nada).
  const purgaSql = operador => actorAceptado(
    'SELECT mantenimiento_purgar($1,$2::text[],$3,$4,$5,$6::date,$7::date) AS value',
    [tenant, ['modulo-inexistente'], operador.id, 'Paridad', null, null, null])

  const esperadoCapacidad = capacidad => operador => tieneCapacidad({ rol: operador.rol }, capacidad)
  const esperadoOperativo = operador => tieneAccesoOperativo(operador.rol)
  const SUPERFICIES_SQL = [
    { nombre: 'nomina_periodos (RLS SELECT)', esperado: esperadoCapacidad('verNomina'), medir: operador => filasVisibles('nomina_periodos', operador) },
    { nombre: 'nomina_lineas (RLS SELECT)', esperado: esperadoCapacidad('verNomina'), medir: operador => filasVisibles('nomina_lineas', operador) },
    { nombre: 'finanzas_movimientos (RLS SELECT)', esperado: esperadoCapacidad('verFinanzas'), medir: operador => filasVisibles('finanzas_movimientos', operador) },
    { nombre: 'cuentas_custodia (RLS SELECT)', esperado: esperadoCapacidad('verSaldos'), medir: operador => filasVisibles('cuentas_custodia', operador) },
    { nombre: 'get_rol_actual() resuelve el rol', esperado: operador => esperadoOperativo(operador) ? operador.rol : null, medir: operador => rolQueVeSql(operador) },
    { nombre: 'listar_usuarios_login() lista al operador', esperado: esperadoOperativo, medir: async operador => apareceEnLogin(operador, await usuariosDeLogin(operador)) },
    { nombre: 'finanzas_operar:traspaso (guardián de actor)', esperado: esperadoCapacidad('operarFinanzas'), medir: operador => operaFinanzasSql(operador, 'traspaso') },
    { nombre: 'finanzas_operar:pagar_nomina (guardián de actor)', esperado: esperadoCapacidad('administrarNomina'), medir: operador => operaFinanzasSql(operador, 'pagar_nomina') },
    { nombre: 'finanzas_operar:revertir_nomina (guardián de actor)', esperado: esperadoCapacidad('administrarNomina'), medir: operador => operaFinanzasSql(operador, 'revertir_nomina') },
    { nombre: 'finanzas_asignar_custodia (guardián de actor)', esperado: esperadoCapacidad('operarFinanzas'), medir: operador => asignaCustodiaSql(operador) },
    { nombre: 'mantenimiento_purgar (guardián de actor)', esperado: esperadoCapacidad('purgarRegistros'), medir: operador => purgaSql(operador) },
  ]

  const mediciones = []
  for (const superficie of SUPERFICIES_SQL) {
    for (const operador of operadoresParidad) {
      const esperado = superficie.esperado(operador)
      let real
      try { real = await superficie.medir(operador) }
      catch (error) { real = `error: ${error.message}` }
      const detalle = typeof real === 'string' && real.startsWith('error:') ? real : null
      const concedido = detalle ? false : real
      mediciones.push({ superficie: superficie.nombre, rol: operador.rol, concedido, esperado, detalle })
      if (concedido === esperado) continue
      if (!esperado && concedido) sobrePrivilegios.push({ superficie: superficie.nombre, rol: operador.rol, detalle })
      else brechasParidad.push({ superficie: superficie.nombre, rol: operador.rol, detalle })
    }
  }
  result.paridad = { alineada: PARIDAD_SQL_ALINEADA, mediciones, brechas: brechasParidad, sobrePrivilegios }

  await check('Paridad capacidad × rol: nadie recibe acceso que la matriz única no conceda', async () => {
    assert.deepEqual(sobrePrivilegios.map(x => `${x.rol} → ${x.superficie}`), [])
  })

  await check('Paridad capacidad × rol: los roles heredados quedan fuera de todas las superficies', async () => {
    const filas = mediciones.filter(x => !ROLES_OPERATIVOS.includes(x.rol))
    assert.ok(filas.length > 0, 'la matriz debe tener roles heredados que probar')
    assert.deepEqual(filas.filter(x => x.concedido === true).map(x => `${x.rol} → ${x.superficie}`), [])
  })

  await check('Paridad capacidad × rol coincide con server/lib/permissions.js', async () => {
    if (brechasParidad.length === 0) {
      console.log(`[PASS] Paridad SQL completa: ${mediciones.length} superficies capacidad × rol reflejan la matriz única.`)
      return
    }
    const resumen = brechasParidad.map(x => `${x.rol} → ${x.superficie}${x.detalle ? ` (${x.detalle})` : ''}`)
    if (!PARIDAD_SQL_ALINEADA) {
      console.warn(`[paridad] Brecha pendiente (${resumen.length}): el SQL todavía exige 'administracion'; falta la migración 243 (F0-A del roadmap).`)
      for (const linea of resumen) console.warn(`  - ${linea}`)
      return
    }
    assert.fail(`El SQL no refleja la matriz única en ${resumen.length} superficies: ${resumen.slice(0, 6).join(' | ')}`)
  })

  result.passed = true
  console.log(`[test:db] ${result.checks.length} comprobaciones aprobadas; ${result.migrations.length} migraciones.`)
  console.log(`[test:db] Paridad capacidad × rol: ${mediciones.length} superficies medidas, ${result.paridad.sobrePrivilegios.length} privilegios de más, ${result.paridad.brechas.length} brechas pendientes.`)
} catch (error) {
  result.error = error.message; result.code = error.code; process.exitCode = 1
  console.error('[test:db] FAIL', error.message, error.code || '')
} finally {
  await db.close()
  const target = process.env.DB_TEST_REPORT
  if (target) await writeFile(target, JSON.stringify(result, null, 2))
}
