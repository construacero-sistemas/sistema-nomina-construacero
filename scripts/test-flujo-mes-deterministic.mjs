// scripts/test-flujo-mes-deterministic.mjs
// Recorrido E2E determinista del flujo mensual completo, tal como lo vive el
// usuario: apertura con conteo físico → movimientos del día a día → consultas →
// cierre con diferencias documentadas → mes siguiente heredado → segundo ciclo.
// PostgreSQL real embebido (PGlite) con TODAS las migraciones aplicadas desde
// cero: las reglas que se prueban son las del SQL, no una simulación.
// Sin red ni credenciales. No sustituye concurrencia multi-conexión ni RLS de
// staging. Ejecutar: node scripts/test-flujo-mes-deterministic.mjs
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const root = fileURLToPath(new URL('..', import.meta.url))
const db = new PGlite({ extensions: { pgcrypto } })
const result = { engine: 'PGlite PostgreSQL embebido', scope: 'Flujo mensual E2E sobre SQL real; no concurrencia multi-conexión ni producción', checks: [], passed: false }
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
async function check(name, run) {
  try { await run(); result.checks.push({ name, passed: true }); console.log(`[PASS] ${name}`) }
  catch (error) { result.checks.push({ name, passed: false, error: error.message }); console.error(`[FAIL] ${name}: ${error.message}`); throw error }
}
async function rejects(code, run, message) {
  await assert.rejects(run, e => e.code === code && (!message || e.message.includes(message)), `Expected SQLSTATE ${code}${message ? ` con «${message}»` : ''}`)
}
async function rejectsDetail(code, detail, run) {
  await assert.rejects(run, e => e.code === code && String(e.detail || '') === detail, `Expected SQLSTATE ${code} DETAIL ${detail}`)
}

try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb DEFAULT '{}'::jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    CREATE PUBLICATION supabase_realtime;`)
  result.migrations = []
  for (const name of (await readdir(`${root}/supabase/migrations`)).filter(n => n.endsWith('.sql')).sort()) {
    try { await db.exec(await readFile(`${root}/supabase/migrations/${name}`, 'utf8')) }
    catch (error) { error.message = `migración ${name}: ${error.message}`; throw error }
    result.migrations.push(name)
  }

  // ─── Escenario: un negocio con tres cuentas y una cuarta nacida a mitad de mes ─
  const months = await one("SELECT (date_trunc('month',current_date)-interval '1 month')::date::text AS previous,(date_trunc('month',current_date))::date::text AS current")
  const sepDia = d => `${months.previous.slice(0, 7)}-${d}`
  const octDia = d => `${months.current.slice(0, 7)}-${d}`
  const tenant = randomUUID(), actor = randomUUID()
  const paso = async (etiqueta, run) => { try { return await run() } catch (error) { error.message = `${etiqueta}: ${error.message}`; throw error } }
  await paso('fixture auth.users', () => db.query('INSERT INTO auth.users(id) VALUES($1)', [tenant]))
  await paso('fixture usuarios', () => db.query("INSERT INTO usuarios(id,cuenta_id,nombre,rol) VALUES($1,$2,'Flujo QA','jefe')", [actor, tenant]))
  const createWallet = async (nombre, currency) => {
    const wallet = randomUUID()
    const type = { USD: 'efectivo_usd', VES: 'banco_ves', USDT: 'cripto_usdt' }[currency]
    await paso(`fixture cuentas_custodia (${nombre})`, () => db.query('INSERT INTO cuentas_custodia(id,cuenta_id,nombre,tipo,cartera,moneda,subcuenta_id) VALUES($1,$2,$3,$4,$5,$6,$3)',
      [wallet, tenant, nombre, type, currency === 'VES' ? 'VES' : 'USD', currency]))
    return wallet
  }
  const cajaUsd = await createWallet('Caja Efectivo $', 'USD')
  const bancoVes = await createWallet('Cuenta Venezuela', 'VES')
  const cripto = await createWallet('Caja USDT', 'USDT')
  let extraUsd // nace a mitad de mes en F6, después de la apertura

  const monthly = async (action, month, payload, key = randomUUID()) =>
    (await one('SELECT finanzas_periodo_mensual_operar($1,$2,$3,$4,$5,$6::jsonb,NULL) AS value',
      [tenant, actor, action, month, key, JSON.stringify(payload)])).value
  const monthlyState = async month => (await one('SELECT finanzas_periodo_mensual_estado($1,$2) AS value', [tenant, month])).value
  const saldoPeriodo = async (wallet, fecha) => Number((await one('SELECT finanzas_saldo_periodo($1,$2,$3::date) AS value', [tenant, wallet, fecha])).value)
  const saldoHistorico = async wallet => Number((await one("SELECT coalesce(sum(CASE WHEN tipo='ingreso' THEN monto ELSE -monto END),0) AS value FROM finanzas_movimientos WHERE cuenta_id=$1 AND cuenta_custodia_id=$2 AND estado='activo'", [tenant, wallet])).value)
  const filaMes = async (month, wallet) => one(`SELECT c.* FROM finanzas_periodos_mensuales_cuentas c
    JOIN finanzas_periodos_mensuales p ON p.id=c.periodo_id WHERE c.cuenta_id=$1 AND p.mes_inicio=$2::date AND c.cuenta_custodia_id=$3`, [tenant, month, wallet])
  const insertMov = ({ fecha, tipo, categoria, concepto, monto, moneda, wallet, tasaVes, referencia = null, motivoCoincidencia = null, key = randomUUID() }) =>
    db.query(`INSERT INTO finanzas_movimientos(cuenta_id,fecha,tipo,categoria,concepto,monto,moneda,tasa_ves,tasa_usd_ves,fuente_tasa,idempotency_key,cuenta_custodia_id,referencia,motivo_coincidencia)
      VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,'BCV',$10,$11,$12,$13)`,
      [tenant, fecha, tipo, categoria, concepto, monto, moneda, tasaVes, tasaVes === 1 ? 400 : tasaVes, key, wallet, referencia, motivoCoincidencia])
  const anular = (id, { por = null, motivo = null } = {}) =>
    db.query("UPDATE finanzas_movimientos SET estado='anulado',anulado_en=now(),anulado_por=$2,motivo_anulacion=$3,anulacion_idempotency_key=$4 WHERE id=$1",
      [id, por, motivo, randomUUID()])
  const rates1 = { tasaUsdVes: '410', tasaUsdtVes: '450' }
  const rates2 = { tasaUsdVes: '500', tasaUsdtVes: '600' }

  // ─── F1. Mes 1: el usuario consulta antes de abrir ───────────────────────────
  await check('F1. Estado inicial: mes sin apertura y saldos del libro en cero', async () => {
    const estado = await monthlyState(months.previous)
    assert.equal(estado.estado, 'sin_apertura'); assert.equal(estado.aperturado, false)
    const cuenta = estado.cuentas.find(c => c.cuentaCustodiaId === cajaUsd)
    assert.equal(Number(cuenta.saldoHistorico), 0); assert.equal(Number(cuenta.movimientosMes), 0)
  })

  // ─── F2. Mes 1: apertura por conteo físico (primer mes, sin cierre previo) ───
  await check('F2. Apertura por conteo físico congela saldos y tasas; idempotente y sin reutilizar la clave', async () => {
    const apertura = {
      cuentas: [
        { cuentaCustodiaId: cajaUsd, metodo: 'saldo_real', saldoReal: '500', ...rates1 },
        { cuentaCustodiaId: bancoVes, metodo: 'saldo_real', saldoReal: '82000', ...rates1 },
        { cuentaCustodiaId: cripto, metodo: 'saldo_real', saldoReal: '100', ...rates1 },
        // extraUsd queda fuera: nace a mitad de mes y el cierre la dará de alta sola (4.4).
      ],
      ...rates1,
    }
    const key = 'flujo-open-month1-00001'
    const abierta = await monthly('aperturar', months.previous, apertura, key)
    assert.equal(abierta.ok, true); assert.equal(abierta.estado, 'abierto')
    const reintento = await monthly('aperturar', months.previous, apertura, key)
    assert.equal(reintento.idempotente, true); assert.equal(reintento.aperturado, true)
    await rejects('PT409', () => monthly('aperturar', months.previous, { ...apertura, tasaUsdVes: '411' }, key), 'different data')
    const fila = await filaMes(months.previous, bancoVes)
    assert.equal(Number(fila.saldo_apertura), 82000)
    assert.equal(Number(fila.saldo_apertura_usd), 200) // 82000 / 410, tasa congelada
    assert.equal(Number(fila.tasa_usd_ves), 410)
    // Primer mes: la diferencia frente al saldo del libro no exige motivo y no
    // se registra como diferencia (no hay cifra confirmada que contradecir).
    assert.equal(Number(fila.diferencia_apertura), 0); assert.equal(fila.motivo_apertura, null)
  })

  // ─── F3. Mes 1: el día a día (ventas, compras) con cifras que cuadran ───────
  const movimientos = {}
  await check('F3. Movimientos del mes: el saldo del período cuadra con apertura + neto', async () => {
    await insertMov({ fecha: sepDia('15'), tipo: 'ingreso', categoria: 'Ventas', concepto: 'Venta mostrador', monto: 200, moneda: 'USD', wallet: cajaUsd, tasaVes: 410, referencia: 'FAC-001' })
    await insertMov({ fecha: sepDia('16'), tipo: 'egreso', categoria: 'Insumos', concepto: 'Compra insumos', monto: 50, moneda: 'USD', wallet: cajaUsd, tasaVes: 410, referencia: 'FAC-002' })
    await insertMov({ fecha: sepDia('15'), tipo: 'ingreso', categoria: 'Ventas', concepto: 'Venta mostrador', monto: 250, moneda: 'USD', wallet: cajaUsd, tasaVes: 410, referencia: 'FAC-001', motivoCoincidencia: 'Segunda venta del mismo cliente' })
    await insertMov({ fecha: sepDia('15'), tipo: 'ingreso', categoria: 'Ventas', concepto: 'Venta Bs', monto: 41000, moneda: 'VES', wallet: bancoVes, tasaVes: 1, referencia: 'FAC-004' })
    const estado = await monthlyState(months.previous)
    const caja = estado.cuentas.find(c => c.cuentaCustodiaId === cajaUsd)
    assert.equal(Number(caja.movimientosMes), 400) // 200 + 250 - 50
    assert.equal(Number(caja.saldoCalculado), 900) // 500 de apertura + 400 netos
    assert.equal(await saldoPeriodo(cajaUsd, sepDia('30')), 900)
    assert.equal(await saldoHistorico(cajaUsd), 400)
  })

  // ─── F4. Mes 1: los guardarraíles del libro en el día a día ─────────────────
  await check('F4. Duplicados, fondos y claves: bloquean lo dudoso sin trabar lo válido', async () => {
    // Duplicado exacto (misma factura): bloqueado.
    await rejectsDetail('PT409', 'FINANCIAL_DUPLICATE_EXACT', () =>
      insertMov({ fecha: sepDia('15'), tipo: 'ingreso', categoria: 'Ventas', concepto: 'Venta mostrador', monto: 200, moneda: 'USD', wallet: cajaUsd, tasaVes: 410, referencia: 'FAC-001' }))
    // Coincidencia con monto distinto: requiere motivo de 8+ caracteres…
    await rejectsDetail('PT409', 'FINANCIAL_DUPLICATE_SIMILAR', () =>
      insertMov({ fecha: sepDia('15'), tipo: 'ingreso', categoria: 'Ventas', concepto: 'Venta mostrador', monto: 300, moneda: 'USD', wallet: cajaUsd, tasaVes: 410, referencia: 'FAC-001' }))
    await rejectsDetail('PT409', 'FINANCIAL_DUPLICATE_SIMILAR', () =>
      insertMov({ fecha: sepDia('15'), tipo: 'ingreso', categoria: 'Ventas', concepto: 'Venta mostrador', monto: 300, moneda: 'USD', wallet: cajaUsd, tasaVes: 410, referencia: 'FAC-001', motivoCoincidencia: 'corto' }))
    // …y con motivo documentado pasa.
    await insertMov({ fecha: sepDia('15'), tipo: 'ingreso', categoria: 'Ventas', concepto: 'Venta mostrador', monto: 300, moneda: 'USD', wallet: cajaUsd, tasaVes: 410, referencia: 'FAC-001', motivoCoincidencia: 'Tercera venta documentada en caja' })
    // Fondos: el mes no puede quedar en negativo (saldo 1200 tras la tercera venta).
    await rejectsDetail('PT402', 'FINANCIAL_INSUFFICIENT_FUNDS', () =>
      insertMov({ fecha: sepDia('20'), tipo: 'egreso', categoria: 'Servicios', concepto: 'Gasto excesivo', monto: 1500, moneda: 'USD', wallet: cajaUsd, tasaVes: 410, referencia: 'FAC-009' }))
    await insertMov({ fecha: sepDia('20'), tipo: 'egreso', categoria: 'Servicios', concepto: 'Pago servicios', monto: 300, moneda: 'USD', wallet: cajaUsd, tasaVes: 410, referencia: 'FAC-003', key: 'flujo-dup-key-0000000001' })
    // Misma clave de idempotencia en un movimiento distinto: la clave solo se usa una vez.
    await rejects('23505', () => insertMov({ fecha: sepDia('21'), tipo: 'egreso', categoria: 'Servicios', concepto: 'Clave repetida', monto: 5, moneda: 'USD', wallet: cajaUsd, tasaVes: 410, referencia: 'FAC-008', key: 'flujo-dup-key-0000000001' }))
    assert.equal(await saldoHistorico(cajaUsd), 400) // 200 + 250 + 300 - 50 - 300
  })

  // ─── F5. Mes 1: el usuario se equivoca y anula sin escribir motivo ──────────
  await check('F5. Anulación sin motivo basta con el usuario que anula (F4 de la 255)', async () => {
    const row = await one("SELECT id FROM finanzas_movimientos WHERE cuenta_id=$1 AND referencia='FAC-002'", [tenant])
    await anular(row.id, { por: actor })
    const despues = await one('SELECT estado,anulado_por,motivo_anulacion FROM finanzas_movimientos WHERE id=$1', [row.id])
    assert.equal(despues.estado, 'anulado'); assert.equal(despues.anulado_por, actor); assert.equal(despues.motivo_anulacion, null)
    // Sin usuario y sin motivo: el CHECK de la 255 lo rechaza (sobre un movimiento aún activo).
    const venta = await one("SELECT id FROM finanzas_movimientos WHERE cuenta_id=$1 AND referencia='FAC-001' AND monto=250", [tenant])
    await rejects('23514', () => db.query("UPDATE finanzas_movimientos SET estado='anulado',anulado_en=now() WHERE id=$1", [venta.id]))
    assert.equal(await saldoHistorico(cajaUsd), 450) // el gasto anulado deja de contar: 200 + 250 + 300 - 300
  })

  // ─── F6. Mes 1: transferencia entre carteras y la cuenta nueva a mitad de mes ─
  await check('F6. Traspaso entre carteras y cuenta nueva: requiere alta en el mes antes de operar', async () => {
    const operar = async (type, payload, key = randomUUID()) =>
      (await one('SELECT finanzas_operar($1,$2,$3,$4,$5::jsonb,NULL) AS value', [tenant, actor, type, key, JSON.stringify(payload)])).value
    // La cuenta nacida a mitad de mes no admite movimientos hasta darla de alta en el mes…
    extraUsd = await createWallet('Caja Zelle nueva', 'USD')
    await rejects('PT409', () => insertMov({ fecha: sepDia('18'), tipo: 'ingreso', categoria: 'Ventas', concepto: 'Venta Zelle', monto: 10, moneda: 'USD', wallet: extraUsd, tasaVes: 410, referencia: 'FAC-005' }), 'Wallet must be opened')
    // …y el alta en el mes solo existe para el mes corriente: en un mes pasado la
    // cuenta espera el alta automática al cerrar (regla 4.4).
    await rejects('PT409', () => monthly('alta_cuenta', months.previous, { cuentaCustodiaId: extraUsd, saldoReal: '0', ...rates2 }), 'Cannot add an account to a non-current month')
    const op = await operar('traspaso', { origenCuentaId: cajaUsd, destinoCuentaId: bancoVes, montoOrigen: '10', tasaCambio: '410', tasaUsdVes: '410', fecha: sepDia('22'), referencia: 'TRASPASO-01', observaciones: 'Cambio aprobado' })
    const asientos = (await db.query('SELECT tipo,moneda,monto FROM finanzas_movimientos WHERE operacion_id=$1', [op.operationId])).rows
    assert.equal(asientos.length, 2)
    assert.equal(Number(asientos.find(r => r.tipo === 'ingreso').monto), 4100)
    assert.equal(await saldoHistorico(cajaUsd), 440) // 450 - 10 del traspaso
    assert.equal(await saldoHistorico(bancoVes), 45100) // 41000 + 4100
  })

  // ─── F7. Mes 1: cierre con conteo físico y diferencias documentadas ─────────
  await check('F7. Cierre: faltante con motivo, auto-alta de la cuenta nueva e idempotencia', async () => {
    const cerrar = async (cuentas, key = randomUUID()) => monthly('cerrar', months.previous, { cuentas, ...rates2 }, key)
    const filas = [
      { cuentaCustodiaId: cajaUsd, saldoReal: '600', motivo: 'Faltante verificado en conteo físico', ...rates2 },
      { cuentaCustodiaId: bancoVes, saldoReal: '127100', motivo: null, ...rates2 },
      { cuentaCustodiaId: cripto, saldoReal: '100', motivo: null, ...rates2 },
      { cuentaCustodiaId: extraUsd, saldoReal: '0', motivo: null, ...rates2 },
    ]
    // Sin motivo (y con motivo corto) el faltante no se acepta.
    await rejects('PT400', () => cerrar(filas.map(f => ({ ...f, motivo: null }))), 'Explain each closing difference')
    await rejects('PT400', () => cerrar(filas.map(f => f.cuentaCustodiaId === cajaUsd ? { ...f, motivo: 'abc' } : f)), 'Explain each closing difference')
    // Falta una cuenta → rechaza (toda apertura abierta va exactamente una vez).
    await rejects('PT400', () => cerrar(filas.filter(f => f.cuentaCustodiaId !== cripto)), 'Closing must include all')
    const key = 'flujo-close-month1-00001'
    const cerrada = await cerrar(filas, key)
    assert.equal(cerrada.ok, true); assert.equal(cerrada.estado, 'cerrado')
    const reintento = await cerrar(filas, key)
    assert.equal(reintento.idempotente, true); assert.equal(reintento.cerrado, true)
    await rejects('PT409', () => cerrar(filas.map(f => f.cuentaCustodiaId === cajaUsd ? { ...f, saldoReal: '601' } : f), key), 'different data')
    const caja = await filaMes(months.previous, cajaUsd)
    assert.equal(Number(caja.saldo_cierre_libro), 940) // 500 de apertura + 440 netos del mes
    assert.equal(Number(caja.saldo_cierre_real), 600)
    assert.equal(Number(caja.diferencia_cierre), -340)
    assert.equal(caja.motivo_cierre, 'Faltante verificado en conteo físico')
    assert.equal(Number(caja.saldo_cierre_usd), 600); assert.equal(Number(caja.tasa_cierre_usd_ves), 500)
    // La cuenta que nació a mitad de mes se dio de alta sola al cerrar (4.4).
    const auto = await filaMes(months.previous, extraUsd)
    assert.equal(auto.metodo_apertura, 'alta_cuenta'); assert.equal(Number(auto.saldo_apertura), 0)
    assert.match(auto.motivo_apertura, /Alta autom/)
  })

  // ─── F8. Mes 1 cerrado: nada se toca ────────────────────────────────────────
  await check('F8. El mes cerrado es inmutable: ni movimientos nuevos ni ediciones', async () => {
    await rejects('PT409', () => insertMov({ fecha: sepDia('25'), tipo: 'ingreso', categoria: 'Ventas', concepto: 'Tardío', monto: 10, moneda: 'USD', wallet: cajaUsd, tasaVes: 410, referencia: 'FAC-007' }), 'Closed monthly ledger is immutable')
    await rejects('PT409', () => db.query("UPDATE finanzas_movimientos SET monto=310 WHERE cuenta_id=$1 AND referencia='FAC-003'", [tenant]), 'Closed monthly ledger is immutable')
  })

  // ─── F9. Mes 2: el usuario abre con el cierre heredado y documenta faltantes ─
  await check('F9. Mes 2: hereda el cierre, exige motivo ante diferencias y permite descubierto documentado', async () => {
    const estado = await monthlyState(months.current)
    const herencia = Object.fromEntries(estado.cierreAnterior.map(r => [r.cuentaCustodiaId, Number(r.saldo)]))
    assert.deepEqual(herencia, { [cajaUsd]: 600, [bancoVes]: 127100, [cripto]: 100, [extraUsd]: 0 })
    // El mes corriente ya tiene un ingreso antes de aperturar: el wizard lo revisa.
    await insertMov({ fecha: octDia('05'), tipo: 'ingreso', categoria: 'Ventas', concepto: 'Ingreso previo a la apertura', monto: 150, moneda: 'USDT', wallet: cripto, tasaVes: 450, referencia: 'FAC-010' })
    const filas = motivoBanco => [
      { cuentaCustodiaId: cajaUsd, metodo: 'cierre_anterior', ...rates2 },
      { cuentaCustodiaId: bancoVes, metodo: 'saldo_real', saldoReal: '120000', motivo: motivoBanco, ...rates2 },
      { cuentaCustodiaId: cripto, metodo: 'saldo_real', saldoReal: '0', motivo: 'Descubierto documentado en acta', ...rates2 },
      { cuentaCustodiaId: extraUsd, metodo: 'cierre_anterior', ...rates2 },
    ]
    await rejects('PT400', () => monthly('aperturar', months.current, { cuentas: filas(null), ...rates2 }), 'Explain difference')
    await rejects('PT400', () => monthly('aperturar', months.current, { cuentas: filas('abc'), ...rates2 }), 'Explain difference')
    const key = 'flujo-open-month2-00001'
    const abierta = await monthly('aperturar', months.current, { cuentas: filas('Faltante verificado en cierre'), ...rates2 }, key)
    assert.equal(abierta.estado, 'abierto')
    const banco = await filaMes(months.current, bancoVes)
    assert.equal(Number(banco.saldo_apertura), 120000)
    assert.equal(Number(banco.diferencia_apertura), -7100) // frente al cierre anterior
    assert.equal(banco.motivo_apertura, 'Faltante verificado en cierre')
    const deficit = await filaMes(months.current, cripto)
    assert.equal(Number(deficit.saldo_apertura), -150) // descubierto: el conteo no cubre el ingreso previo
    assert.match(deficit.motivo_apertura, /Descubierto/)
    assert.equal(Number((await filaMes(months.current, cajaUsd)).saldo_apertura), 600)
  })

  // ─── F10. Mes 2: el conteo de la apertura financia el mes (no solo el histórico) ─
  await check('F10. El saldo del período financia los gastos del mes y el mes corriente no se cierra', async () => {
    // Histórico del libro para cajaUsd: 440. Con solo el histórico, el gasto de
    // 500 rebotaría; el saldo del período (apertura 600) sí lo financia.
    assert.equal(await saldoHistorico(cajaUsd), 440)
    await insertMov({ fecha: octDia('10'), tipo: 'egreso', categoria: 'Servicios', concepto: 'Pago nómina octubre', monto: 500, moneda: 'USD', wallet: cajaUsd, tasaVes: 500, referencia: 'FAC-011' })
    // La ruta correcta para una cuenta nueva en el mes corriente: alta en el mes.
    const nuevaOct = await createWallet('Caja Nueva Octubre', 'USD')
    const alta = await monthly('alta_cuenta', months.current, { cuentaCustodiaId: nuevaOct, saldoReal: '80', ...rates2 }, 'flujo-alta-oct-0000001')
    assert.equal(Number(alta.saldoApertura), 80)
    await insertMov({ fecha: octDia('14'), tipo: 'ingreso', categoria: 'Ventas', concepto: 'Venta cuenta nueva', monto: 20, moneda: 'USD', wallet: nuevaOct, tasaVes: 500, referencia: 'FAC-013' })
    assert.equal(await saldoPeriodo(nuevaOct, octDia('30')), 100)
    await rejectsDetail('PT402', 'FINANCIAL_INSUFFICIENT_FUNDS', () =>
      insertMov({ fecha: octDia('12'), tipo: 'egreso', categoria: 'Servicios', concepto: 'Gasto que excede el mes', monto: 200, moneda: 'USD', wallet: cajaUsd, tasaVes: 500, referencia: 'FAC-012' }))
    assert.equal(await saldoPeriodo(cajaUsd, octDia('30')), 100)
    // El mes en curso jamás se cierra: la ventana lo rechaza con el motivo claro.
    await rejects('PT409', () => monthly('cerrar', months.current, { cuentas: [], ...rates2 }), 'Only the previous month may be closed')
  })

  // ─── F11. Mes a mes: el usuario revisa los números y todo cuadra ────────────
  await check('F11. Mes a mes: resumen del período, saldos vivos y cierre heredado coherentes', async () => {
    const resumen = async (desde, hasta) => (await db.query('SELECT tipo,categoria,round(sum(monto_ves),6) AS total_ves,count(*)::int AS movimientos FROM finanzas_movimientos WHERE cuenta_id=$1 AND estado=\'activo\' AND fecha BETWEEN $2::date AND $3::date GROUP BY tipo,categoria ORDER BY tipo,categoria', [tenant, desde, hasta])).rows
    const septiembre = await resumen(sepDia('01'), sepDia('30'))
    const ventas = septiembre.find(r => r.tipo === 'ingreso' && r.categoria === 'Ventas')
    assert.equal(Number(ventas.total_ves), 348500) // (200 + 250 + 300)*410 + 41000*1
    assert.equal(ventas.movimientos, 4)
    assert.ok(!septiembre.some(r => r.categoria === 'Insumos'), 'el gasto anulado no debe aparecer en el resumen')
    assert.equal(septiembre.reduce((sum, r) => sum + r.movimientos, 0), 7) // 8 insertados - 1 anulado
    // El resumen operativo del mes excluye a propósito los traspasos entre
    // carteras (239: son dinero interno) y los asientos anulados; el libro
    // directo sí conserva ambos.
    assert.ok(septiembre.some(r => r.categoria === 'Traspasos'), 'el libro conserva los traspasos internos')
    const viaRpc = (await db.query('SELECT * FROM finanzas_resumen($1,$2::date,$3::date,NULL,NULL,NULL)', [tenant, sepDia('01'), sepDia('30')])).rows
      .map(r => ({ tipo: r.tipo, categoria: r.categoria, total_ves: Number(r.total_ves), movimientos: Number(r.movimientos) }))
    // El orden lo garantiza la migración 256 (ORDER BY tipo, categoria): se
    // compara SIN ordenar en el cliente para fijar el contrato determinista.
    assert.deepEqual(viaRpc, [
      { tipo: 'egreso', categoria: 'Servicios', total_ves: 123000, movimientos: 1 },
      { tipo: 'ingreso', categoria: 'Ventas', total_ves: 348500, movimientos: 4 },
    ])
    // Cierre heredado: el mes cerrado devuelve su saldo real, no el del libro.
    const cerrado = await monthlyState(months.previous)
    assert.equal(Number(cerrado.cuentas.find(c => c.cuentaCustodiaId === cajaUsd).saldoCalculado), 600)
    // Saldos vivos del mes corriente.
    const vivos = await monthlyState(months.current)
    assert.equal(Number(vivos.cuentas.find(c => c.cuentaCustodiaId === cajaUsd).saldoCalculado), 100)
    // El descubierto se recupera con el ingreso del mes: saldoApertura -150 más
    // el ingreso previo de 150 deja 0, el conteo físico real de la cuenta.
    assert.equal(Number(vivos.cuentas.find(c => c.cuentaCustodiaId === cripto).saldoApertura), -150)
    assert.equal(Number(vivos.cuentas.find(c => c.cuentaCustodiaId === cripto).saldoCalculado), 0)
    assert.equal(await saldoHistorico(bancoVes), 45100)
  })

  result.passed = true
  console.log(`[test:flujo-mes] ${result.checks.length} fases del flujo mensual aprobadas; ${result.migrations.length} migraciones aplicadas.`)
} catch (error) {
  result.error = error.message; result.code = error.code; process.exitCode = 1
  console.error('[test:flujo-mes] FAIL', error.message, error.code || '')
} finally {
  await db.close()
  const target = process.env.DB_TEST_REPORT
  if (target) await writeFile(target, JSON.stringify(result, null, 2))
}
