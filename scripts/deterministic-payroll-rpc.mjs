import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Transport fixture only: handler tests observe normalized inputs and outputs.
// Actual PostgreSQL rollback, constraints, grants and locking are tested by test-db.mjs.
export function payrollRpcFixture(db, envelope, identity) {
  assert.equal(envelope.p_cuenta_id, identity.cuenta)
  assert.equal(envelope.p_operador_id, identity.operador)
  assert.equal(envelope.p_payload.zonaHoraria, 'America/Caracas')
  const { p_tipo: type, p_clave: key, p_payload: payload } = envelope
  const previous = db.rpcOperations.get(key)
  if (previous) {
    assert.deepEqual(previous.payload, payload, 'Retry must preserve normalized payload')
    return previous.response
  }
  const operationId = randomUUID()
  let outcome
  if (type === 'pagar_nomina') {
    assert.equal(payload.cuentaCustodiaId, identity.custodia)
    assert.equal(payload.metodoPago, 'Efectivo $')
    assert.ok(Number(payload.tasaBcv) > 0)
    assert.equal(typeof payload.tasaBcv, 'string')
    assert.equal(payload.fuenteTasa, 'BCV')
    const lines = payload.lineaIds.map(id => db.nomina_lineas.find(line => line.id === id))
    assert.ok(lines.every(line => line && !line.pagado))
    assert.ok(lines.every(line => db.nomina_periodos.find(period => period.id === line.periodo_id)?.estado === 'cerrado'))
    const assignments = [], movements = []
    for (const line of lines) {
      const amount = Number(line.total_neto_usd)
      const id = amount > 0 ? randomUUID() : null
      if (id) movements.push({ id, cuenta_id: identity.cuenta, operacion_id: operationId,
        cuenta_custodia_id: identity.custodia, tipo: 'egreso', categoria: 'Nómina',
        concepto: `Pago del recibo ${line.id}`, monto: amount, moneda: 'USD',
        tasa_ves: Number(payload.tasaBcv), tasa_usd_ves: Number(payload.tasaUsdVes), fuente_tasa: payload.fuenteTasa,
        monto_ves: amount * Number(payload.tasaBcv), tasa_registrada_en: '2026-08-10T12:00:00Z',
        referencia: payload.referencia, metodo_pago: payload.metodoPago, estado: 'activo',
        idempotency_key: `op:${operationId}:${line.id}` })
      assignments.push({ id: randomUUID(), lineaId: line.id, movimientoId: id, active: true })
    }
    db.finanzas_movimientos.push(...movements)
    db.rpcAssignments.push(...assignments)
    for (const line of lines) Object.assign(line, { pagado: true, referencia_pago: payload.referencia })
    for (const period of db.nomina_periodos) if (lines.some(line => line.periodo_id === period.id) &&
      db.nomina_lineas.filter(line => line.periodo_id === period.id).every(line => line.pagado)) period.estado = 'pagado'
    outcome = { recibos_pagados: lines.length, total_usd: String(lines.reduce((total, line) => total + Number(line.total_neto_usd), 0)),
      movimientoIds: movements.map(movement => movement.id), asignacionIds: assignments.map(assignment => assignment.id) }
  } else {
    assert.equal(type, 'revertir_nomina')
    assert.ok(payload.motivo?.trim())
    const line = db.nomina_lineas.find(item => item.id === payload.lineaId)
    assert.equal(line?.pagado, true)
    const assignment = db.rpcAssignments.find(item => item.lineaId === line.id && item.active)
    assert.ok(assignment)
    if (assignment.movimientoId) Object.assign(db.finanzas_movimientos.find(item => item.id === assignment.movimientoId), { estado: 'anulado', motivo_anulacion: payload.motivo })
    assignment.active = false
    line.pagado = false; line.referencia_pago = null
    const period = db.nomina_periodos.find(item => item.id === line.periodo_id)
    if (period.estado === 'pagado') period.estado = 'cerrado'
    outcome = { lineaId: line.id, asignacionId: assignment.id, movimientoId: assignment.movimientoId, reversionContable: true }
  }
  const response = { ok: true, operationId, idempotencyKey: key, tipo: type, estado: 'confirmada', resultado: outcome, ...outcome }
  db.rpcOperations.set(key, { payload, response })
  return response
}
