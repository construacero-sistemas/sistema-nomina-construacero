// scripts/test-finanzas-deterministic.mjs
// Deterministic handler/transport simulation with controlled in-memory fixtures.
// This does not prove SQL transactions, database isolation, or production readiness.
// Run only in the credential-free QA copy: node scripts/test-finanzas-deterministic.mjs

import * as F from '../server/handlers/finanzas.js'
import * as C from '../server/handlers/cuentasCustodia.js'
import * as S from '../server/handlers/finanzas.sync.js'
import { handleCrearTransferencia } from '../server/handlers/finanzas.operaciones.js'

// ─── Configuración de Entorno y Constantes ──────────────────────────────────
const ENV = {
  SUPABASE_URL: 'https://test-supabase.construacero.local',
  SUPABASE_SERVICE_KEY: 'test-service-key-1234567890',
  SUPABASE_ANON_KEY: 'test-anon-key-1234567890',
  JWT_SECRET: 'test-jwt-secret-very-secure-key-1234567890',
  NOMINA_TIMEZONE: 'America/Caracas',
  POS_API_URL: 'https://pos.construacero.local/api/cierre',
}

const IDS = {
  cuenta: '5d466571-9b1e-40d4-acfe-2fef00662e6c',
  operador: 'e41f1ba3-b2ce-4d8c-ba8a-bc7e1d8c60e0',
}

function makeJwt() {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const p = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 7200,
    sub: IDS.cuenta,
    app_metadata: {
      operator_id: IDS.operador,
      operator_rol: 'jefe',
      operator_nombre: 'Admin Finanzas',
    },
  })).toString('base64url')
  return `${h}.${p}.dummy_signature`
}

function makeRequest(path, { method = 'GET', body = null, headers = {} } = {}) {
  const token = makeJwt()
  const fullHeaders = {
    Authorization: `Bearer ${token}`,
    'x-operator-token': token,
    'Content-Type': 'application/json',
    ...headers,
  }
  const init = { method, headers: fullHeaders }
  if (body) init.body = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request(`https://nomina.construacero.local${path}`, init)
}

async function readJson(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text, status: res.status }
  }
}

const RATES = { usdVes: 73.5, usdtVes: 80 }
let fixtureSequence = 0
function nextFixtureUuid() {
  fixtureSequence += 1
  return `00000000-0000-4000-8000-${fixtureSequence.toString(16).padStart(12, '0')}`
}
const CUSTODY = {
  cajaVes: '11111111-0000-4000-8000-000000000001',
  cajaUsd: '11111111-0000-4000-8000-000000000002',
  bnc: '11111111-0000-4000-8000-000000000003',
  mercantil: '11111111-0000-4000-8000-000000000004',
  binance: '11111111-0000-4000-8000-000000000005',
  zelle: '11111111-0000-4000-8000-000000000006',
}
// Fixture lookup only, not production reconciliation or substring inference.
const CUSTODY_BY_LABEL = new Map([
  ['Caja Efectivo Bs', CUSTODY.cajaVes], ['Caja Efectivo $', CUSTODY.cajaUsd],
  ['Banco BNC (Principal)', CUSTODY.bnc], ['Banco Mercantil', CUSTODY.mercantil],
  ['Binance Pay (USDT)', CUSTODY.binance], ['Zelle Corporativo', CUSTODY.zelle],
])
const round6 = value => Math.round(value * 1e6) / 1e6
const fixtureResponse = (data, status = 200) => Promise.resolve(new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
}))

function crearMovBody(data) {
  const moneda = (data.moneda || 'USD').toUpperCase()
  const esVes = moneda === 'VES'
  const esUsdt = moneda === 'USDT'
  const custodyId = data.cuentaCustodiaId ?? (data.partes ? null : CUSTODY_BY_LABEL.get(data.cuenta_origen)) ?? null
  if (data.cuenta_origen && !data.partes && !custodyId) throw new Error(`Unknown custody fixture: ${data.cuenta_origen}`)
  return {
    fecha: data.fecha, tipo: data.tipo, categoria: data.categoria,
    concepto: data.concepto, monto: data.monto, moneda,
    tasa_ves: esVes ? 1 : (data.tasa_ves ?? (esUsdt ? RATES.usdtVes : RATES.usdVes)),
    tasa_usd_ves: data.tasa_usd_ves ?? RATES.usdVes,
    fuente_tasa: esVes ? 'FIJA' : (data.fuente_tasa ?? (esUsdt ? 'USDT' : 'BCV')),
    observacionTasa: data.observacionTasa ?? 'Synthetic rate snapshot for the August QA fixture',
    metodo_pago: data.metodo_pago ?? (esVes ? 'transferencia_ves' : (esUsdt ? 'cripto_usdt' : 'efectivo_usd')),
    cuentaCustodiaId: custodyId,
    cuenta_origen: data.cuenta_origen ?? null,
    referencia: data.referencia ?? 'REF-OP-MES',
    observaciones: data.observaciones ?? null,
    partes: data.partes ?? null,
    idempotencyKey: data.idempotency_key || `key-op-mes-${nextFixtureUuid()}`,
  }
}

// ─── Base de Datos Mock en Memoria ──────────────────────────────────────────
class InMemoryFinanzasDb {
  constructor() {
    this.reset()
  }

  reset() {
    this.cuentas_custodia = [
      {
        id: '11111111-0000-4000-8000-000000000001',
        cuenta_id: IDS.cuenta,
        codigo: 'caja-efectivo-bs',
        nombre: 'Caja Efectivo Bs',
        tipo: 'efectivo_ves',
        cartera: 'VES',
        moneda: 'VES',
        banco: 'Caja Física',
        subcuenta_id: 'Efectivo Bs',
        predeterminada: true,
        permanente: true,
        activo: true,
        creado_en: '2026-08-01T00:00:00.000Z',
      },
      {
        id: '11111111-0000-4000-8000-000000000002',
        cuenta_id: IDS.cuenta,
        codigo: 'caja-efectivo-usd',
        nombre: 'Caja Efectivo $',
        tipo: 'efectivo_usd',
        cartera: 'USD',
        moneda: 'USD',
        banco: 'Caja Fuerte',
        subcuenta_id: 'Efectivo $',
        predeterminada: true,
        permanente: true,
        activo: true,
        creado_en: '2026-08-01T00:00:00.000Z',
      },
    ]
    this.finanzas_categorias = []
    this.finanzas_movimientos = []
    this.auditoria = []
    this.posClosures = new Map()
    this.versions = new Map()
    this.operations = new Map()
  }

  bumpVersion(accountId) {
    this.versions.set(accountId, (this.versions.get(accountId) || 0) + 1)
  }

  // Solo para compatibilidad histórica: estas filas no pasan por el endpoint
  // actual, que obliga a elegir custodia al crear. El mismo guardrail sigue
  // aplicando si una fila histórica ya trae custodia o intenta asignarse.
  seedLegacyMovement(input) {
    if (!input?.id || !input.cuenta_id || input.cuenta_id !== IDS.cuenta) {
      throw new Error('Legacy movement fixture requires a stable id and tenant')
    }
    if (input.cuenta_custodia_id) {
      const custody = this.cuentas_custodia.find(account => account.id === input.cuenta_custodia_id
        && account.cuenta_id === input.cuenta_id && account.activo)
      if (!custody || custody.moneda !== input.moneda || input.partes?.length) {
        throw new Error('Legacy movement violates custody/moneda/split invariants')
      }
    }
    const row = this.generatedMovement({
      estado: 'activo', creado_en: '2026-08-31T11:00:00.000Z', tasa_registrada_en: null, ...input,
    }, false)
    this.finanzas_movimientos.push(row)
    this.bumpVersion(row.cuenta_id)
    return row
  }

  filteredRows(params, includeVoided = false) {
    return this.finanzas_movimientos.filter(row => row.cuenta_id === params.p_cuenta_id
      && (!params.p_desde || row.fecha >= params.p_desde)
      && (!params.p_hasta || row.fecha <= params.p_hasta)
      && (!params.p_tipo || row.tipo === params.p_tipo)
      && (!params.p_categoria || row.categoria === params.p_categoria)
      && (!params.p_moneda || row.moneda === params.p_moneda)
      && (!params.p_cartera || (params.p_cartera === 'VES' ? row.moneda === 'VES' : row.moneda !== 'VES'))
      && (includeVoided || row.estado === 'activo'))
  }

  tableRows(rows, url) {
    let result = rows.filter(row => [...url.searchParams].every(([field, value]) => {
      if (['select', 'order', 'limit', 'offset'].includes(field)) return true
      if (value.startsWith('eq.')) {
        const expected = value.slice(3)
        return expected === 'null' ? row[field] == null : String(row[field]) === expected
      }
      if (value.startsWith('neq.')) return String(row[field]) !== value.slice(4)
      if (value === 'is.null') return row[field] == null
      if (value === 'not.is.null') return row[field] != null
      if (value.startsWith('gte.')) return row[field] >= value.slice(4)
      if (value.startsWith('lte.')) return row[field] <= value.slice(4)
      if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(row[field]))
      throw new Error(`Unsupported fixture filter: ${field}=${value}`)
    }))

    const order = url.searchParams.get('order')
    if (order) {
      const terms = order.split(',').map(term => {
        const [field, direction = 'asc'] = term.split('.')
        return { field, descending: direction.toLowerCase() === 'desc' }
      })
      result = [...result].sort((a, b) => {
        for (const { field, descending } of terms) {
          if (a[field] === b[field]) continue
          if (a[field] == null) return descending ? 1 : -1
          if (b[field] == null) return descending ? -1 : 1
          const comparison = a[field] < b[field] ? -1 : 1
          return descending ? -comparison : comparison
        }
        return 0
      })
    }
    const offset = Number(url.searchParams.get('offset') || 0)
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : result.length
    return result.slice(offset, offset + limit)
  }

  generatedMovement(row, inserted = false) {
    const hasSnapshot = Number(row.tasa_ves) > 0 && Number(row.tasa_usd_ves) > 0
    return {
      ...row,
      monto_ves: row.moneda === 'VES' ? round6(Number(row.monto))
        : Number(row.tasa_ves) > 0 ? round6(Number(row.monto) * Number(row.tasa_ves)) : null,
      tasa_registrada_en: inserted ? (hasSnapshot ? '2026-08-31T12:00:00.000Z' : null) : row.tasa_registrada_en ?? null,
    }
  }

  fetchHandler(url, init = {}) {
    const u = new URL(url)
    const pathname = u.pathname
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null

    // 1. Supabase Auth
    if (pathname.includes('/auth/v1/user')) {
      return Promise.resolve(new Response(JSON.stringify({
        id: IDS.cuenta,
        email: 'admin@construacero.com',
        app_metadata: {
          operator_id: IDS.operador,
          operator_rol: 'jefe',
          operator_nombre: 'Admin Finanzas',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }

    // 2. Tabla usuarios
    if (pathname.includes('/rest/v1/usuarios')) {
      return Promise.resolve(new Response(JSON.stringify([
        {
          id: IDS.operador,
          nombre: 'Admin Finanzas',
          rol: 'jefe',
          cuenta_id: IDS.cuenta,
          activo: true,
          es_externo: false,
        },
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }

    // Minimal atomic transfer contract for handler-level simulation. SQL locking,
    // rollback and transaction-level invariants are exercised by test:db.
    if (method === 'POST' && pathname === '/rest/v1/rpc/finanzas_operar') {
      if (body.p_tipo !== 'traspaso' || body.p_cuenta_id !== IDS.cuenta || body.p_operador_id !== IDS.operador) {
        return fixtureResponse({ code: 'PT403' }, 403)
      }
      const operationKey = `${body.p_cuenta_id}:traspaso:${body.p_clave}`
      const payloadHash = JSON.stringify(body.p_payload)
      const previous = this.operations.get(operationKey)
      if (previous) {
        return previous.payloadHash === payloadHash
          ? fixtureResponse(previous.result)
          : fixtureResponse({ code: 'PT409' }, 409)
      }
      const payload = body.p_payload || {}
      const source = this.cuentas_custodia.find(row => row.id === payload.origenCuentaId && row.cuenta_id === body.p_cuenta_id && row.activo)
      const target = this.cuentas_custodia.find(row => row.id === payload.destinoCuentaId && row.cuenta_id === body.p_cuenta_id && row.activo)
      if (!source || !target || source.id === target.id) return fixtureResponse({ code: 'PT404' }, 404)
      if (this.finanzas_movimientos.some(row => row.cuenta_id === body.p_cuenta_id && row.estado === 'activo'
        && (!row.cuenta_custodia_id || row.partes?.length))) return fixtureResponse({ code: 'PT422' }, 422)
      const amount = Number(payload.montoOrigen)
      const rate = Number(payload.tasaCambio)
      const usdRate = Number(payload.tasaUsdVes)
      if (!(amount > 0) || !(rate > 0) || !(usdRate > 0) || source.moneda !== target.moneda || rate !== 1) {
        return fixtureResponse({ code: 'PT400' }, 400)
      }
      const balance = this.finanzas_movimientos.filter(row => row.cuenta_id === body.p_cuenta_id
        && row.cuenta_custodia_id === source.id && row.moneda === source.moneda && row.estado === 'activo')
        .reduce((sum, row) => sum + (row.tipo === 'ingreso' ? Number(row.monto) : -Number(row.monto)), 0)
      if (balance < amount) return fixtureResponse({ code: 'PT402' }, 409)
      const operationId = nextFixtureUuid()
      const targetAmount = round6(amount * rate)
      const base = { cuenta_id: body.p_cuenta_id, fecha: payload.fecha, categoria: 'Traspasos',
        moneda: source.moneda, tasa_ves: source.moneda === 'VES' ? 1 : usdRate, tasa_usd_ves: usdRate,
        fuente_tasa: 'MANUAL', observacion_tasa: payload.observaciones, referencia: payload.referencia,
        observaciones: payload.observaciones, estado: 'activo', creado_por: body.p_operador_id,
        metodo_pago: 'Transferencia', operacion_id: operationId }
      const outgoing = this.generatedMovement({ ...base, id: nextFixtureUuid(), tipo: 'egreso',
        concepto: `Transfer to ${target.nombre}`, monto: amount, cuenta_origen: source.nombre,
        cuenta_custodia_id: source.id, idempotency_key: `op:${operationId}:out` }, true)
      const incoming = this.generatedMovement({ ...base, id: nextFixtureUuid(), tipo: 'ingreso',
        concepto: `Transfer from ${source.nombre}`, monto: targetAmount, cuenta_origen: target.nombre,
        cuenta_custodia_id: target.id, idempotency_key: `op:${operationId}:in` }, true)
      this.finanzas_movimientos.push(outgoing, incoming)
      this.bumpVersion(body.p_cuenta_id)
      this.operations.set(operationKey, { payloadHash, result: {
        ok: true, estado: 'confirmada', operationId, idempotencyKey: body.p_clave, tipo: 'traspaso',
        resultado: { origenCuentaId: source.id, destinoCuentaId: target.id,
          montoOrigen: String(amount), montoDestino: String(targetAmount), monedaOrigen: source.moneda,
          monedaDestino: target.moneda, tasaCambio: String(rate), movimientoIds: [outgoing.id, incoming.id] },
      } })
      this.auditoria.push({ cuenta_id: body.p_cuenta_id, accion: 'TRASPASO', entidad_id: operationId })
      return fixtureResponse(this.operations.get(operationKey).result)
    }

    // Exact RPC transport contracts. SQL locking/atomicity is tested separately.
    if (method === 'POST' && pathname === '/rest/v1/rpc/finanzas_movimientos_pagina') {
      const versionLibro = String(this.versions.get(body.p_cuenta_id) || 0)
      if (body.p_version != null && body.p_version !== versionLibro) return fixtureResponse({ code: 'PT409' }, 409)
      const rows = this.filteredRows(body, body.p_anulados).sort((a, b) =>
        b.fecha.localeCompare(a.fecha) || b.creado_en.localeCompare(a.creado_en) || b.id.localeCompare(a.id))
      const offset = body.p_offset ?? 0
      const limit = body.p_limite ?? 50
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) return fixtureResponse({ code: 'PT400' }, 400)
      const movimientos = rows.slice(offset, offset + limit)
      return fixtureResponse({ movimientos, versionLibro, corte: '2026-08-31T12:00:00.000Z',
        paginacion: { total: rows.length, limit, offset, recibidos: movimientos.length,
          siguiente: offset + movimientos.length < rows.length ? offset + movimientos.length : null } })
    }

    if (method === 'POST' && pathname === '/rest/v1/rpc/finanzas_resumen_consistente') {
      const grouped = new Map()
      for (const row of this.filteredRows(body).filter(item => item.origen_operacion !== 'traspaso')) {
        const key = `${row.tipo}:${row.categoria}`
        const item = grouped.get(key) || { tipo: row.tipo, categoria: row.categoria, total_ves: 0, total_usd: 0,
          total_usd_puro: 0, total_usdt_puro: 0, total_ves_puro: 0, movimientos: 0, movimientos_sin_usd: 0 }
        const knownUsd = row.moneda === 'USD' || (row.tasa_registrada_en != null && row.tasa_ves > 0 && row.tasa_usd_ves > 0)
        item.total_ves += Number(row.monto_ves ?? 0)
        if (knownUsd) item.total_usd += row.moneda === 'USD' ? Number(row.monto) : Number(row.monto_ves) / Number(row.tasa_usd_ves)
        else item.movimientos_sin_usd++
        if (row.moneda === 'USD') item.total_usd_puro += Number(row.monto)
        if (row.moneda === 'USDT') item.total_usdt_puro += Number(row.monto)
        if (row.moneda === 'VES') item.total_ves_puro += Number(row.monto)
        item.movimientos++
        grouped.set(key, item)
      }
      const rows = [...grouped.values()].map(row => Object.fromEntries(Object.entries(row)
        .map(([key, value]) => [key, typeof value === 'number' ? round6(value) : value])))
      return fixtureResponse({ rows, versionLibro: String(this.versions.get(body.p_cuenta_id) || 0), corte: '2026-08-31T12:00:00.000Z' })
    }

    if (method === 'POST' && pathname === '/rest/v1/rpc/finanzas_asignar_custodia') {
      if (body.p_cuenta_id !== IDS.cuenta || body.p_operador_id !== IDS.operador) return fixtureResponse({ code: 'PT403' }, 403)
      if (!Array.isArray(body.p_ids) || body.p_ids.length < 1 || body.p_ids.length > 100) return fixtureResponse({ code: 'PT400' }, 400)
      const target = this.cuentas_custodia.find(row => row.id === body.p_custodia_id && row.cuenta_id === body.p_cuenta_id && row.activo)
      if (!target) return fixtureResponse({ code: 'PT404' }, 404)
      const ids = [...new Set(body.p_ids)]
      const rows = this.finanzas_movimientos.filter(row => row.cuenta_id === body.p_cuenta_id && ids.includes(row.id))
      if (rows.length !== ids.length) return fixtureResponse({ code: 'PT404' }, 404)
      if (rows.some(row => row.estado !== 'activo' || row.operacion_id || row.moneda !== target.moneda
        || (row.cuenta_custodia_id && row.cuenta_custodia_id !== target.id) || row.partes?.length)) return fixtureResponse({ code: 'PT409' }, 409)
      const changed = rows.filter(row => !row.cuenta_custodia_id)
      for (const row of changed) {
        row.cuenta_custodia_id = target.id
        row.cuenta_origen = target.nombre
        this.bumpVersion(row.cuenta_id)
      }
      if (changed.length) this.auditoria.push({ cuenta_id: body.p_cuenta_id, accion: 'CUSTODIA_ASIGNADA', meta: { ids, actualizados: changed.length } })
      return fixtureResponse({ ok: true, actualizados: changed.length, idempotente: changed.length === 0, cuentaCustodiaId: target.id })
    }

    // 4. Endpoint POS Externo Mock
    if (pathname.includes('/api/finanzas-sync/cierre-diario')) {
      const fecha = u.searchParams.get('fecha')
      const mockCierre = this.posClosures.get(fecha) || {
        ok: true,
        fecha,
        origen: 'POS Construacero Cotizaciones',
        total_despachos: 4,
        ventas_contado_usd: 800,
        cobros_cxc_usd: 200,
        devoluciones_usd: 0,
        total_ingresos_usd: 1000,
        desglose_pagos: {
          efectivo_usd: 500,
          zelle_usd: 300,
          pago_movil_ves: 22050,
          punto_venta_ves: 0,
          transferencia_ves: 0,
          otros_usd: 0,
        },
      }
      return Promise.resolve(new Response(JSON.stringify(mockCierre), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }

    // 4. Tabla cuentas_custodia
    if (pathname.includes('/rest/v1/cuentas_custodia')) {
      if (method === 'GET') {
        return fixtureResponse(this.tableRows(this.cuentas_custodia, u))
      }
      if (method === 'POST') {
        const input = Array.isArray(body) ? body : [body]
        if (input.some(item => !item.cuenta_id)) throw new Error('Custody INSERT omitted tenant')
        if (input.some(item => item.id && this.cuentas_custodia.some(row => row.id === item.id))) return fixtureResponse({ code: '23505', message: 'unique custody id' }, 409)
        const items = input.map(item => ({ ...item, id: item.id || nextFixtureUuid(), activo: item.activo !== false, creado_en: '2026-08-01T00:00:00.000Z' }))
        this.cuentas_custodia.push(...items)
        return fixtureResponse(items, 201)
      }
      if (method === 'PATCH') {
        const rows = this.tableRows(this.cuentas_custodia, u)
        for (const row of rows) Object.assign(row, body)
        return fixtureResponse(rows)
      }
      if (method === 'DELETE') {
        const deleted = this.tableRows(this.cuentas_custodia, u).filter(row => !row.activo && !row.permanente)
        this.cuentas_custodia = this.cuentas_custodia.filter(row => !deleted.includes(row))
        return Promise.resolve(new Response(JSON.stringify(deleted), { status: 200 }))
      }
    }

    // 5. Tabla finanzas_categorias
    if (pathname.includes('/rest/v1/finanzas_categorias')) {
      if (method === 'GET') {
        return fixtureResponse(this.tableRows(this.finanzas_categorias, u))
      }
      if (method === 'POST') {
        if (!body.cuenta_id) throw new Error('Category INSERT omitted tenant')
        const cat = { id: nextFixtureUuid(), activo: true, ...body }
        this.finanzas_categorias.push(cat)
        return Promise.resolve(new Response(JSON.stringify([cat]), { status: 201 }))
      }
      if (method === 'PATCH') {
        const rows = this.tableRows(this.finanzas_categorias, u)
        for (const row of rows) Object.assign(row, body)
        return fixtureResponse(rows)
      }
    }

    // 6. Tabla finanzas_movimientos
    if (pathname.includes('/rest/v1/finanzas_movimientos')) {
      if (method === 'GET') {
        const rows = this.tableRows(this.finanzas_movimientos, u)
        return fixtureResponse(rows.slice(0, Number(u.searchParams.get('limit') || rows.length)))
      }
      if (method === 'POST') {
        if (!body.cuenta_id) throw new Error('Movement INSERT omitted tenant')
        if (this.finanzas_movimientos.some(row => row.cuenta_id === body.cuenta_id && row.idempotency_key === body.idempotency_key)) return fixtureResponse({ code: '23505', message: 'unique idempotency_key' }, 409)
        if (body.cuenta_custodia_id) {
          const custody = this.cuentas_custodia.find(account => account.id === body.cuenta_custodia_id
            && account.cuenta_id === body.cuenta_id && account.activo)
          if (!custody || custody.moneda !== body.moneda) return fixtureResponse({ code: 'PT400', message: 'Custody currency mismatch' }, 400)
          if (body.partes?.length) return fixtureResponse({ code: 'PT422', message: 'Split legacy entries require reconciliation' }, 422)
        }
        const mov = this.generatedMovement({ id: body.id || nextFixtureUuid(), estado: 'activo', creado_en: '2026-08-31T12:00:00.000Z', ...body }, true)
        this.finanzas_movimientos.push(mov)
        this.bumpVersion(mov.cuenta_id)
        return fixtureResponse([mov], 201)
      }
      if (method === 'PATCH') {
        const matched = this.tableRows(this.finanzas_movimientos, u)
        for (const row of matched) {
          const ratesChanged = ['tasa_ves', 'tasa_usd_ves'].some(key => Object.hasOwn(body, key) && body[key] !== row[key])
          Object.assign(row, this.generatedMovement({ ...row, ...body, tasa_registrada_en: ratesChanged ? null : row.tasa_registrada_en }))
          this.bumpVersion(row.cuenta_id)
        }
        return fixtureResponse(matched)
      }
    }

    // 7. Auditoría
    if (pathname.includes('/rest/v1/auditoria')) {
      this.auditoria.push(body)
      return Promise.resolve(new Response(JSON.stringify([{ ok: true }]), { status: 201 }))
    }

    throw new Error(`Unexpected fixture request: ${method} ${u.origin}${pathname}`)
  }
}

// ─── Ejecución de la Simulación Determinista del Mes ──────────────────────────
async function ejecutarSimulacionMesFinanzas() {
  console.log('======================================================================')
  console.log(' SIMULACIÓN DETERMINISTA: 1 MES COMPLETO EN TODAS LAS FASES DE FINANZAS')
  console.log(' Periodo simulado: 2026-08-01 al 2026-08-31 (Agosto 2026)')
  console.log('======================================================================\n')

  const db = new InMemoryFinanzasDb()
  const originalFetch = globalThis.fetch
  globalThis.fetch = (url, init) => db.fetchHandler(url, init)

  const stats = {
    fasesCompletadas: 0,
    totalIngresosUsd: 0,
    totalEgresosUsd: 0,
    totalMovimientos: 0,
    verificaciones: 0,
  }

  function assert(cond, mensaje) {
    stats.verificaciones++
    if (!cond) {
      console.error(`  [FAIL] ${mensaje}`)
      throw new Error(`Aserción fallida: ${mensaje}`)
    }
    console.log(`  [PASS] ${mensaje}`)
  }

  function assertMovementCount(expected, label) {
    assert(db.finanzas_movimientos.length === expected, `${label}: ${expected} persisted fixture rows`)
  }

  try {
    // ━━━ FASE 1: Configuración de Cuentas y Saldos de Apertura (Día 1) ━━━
    console.log('━━━ FASE 1: CONFIGURACIÓN DE CUENTAS DE CUSTODIA Y SALDOS DE APERTURA (DÍA 1) ━━━')
    
    const resBnc = await C.handleCrearCuentaCustodia(makeRequest('/api/finanzas/cuentas-custodia/crear', {
      method: 'POST',
      body: {
        id: CUSTODY.bnc,
        nombre: 'Banco BNC (Principal)',
        tipo: 'banco_ves',
        moneda: 'VES',
        cartera: 'VES',
        subcuentaId: 'Banco en Bolívares',
        banco: 'BNC',
        numeroCuenta: '0191-0001-23-1234567890',
        titular: 'Construacero Carabobo C.A.',
        identificacion: 'J-50115913-0',
      },
    }), ENV)
    const bnc = (await readJson(resBnc)).cuenta
    assert(bnc && bnc.nombre === 'Banco BNC (Principal)', 'Cuenta BNC creada con éxito')

    const resMercantil = await C.handleCrearCuentaCustodia(makeRequest('/api/finanzas/cuentas-custodia/crear', {
      method: 'POST',
      body: {
        id: CUSTODY.mercantil,
        nombre: 'Banco Mercantil',
        tipo: 'banco_ves',
        moneda: 'VES',
        cartera: 'VES',
        subcuentaId: 'Banco en Bolívares',
        banco: 'Mercantil',
        numeroCuenta: '0105-0001-23-4567890123',
        titular: 'Construacero Carabobo C.A.',
      },
    }), ENV)
    const mercantil = (await readJson(resMercantil)).cuenta
    assert(mercantil && mercantil.nombre === 'Banco Mercantil', 'Cuenta Banco Mercantil creada')

    const resBinance = await C.handleCrearCuentaCustodia(makeRequest('/api/finanzas/cuentas-custodia/crear', {
      method: 'POST',
      body: {
        id: CUSTODY.binance,
        nombre: 'Binance Pay (USDT)',
        tipo: 'cripto_usdt',
        moneda: 'USDT',
        cartera: 'USD',
        subcuentaId: 'USDT',
        banco: 'Binance Pay (USDT)',
        identificacion: 'PAY-8829104',
      },
    }), ENV)
    const binance = (await readJson(resBinance)).cuenta
    assert(binance && binance.tipo === 'cripto_usdt', 'Cuenta Binance USDT creada')

    const resZelle = await C.handleCrearCuentaCustodia(makeRequest('/api/finanzas/cuentas-custodia/crear', {
      method: 'POST',
      body: {
        id: CUSTODY.zelle,
        nombre: 'Zelle Corporativo',
        tipo: 'zelle',
        moneda: 'USD',
        cartera: 'USD',
        subcuentaId: 'Zelle',
        banco: 'Zelle',
        identificacion: 'pagos@construacero.com',
      },
    }), ENV)
    const zelle = (await readJson(resZelle)).cuenta
    assert(zelle && zelle.moneda === 'USD', 'Cuenta Zelle Corporativo creada')

    const resListCuentas = await C.handleGetCuentasCustodia(makeRequest('/api/finanzas/cuentas-custodia'), ENV)
    const listaCuentas = (await readJson(resListCuentas)).cuentas
    assert(resListCuentas.status === 200 && listaCuentas.length === 6, 'Six active custody fixtures are returned')
    assert(Object.values(CUSTODY).every(id => listaCuentas.some(account => account.id === id)), 'Catalog preserves all six explicit custody UUIDs')

    // Saldos iniciales
    const saldosApertura = [
      { fecha: '2026-08-01', monto: 2000, moneda: 'USD', cuenta_origen: 'Caja Efectivo $', concepto: 'Saldo inicial de mes Caja $' },
      { fecha: '2026-08-01', monto: 1470, moneda: 'VES', monto_ves: 1470, cuenta_origen: 'Caja Efectivo Bs', concepto: 'Saldo inicial de mes Caja Bs' },
      { fecha: '2026-08-01', monto: 1500, moneda: 'USD', cuenta_origen: 'Zelle Corporativo', concepto: 'Saldo inicial de mes Zelle' },
      { fecha: '2026-08-01', monto: 1000, moneda: 'USDT', cuenta_origen: 'Binance Pay (USDT)', concepto: 'Saldo inicial de mes Binance USDT' },
      { fecha: '2026-08-01', monto: 7350, moneda: 'VES', monto_ves: 7350, cuenta_origen: 'Banco BNC (Principal)', concepto: 'Saldo inicial de mes BNC' },
      { fecha: '2026-08-01', monto: 50000, moneda: 'VES', monto_ves: 50000, cuenta_origen: 'Banco Mercantil', concepto: 'Saldo inicial de mes Mercantil' },
    ]

    for (const sa of saldosApertura) {
      const res = await F.handleCrearFinanzasMovimiento(makeRequest('/api/finanzas/movimientos', {
        method: 'POST',
        body: crearMovBody({
          fecha: sa.fecha,
          tipo: 'ingreso',
          categoria: 'Inversión y capital',
          concepto: sa.concepto,
          monto: sa.monto,
          moneda: sa.moneda,
          monto_ves: sa.monto_ves,
          cuenta_origen: sa.cuenta_origen,
          referencia: 'APERTURA-08-2026',
        }),
      }), ENV)
      if (res.status !== 201) {
        console.log('DEBUG error movimiento:', res.status, await readJson(res))
      }
      assert(res.status === 201, `Asiento de apertura para ${sa.cuenta_origen} registrado con éxito`)
    }
    stats.fasesCompletadas++

    // ━━━ FASE 2: Gestión de Categorías Contables (Día 2) ━━━
    console.log('\n━━━ FASE 2: GESTIÓN Y CATEGORIZACIÓN CONTABLE (DÍA 2) ━━━')
    
    await F.handleCrearFinanzasCategoria(makeRequest('/api/finanzas/categorias', {
      method: 'POST',
      body: { nombre: 'Mantenimiento de Galpones y Taller', tipo: 'egreso' },
    }), ENV)
    await F.handleCrearFinanzasCategoria(makeRequest('/api/finanzas/categorias', {
      method: 'POST',
      body: { nombre: 'Fletes y Distribución Regional', tipo: 'egreso' },
    }), ENV)

    const resListCat = await F.handleGetFinanzasCategorias(makeRequest('/api/finanzas/categorias'), ENV)
    const categorias = (await readJson(resListCat)).categorias
    assert(categorias.some(c => c.nombre.includes('Fletes')), 'Categorías listadas con inclusión de personalizadas')
    stats.fasesCompletadas++

    // ━━━ FASE 3: Ingresos Operativos y Ventas Comerciales (Días 3-10) ━━━
    console.log('\n━━━ FASE 3: REGISTRO DE INGRESOS Y VENTAS MULTI-MONEDA (DÍAS 3-10) ━━━')

    // 1. Venta mostrador efectivo USD
    await F.handleCrearFinanzasMovimiento(makeRequest('/api/finanzas/movimientos', {
      method: 'POST',
      body: crearMovBody({
        fecha: '2026-08-03',
        tipo: 'ingreso',
        categoria: 'Ventas',
        concepto: 'Venta de láminas galvanizadas y perfiles',
        monto: 850.00,
        moneda: 'USD',
        cuenta_origen: 'Caja Efectivo $',
        referencia: 'FAC-00891',
      }),
    }), ENV)

    // 2. Venta mayorista en Bolívares por BNC
    await F.handleCrearFinanzasMovimiento(makeRequest('/api/finanzas/movimientos', {
      method: 'POST',
      body: crearMovBody({
        fecha: '2026-08-05',
        tipo: 'ingreso',
        categoria: 'Ventas',
        concepto: 'Despacho de cabillas y mallas electrosoldadas',
        monto: 147000.00,
        moneda: 'VES',
        monto_ves: 147000.00,
        cuenta_origen: 'Banco BNC (Principal)',
        referencia: 'TRANS-BNC-89102',
      }),
    }), ENV)

    // 3. Venta internacional vía Binance USDT
    await F.handleCrearFinanzasMovimiento(makeRequest('/api/finanzas/movimientos', {
      method: 'POST',
      body: crearMovBody({
        fecha: '2026-08-07',
        tipo: 'ingreso',
        categoria: 'Ventas',
        concepto: 'Venta de perfiles estructurales pesados',
        monto: 1200.00,
        moneda: 'USDT',
        cuenta_origen: 'Binance Pay (USDT)',
        referencia: 'ORDER-BINANCE-4491',
      }),
    }), ENV)

    // 4. Cobranza corporativa vía Zelle
    await F.handleCrearFinanzasMovimiento(makeRequest('/api/finanzas/movimientos', {
      method: 'POST',
      body: crearMovBody({
        fecha: '2026-08-09',
        tipo: 'ingreso',
        categoria: 'Ventas',
        concepto: 'Pago de factura crédito Constructora del Centro',
        monto: 3500.00,
        moneda: 'USD',
        cuenta_origen: 'Zelle Corporativo',
        referencia: 'ZELLE-CONF-9921',
      }),
    }), ENV)

    // 5. Intento de alta de split multi-moneda. El alta actual exige custodia
    // de una sola moneda y no puede representar este caso como un movimiento.
    const splitAlta = await F.handleCrearFinanzasMovimiento(makeRequest('/api/finanzas/movimientos', {
      method: 'POST',
      body: crearMovBody({
        fecha: '2026-08-10',
        tipo: 'ingreso',
        categoria: 'Ventas',
        concepto: 'Venta combinada tubería estructural',
        monto: 1000.00,
        moneda: 'USD',
        partes: [
          { monto: 500, moneda: 'USD', metodo_pago: 'efectivo_usd', cuenta_origen: 'Caja Efectivo $' },
          { monto: 500, moneda: 'VES', monto_ves: 36750, tasa_ves: 73.5, metodo_pago: 'pago_movil_ves', cuenta_origen: 'Banco BNC (Principal)' },
        ],
        referencia: 'SPLIT-VENTA-102',
      }),
    }), ENV)
    const splitAltaBody = await readJson(splitAlta)
    assert(splitAlta.status === 400 && /cuenta de origen\/destino/i.test(splitAltaBody.error),
      'Un split multi-moneda sin custodia se rechaza antes de persistir')
    assertMovementCount(10, 'Split rechazado no debe persistir')

    // Compatibilidad con una fila legacy de split: la API actual no admite
    // crearla sin custodia y Postgres impide asignar una custodia a `partes`.
    const split = db.seedLegacyMovement({
      id: '11111111-0000-4000-8000-000000000008', cuenta_id: IDS.cuenta,
      fecha: '2026-08-10', tipo: 'ingreso', categoria: 'Ventas',
      concepto: 'Venta combinada tubería estructural', monto: 1000, moneda: 'USD',
      tasa_ves: RATES.usdVes, tasa_usd_ves: RATES.usdVes, fuente_tasa: 'BCV',
      referencia: 'SPLIT-VENTA-102', idempotency_key: 'legacy-split-venta-102',
      partes: [
        { monto: 500, moneda: 'USD', metodo_pago: 'efectivo_usd', cuenta_origen: 'Caja Efectivo $' },
        { monto: 500, moneda: 'USD', metodo_pago: 'zelle_usd', cuenta_origen: 'Zelle Corporativo' },
      ],
    })
    assertMovementCount(11, 'Six opening rows, four current sales, one seeded legacy split')
    assert(split.partes.length === 2 && !split.cuenta_custodia_id
      && split.partes.every(part => part.moneda === split.moneda)
      && split.partes.reduce((sum, part) => sum + part.monto, 0) === split.monto
      && split.tasa_registrada_en == null,
    'Legacy split is internally balanced, unassigned, and does not invent rate provenance')
    const splitAssignment = await F.handleReasignarCuentaMovimientos(makeRequest('/api/finanzas/movimientos/reasignar-cuenta', {
      method: 'POST', body: { ids: [split.id], cuentaCustodiaId: CUSTODY.cajaUsd },
    }), ENV)
    assert(splitAssignment.status === 409 && !split.cuenta_custodia_id,
      'Legacy split cannot be assigned to one custody account')
    const cryptoSale = db.finanzas_movimientos.find(row => row.referencia === 'ORDER-BINANCE-4491')
    assert(cryptoSale?.tasa_ves === RATES.usdtVes && cryptoSale.tasa_usd_ves === RATES.usdVes
      && cryptoSale.fuente_tasa === 'USDT' && cryptoSale.tasa_registrada_en != null
      && cryptoSale.monto_ves === 96000, 'USDT sale keeps distinct native and USD rate snapshots with provenance')
    stats.fasesCompletadas++

    // ━━━ FASE 4: Egresos y Gastos Operativos Ordinarios (Días 11-14) ━━━
    console.log('\n━━━ FASE 4: REGISTRO DE EGRESOS Y GUARDRAILS DE CONCEPTO (DÍAS 11-14) ━━━')

    // 1. Rechazar concepto corto
    const resRechazo = await F.handleCrearFinanzasMovimiento(makeRequest('/api/finanzas/movimientos', {
      method: 'POST',
      body: crearMovBody({
        fecha: '2026-08-11',
        tipo: 'egreso',
        categoria: 'Otros gastos',
        concepto: 'ok',
        monto: 50.00,
      }),
    }), ENV)
    assert(resRechazo.status === 400, 'Guardrail cumplido: Rechazado movimiento con concepto < 3 caracteres')

    // 2. Compra de consumibles
    await F.handleCrearFinanzasMovimiento(makeRequest('/api/finanzas/movimientos', {
      method: 'POST',
      body: crearMovBody({
        fecha: '2026-08-12',
        tipo: 'egreso',
        categoria: 'Mantenimiento de Galpones y Taller',
        concepto: 'Compra de discos de corte diamantados y electrodos',
        monto: 320.00,
        moneda: 'USD',
        cuenta_origen: 'Caja Efectivo $',
        referencia: 'FAC-PROV-119',
      }),
    }), ENV)

    // 3. Flete de gandola en VES
    await F.handleCrearFinanzasMovimiento(makeRequest('/api/finanzas/movimientos', {
      method: 'POST',
      body: crearMovBody({
        fecha: '2026-08-14',
        tipo: 'egreso',
        categoria: 'Fletes y Distribución Regional',
        concepto: 'Flete de gandola desde planta siderúrgica',
        monto: 44100.00,
        moneda: 'VES',
        monto_ves: 44100.00,
        cuenta_origen: 'Banco Mercantil',
        referencia: 'TRANS-MERC-441',
      }),
    }), ENV)
    assertMovementCount(13, 'Two valid expenses; invalid concept adds no row')
    assert(db.finanzas_movimientos.filter(row => row.tipo === 'egreso').length === 2, 'Both operating expenses persisted as expenses')
    stats.fasesCompletadas++

    // ━━━ FASE 5: Integración con Nómina - Pago de Salarios (Día 15) ━━━
    console.log('\n━━━ FASE 5: INTEGRACIÓN CON NÓMINA (ASIENTOS AUTOMÁTICOS DE EGRESO) (DÍA 15) ━━━')

    const resNomina1 = await F.handleCrearFinanzasMovimiento(makeRequest('/api/finanzas/movimientos', {
      method: 'POST',
      body: crearMovBody({
        fecha: '2026-08-15',
        tipo: 'egreso',
        categoria: 'Nómina',
        concepto: 'Pago de Nómina Quincenal - Período 2026-08-01 al 2026-08-15',
        monto: 1450.00,
        moneda: 'USD',
        monto_ves: 106575.00,
        cuenta_origen: 'Caja Efectivo $',
        referencia: 'NOMINA-QUINCENA-1',
        idempotency_key: 'nomina-egreso-periodo-q1-2026-08',
      }),
    }), ENV)
    assert(resNomina1.status === 201, 'Asiento financiero de Nómina 1ra quincena creado exitosamente')

    const resNominaDup = await F.handleCrearFinanzasMovimiento(makeRequest('/api/finanzas/movimientos', {
      method: 'POST',
      body: crearMovBody({
        fecha: '2026-08-15',
        tipo: 'egreso',
        categoria: 'Nómina',
        concepto: 'Pago de Nómina Quincenal - Período 2026-08-01 al 2026-08-15',
        monto: 1450.00,
        moneda: 'USD',
        cuenta_origen: 'Caja Efectivo $',
        idempotency_key: 'nomina-egreso-periodo-q1-2026-08',
      }),
    }), ENV)
    const duplicatePayroll = await readJson(resNominaDup)
    assert(resNominaDup.status === 200 && duplicatePayroll.idempotente === true, 'Legacy payroll entry replay is reported as idempotent')
    assertMovementCount(14, 'Payroll replay creates no duplicate')
    assert(db.finanzas_movimientos.filter(row => row.idempotency_key === 'nomina-egreso-periodo-q1-2026-08').length === 1, 'Exactly one historical payroll ledger entry exists')
    stats.fasesCompletadas++

    // ━━━ FASE 6: Sincronización Automática con Sistema POS (Días 16-20) ━━━
    console.log('\n━━━ FASE 6: SINCRONIZACIÓN BATCH DIARIA DEL SISTEMA POS (DÍAS 16-20) ━━━')

    const fechasPos = ['2026-08-16', '2026-08-17', '2026-08-18']
    for (const f of fechasPos) {
      db.posClosures.set(f, {
        ok: true,
        fecha: f,
        origen: 'POS Construacero Cotizaciones',
        total_despachos: 6,
        tasa_bcv: RATES.usdVes,
        ventas_contado_usd: 1500,
        cobros_cxc_usd: 300,
        devoluciones_usd: 0,
        total_ingresos_usd: 1800,
        desglose_pagos: {
          efectivo_usd: 800,
          zelle_usd: 400,
          usdt_usd: 0,
          pago_movil_ves: 22050,
          transferencia_ves: 0,
          punto_venta_ves: 0,
          otros_usd: 0,
        },
      })

      const resSync = await S.handleSyncVentasPos(makeRequest('/api/finanzas/sync-pos', {
        method: 'POST',
        body: { fecha: f, confirm: true },
      }), ENV)
      const dataSync = await readJson(resSync)
      assert(resSync.status === 200 && dataSync.ok && dataSync.resultados?.length === 4, `POS ${f}: four payment/CxC rows persisted`)
      const posRows = db.finanzas_movimientos.filter(row => row.fecha === f && row.idempotency_key?.startsWith('pos-'))
      const posUsd = posRows.reduce((sum, row) => sum + (row.moneda === 'USD' ? row.monto : row.monto_ves / row.tasa_usd_ves), 0)
      const expectedPosKeys = [
        `pos-vta-efectivo-usd-${f}`,
        `pos-vta-zelle-usd-${f}`,
        `pos-vta-pagomovil-ves-${f}`,
        `pos-cxc-${f}`,
      ]
      assert(posRows.length === expectedPosKeys.length
        && expectedPosKeys.every(key => posRows.some(row => row.idempotency_key === key))
        && Math.abs(posUsd - 1800) < 0.000001,
      `POS ${f}: expected method keys value $800 + $400 + Bs22050/73.5 + $300 CxC = $1800`)
      assert(posRows.every(row => !row.cuenta_custodia_id && row.tasa_registrada_en && row.tasa_usd_ves === RATES.usdVes),
        `POS ${f}: entries retain rate provenance but remain pending custody classification`)
      assert(dataSync.total_ingresos_usd === 1800, `POS ${f}: reported USD total matches persisted valuation (received ${dataSync.total_ingresos_usd})`)
    }
    stats.fasesCompletadas++

    assertMovementCount(26, 'Three POS days plus existing entries')
    const beforePosReplay = db.finanzas_movimientos.length
    const replayPos = await S.handleSyncVentasPos(makeRequest('/api/finanzas/sync-pos', { method: 'POST', body: { fecha: fechasPos[0], confirm: true } }), ENV)
    const replayPosData = await readJson(replayPos)
    assert(replayPos.status === 200 && replayPosData.resultados?.every(row => row.accion === 'actualizado'), 'POS replay updates the same four historical rows')
    assertMovementCount(beforePosReplay, 'POS replay preserves row count')

    // Los traspasos actuales usan una RPC; dos altas independientes no son atómicas.
    console.log('\nPHASE 7: ATOMIC TRANSFER AND PENDING-RECONCILIATION GUARD')

    const pendingTransfer = await handleCrearTransferencia(makeRequest('/api/finanzas/operaciones', {
      method: 'POST', body: {
        operationId: '77777777-7777-4777-8777-777777777701',
        origenCuentaId: CUSTODY.bnc, destinoCuentaId: CUSTODY.mercantil,
        montoOrigen: '100', tasaCambio: '1', tasaUsdVes: String(RATES.usdVes),
        fecha: '2026-08-21', referencia: 'TRASPASO-PENDIENTES-01',
        observaciones: 'Debe bloquearse por partidas pendientes de conciliación',
      },
    }), ENV)
    assert(pendingTransfer.status === 422 && db.finanzas_movimientos.length === 26,
      'El traspaso atómico rechaza el libro mensual con POS/split sin conciliar, sin escrituras parciales')

    const transferDb = new InMemoryFinanzasDb()
    transferDb.cuentas_custodia = db.cuentas_custodia.map(account => ({ ...account }))
    transferDb.seedLegacyMovement({
      id: '11111111-0000-4000-8000-000000000009', cuenta_id: IDS.cuenta,
      fecha: '2026-08-01', tipo: 'ingreso', categoria: 'Inversión y capital',
      concepto: 'Saldo inicial para prueba de transferencia atómica', monto: 1000,
      moneda: 'VES', tasa_ves: 1, tasa_usd_ves: RATES.usdVes, fuente_tasa: 'FIJA',
      cuenta_origen: 'Banco BNC (Principal)', cuenta_custodia_id: CUSTODY.bnc,
      idempotency_key: 'transfer-fixture-opening-0001', referencia: 'APERTURA-TRANSFER-TEST',
    })
    const restoreFetch = globalThis.fetch
    globalThis.fetch = (url, init) => transferDb.fetchHandler(url, init)
    try {
      const buildTransferRequest = (amount = '100') => handleCrearTransferencia(makeRequest('/api/finanzas/operaciones', {
        method: 'POST', body: {
          operationId: '77777777-7777-4777-8777-777777777702',
          origenCuentaId: CUSTODY.bnc, destinoCuentaId: CUSTODY.mercantil,
          montoOrigen: amount, tasaCambio: '1', tasaUsdVes: String(RATES.usdVes),
          fecha: '2026-08-21', referencia: 'TRASPASO-ATOMICO-01',
          observaciones: 'Rebalanceo entre cuentas VES',
        },
      }), ENV)
      const response = await buildTransferRequest()
      const result = await readJson(response)
      const linked = transferDb.finanzas_movimientos.filter(row => row.operacion_id === result.operationId)
      assert(response.status === 200 && result.estado === 'confirmada' && linked.length === 2
        && linked.some(row => row.tipo === 'egreso' && row.cuenta_custodia_id === CUSTODY.bnc)
        && linked.some(row => row.tipo === 'ingreso' && row.cuenta_custodia_id === CUSTODY.mercantil),
      'Un traspaso confirma una operación y dos asientos vinculados a custodias explícitas')
      const replay = await buildTransferRequest()
      assert(replay.status === 200 && transferDb.finanzas_movimientos.length === 3,
        'Repetir la clave devuelve el resultado y no duplica asientos')
      const conflict = await buildTransferRequest('101')
      assert(conflict.status === 409 && transferDb.finanzas_movimientos.length === 3,
        'Reutilizar la clave con payload distinto da conflicto sin alterar el libro')
    } finally {
      globalThis.fetch = restoreFetch
    }
    assertMovementCount(26, 'Las fixtures aisladas del traspaso no contaminan el libro mensual')
    stats.fasesCompletadas++

    // ━━━ FASE 8: Auditoría, Reasignaciones y Anulaciones (Días 25-28) ━━━
    console.log('\n━━━ FASE 8: AUDITORÍA, REASIGNACIONES Y ANULACIONES (DÍAS 25-28) ━━━')

    // 1. Movimiento huérfano histórico reasignable. El alta actual debe
    // rechazarlo; por eso se siembra solo en la fixture, como fila preexistente.
    const movHuerfano = db.seedLegacyMovement({
      id: '11111111-0000-4000-8000-000000000007', cuenta_id: IDS.cuenta,
      fecha: '2026-08-25', tipo: 'ingreso', categoria: 'Ventas',
      concepto: 'Cobranza sin cuenta especificada inicialmente', monto: 400,
      moneda: 'USD', tasa_ves: RATES.usdVes, tasa_usd_ves: RATES.usdVes,
      fuente_tasa: 'BCV', cuenta_origen: null, cuenta_custodia_id: null,
      idempotency_key: 'legacy-cobranza-sin-custodia-001',
    })
    assert(movHuerfano && !movHuerfano.cuenta_origen && !movHuerfano.cuenta_custodia_id,
      'Movimiento histórico sin custodia preparado para clasificación explícita')

    const resReasig = await F.handleReasignarCuentaMovimientos(makeRequest('/api/finanzas/movimientos/reasignar-cuenta', {
      method: 'POST',
      body: {
        ids: [movHuerfano.id],
        cuentaCustodiaId: CUSTODY.zelle,
      },
    }), ENV)
    const dataReasig = await readJson(resReasig)
    assert(resReasig.status === 200 && dataReasig.actualizados === 1, 'Movimiento USD asignado a Zelle por UUID explícito')
    const assigned = db.finanzas_movimientos.find(row => row.id === movHuerfano.id)
    assert(assigned.cuenta_custodia_id === CUSTODY.zelle && assigned.moneda === 'USD', 'La asignación preserva la moneda y no usa tenant como custodia')
    const retryAssignment = await F.handleReasignarCuentaMovimientos(makeRequest('/api/finanzas/movimientos/reasignar-cuenta', {
      method: 'POST', body: { ids: [movHuerfano.id], cuentaCustodiaId: CUSTODY.zelle },
    }), ENV)
    const retryAssignmentBody = await readJson(retryAssignment)
    assert(retryAssignment.status === 200 && retryAssignmentBody.actualizados === 0
      && retryAssignmentBody.idempotente === true, 'La misma clasificación no duplica efectos')

    // 2. Anulación con motivo formal
    const resErr = await F.handleCrearFinanzasMovimiento(makeRequest('/api/finanzas/movimientos', {
      method: 'POST',
      body: crearMovBody({
        fecha: '2026-08-26',
        tipo: 'egreso',
        categoria: 'Otros gastos',
        concepto: 'Factura duplicada por error de digitación',
        monto: 250.00,
        moneda: 'USD',
        cuenta_origen: 'Caja Efectivo $',
      }),
    }), ENV)
    const movErrBody = await readJson(resErr)
    assert(resErr.status === 201 && movErrBody.movimiento?.id,
      `Movimiento para anulación creado con custodia (status=${resErr.status})`)
    const movErr = movErrBody.movimiento

    const resAnular = await F.handleAnularFinanzasMovimiento(makeRequest('/api/finanzas/movimientos/anular', {
      method: 'POST',
      body: {
        id: movErr.id,
        motivo: 'Registro duplicado detectado en conciliación semanal',
        idempotencyKey: `anular-key-${movErr.id}`,
      },
    }), ENV)
    const dataAnular = await readJson(resAnular)
    assert(resAnular.status === 200 && dataAnular.movimiento?.estado === 'anulado',
      `Movimiento anulado con motivo formal (status=${resAnular.status})`)

    // 3. Reversión de anulación
    const resRevertir = await F.handleRevertirAnulacionMovimiento(makeRequest('/api/finanzas/movimientos/revertir-anulacion', {
      method: 'POST',
      body: { id: movErr.id },
    }), ENV)
    const dataRevertir = await readJson(resRevertir)
    assert(resRevertir.status === 200 && dataRevertir.movimiento?.estado === 'activo',
      `Reversión de anulación verificada (status=${resRevertir.status})`)

    // Anulación definitiva
    await F.handleAnularFinanzasMovimiento(makeRequest('/api/finanzas/movimientos/anular', {
      method: 'POST',
      body: { id: movErr.id, motivo: 'Anulación definitiva confirmada', idempotencyKey: `re-anular-key-${movErr.id}` },
    }), ENV)
    stats.fasesCompletadas++

    // ━━━ FASE 9: Cuadre Mensual y Ecuación Contable (Día 30) ━━━
    console.log('\n━━━ FASE 9: CUADRE MENSUAL, CONCILIACIÓN Y ECUACIÓN CONTABLE (DÍA 30) ━━━')

    const resResumen = await F.handleGetFinanzasResumen(makeRequest('/api/finanzas/resumen?desde=2026-08-01&hasta=2026-08-31'), ENV)
    const dataResumen = await readJson(resResumen)
    assert(resResumen.status === 200 && dataResumen.resumen,
      `Resumen mensual devuelve 200 con datos (status=${resResumen.status})`)
    const resumen = dataResumen.resumen || {}

    assert(resumen.ingresos_usd > 0, `Total Ingresos del mes calculados: $${resumen.ingresos_usd.toFixed(2)}`)
    assert(resumen.egresos_usd > 0, `Total Egresos del mes calculados: $${resumen.egresos_usd.toFixed(2)}`)

    const flujoCajaNeto = resumen.ingresos_usd - resumen.egresos_usd
    assert(flujoCajaNeto > 0, `Flujo de Caja Neto POSITIVO (Superávit del mes): $${flujoCajaNeto.toFixed(2)}`)

    // Recuperar todas las páginas del mismo libro, incluyendo el anulado.
    const todosMovs = [], seen = new Set()
    let offset = 0, version = null, pages = 0, total = null
    do {
      const params = new URLSearchParams({ desde: '2026-08-01', hasta: '2026-08-31', limit: '10', offset: String(offset), mostrarAnulados: 'true' })
      if (version != null) params.set('versionLibro', version)
      const response = await F.handleGetFinanzasMovimientos(makeRequest(`/api/finanzas/movimientos?${params}`), ENV)
      const page = await readJson(response)
      assert(response.status === 200 && Array.isArray(page.movimientos), 'Página de movimientos válida')
      assert(version == null || page.versionLibro === version, 'Versión de libro estable entre páginas')
      version = page.versionLibro; total = page.paginacion.total; pages++
      for (const row of page.movimientos) {
        assert(!seen.has(row.id), 'Sin duplicación de filas entre páginas')
        seen.add(row.id); todosMovs.push(row)
      }
      const next = page.paginacion.siguiente
      if (next == null) break
      assert(next === offset + page.movimientos.length && next > offset, 'La paginación avanza sin omisiones')
      offset = next
    } while (pages <= 10)
    assert(pages === 3 && todosMovs.length === 28 && todosMovs.length === total, 'Conjunto completo de 28 movimientos en tres páginas')
    const movimientosActivos = todosMovs.filter(m => m.estado === 'activo')
    assert(movimientosActivos.length === 27, 'Solo el movimiento anulado queda fuera del flujo')
    const amountUsd = row => row.moneda === 'USD' ? row.monto : row.monto_ves / row.tasa_usd_ves
    const expectedIngresos = movimientosActivos.filter(row => row.tipo === 'ingreso').reduce((sum, row) => sum + amountUsd(row), 0)
    const expectedEgresos = movimientosActivos.filter(row => row.tipo === 'egreso').reduce((sum, row) => sum + amountUsd(row), 0)
    assert(Math.abs(resumen.ingresos_usd - expectedIngresos) < 0.00001 && Math.abs(resumen.egresos_usd - expectedEgresos) < 0.00001,
      'Resumen USD coincide con los importes y tasas de todo el conjunto')

    const sinCustodia = movimientosActivos.filter(row => !row.cuenta_custodia_id)
    const posSinCustodia = sinCustodia.filter(row => /POS-(?:CXC-)?\d{4}-\d{2}-\d{2}/i.test(row.referencia || ''))
    const legacySinCustodia = sinCustodia.filter(row => row.referencia === 'SPLIT-VENTA-102')
    assert(posSinCustodia.length === 12 && legacySinCustodia.length === 1
      && legacySinCustodia[0].partes?.length === 2,
    'Pendientes separados: doce filas POS y una fila histórica split sin custodia')
    assert(posSinCustodia.every(row => row.tasa_registrada_en && row.tasa_usd_ves === RATES.usdVes),
      'Las filas POS pendientes tienen tasa con procedencia, sin entrar en saldos confirmados')

    const movimientosConCustodia = movimientosActivos.filter(row => row.cuenta_custodia_id)
    assert(movimientosConCustodia.length === 14,
      'Solo los 14 movimientos con custodia confirmada entran al cálculo de saldos')
    const saldosCalculados = new Map()
    for (const mov of movimientosConCustodia) {
      if (!mov.cuenta_custodia_id) continue
      const c = listaCuentas.find(account => account.id === mov.cuenta_custodia_id)
      assert(c && c.moneda === mov.moneda, 'Cuenta exacta y moneda nativa coinciden')
      const prev = saldosCalculados.get(c.id) || {
        nombre: c.nombre, moneda: c.moneda, apertura: 0, ingresosOperativos: 0, egresos: 0,
      }
      const amount = Number(mov.monto)
      if (mov.referencia === 'APERTURA-08-2026') {
        if (mov.tipo === 'ingreso') prev.apertura += amount
        else prev.apertura -= amount
      } else if (mov.tipo === 'ingreso') {
        prev.ingresosOperativos += amount
      } else {
        prev.egresos += amount
      }
      saldosCalculados.set(c.id, prev)
    }
    assert(saldosCalculados.size === 6, 'El cálculo comprueba las seis cuentas, no un conjunto vacío')
    assert([...saldosCalculados.values()].every(row => row.apertura > 0),
      'Las seis cuentas parten de su asiento de apertura, separado de la actividad operativa')

    console.log('\n  ┌─────────────────────────────┬──────────┬──────────────┬──────────────┬──────────────┐')
    console.log('  │ Cuenta de Custodia          │ Moneda   │ Apertura     │ Entradas     │ Salidas      │ Saldo Final  │')
    console.log('  ├─────────────────────────────┼──────────┼──────────────┼──────────────┼──────────────┤')
    for (const [, val] of saldosCalculados) {
      const saldoFinal = val.apertura + val.ingresosOperativos - val.egresos
      const sim = val.moneda === 'VES' ? 'Bs.' : (val.moneda === 'USDT' ? 'USDT' : '$')
      const n = val.nombre.padEnd(27)
      const m = val.moneda.padEnd(8)
      const opening = `${sim} ${val.apertura.toFixed(2)}`.padStart(12)
      const income = `${sim} ${val.ingresosOperativos.toFixed(2)}`.padStart(12)
      const expense = `${sim} ${val.egresos.toFixed(2)}`.padStart(12)
      const closing = `${sim} ${saldoFinal.toFixed(2)}`.padStart(12)
      console.log(`  │ ${n} │ ${m} │ ${opening} │ ${income} │ ${expense} │ ${closing} │`)
      assert(saldoFinal >= 0, `Saldo nativo final no negativo: ${val.nombre}`)
    }
    console.log('  └─────────────────────────────┴──────────┴──────────────┴──────────────┴──────────────┴──────────────┘')

    stats.totalIngresosUsd = resumen.ingresos_usd
    stats.totalEgresosUsd = resumen.egresos_usd
    stats.totalMovimientos = todosMovs.length
    stats.fasesCompletadas++

    // ━━━ FASE 10: Validación Determinista de Reglas de AGENT.md ━━━
    console.log('\n━━━ FASE 10: VALIDACIÓN DETERMINISTA DE REGLAS DE AGENT.MD ━━━')
    
    assert(db.auditoria.length > 0, `Trazabilidad contable: ${db.auditoria.length} eventos de auditoría registrados`)

    const permanentesEliminadas = db.cuentas_custodia.filter(c => c.permanente && !c.activo)
    assert(permanentesEliminadas.length === 0, 'Regla de seguridad: Cajas permanentes protegidas contra borrado')

    const movsSinMotivo = movimientosActivos.filter(m => !m.concepto || m.concepto.trim().length < 3)
    assert(movsSinMotivo.length === 0, 'Regla AGENT.md: Cero movimientos financieros sin concepto descriptivo')

    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    const categoriasConEmoji = db.finanzas_categorias.filter(c => emojiRegex.test(c.nombre))
    assert(categoriasConEmoji.length === 0, 'Regla AGENT.md: Cero emojis gráficos en categorías contables')

    stats.fasesCompletadas++

    // ━━━ RESUMEN FINAL ━━━
    console.log('\n======================================================================')
    console.log(' REPORTE EJECUTIVO DE LA SIMULACIÓN MENSUAL DE FINANZAS')
    console.log('======================================================================')
    console.log(`  • Total de Fases Ejecutadas:        ${stats.fasesCompletadas} / 10 (100% COMPLETADAS)`)
    console.log(`  • Aserciones y Pruebas Verificadas: ${stats.verificaciones} APROBADAS (0 FALLIDAS)`)
    console.log(`  • Total de Movimientos del Libro:   ${stats.totalMovimientos} filas históricas/operativas procesadas`)
    console.log(`  • Volumen de Ingresos del Mes:      $${stats.totalIngresosUsd.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`)
    console.log(`  • Volumen de Egresos del Mes:       $${stats.totalEgresosUsd.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`)
    console.log(`  • Flujo Operativo Neto (Superávit): $${(stats.totalIngresosUsd - stats.totalEgresosUsd).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`)
    console.log('  Alcance: simulación de cálculo y transporte; no certifica SQL, concurrencia, POS real ni producción.')
    console.log('  Las partidas sin custodia y transferencias históricas requieren conciliación independiente.')
    console.log('======================================================================\n')

    return stats
  } finally {
    globalThis.fetch = originalFetch
  }
}

ejecutarSimulacionMesFinanzas().then(() => {
  process.exit(0)
}).catch((err) => {
  console.error('\n[FATAL] Error en la simulación determinista de finanzas:', err)
  process.exit(1)
})
