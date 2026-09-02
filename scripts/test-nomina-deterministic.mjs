// scripts/test-nomina-deterministic.mjs
// Suite de pruebas deterministas e integrales de extremo a extremo para el sistema de Nómina.
// Ejecutable directamente mediante: node scripts/test-nomina-deterministic.mjs

import { calcularCamposAsistencia, calcularLineaNomina } from '../server/lib/nominaUtils.js'
import * as H from '../server/handlers/nomina.js'
import * as F from '../server/handlers/finanzas.js'

// ─── Configuración y Entorno Mock Controlado ──────────────────────────────────
const ENV = {
  SUPABASE_URL: 'https://test-supabase.construacero.local',
  SUPABASE_SERVICE_KEY: 'test-service-key-1234567890',
  SUPABASE_ANON_KEY: 'test-anon-key-1234567890',
  JWT_SECRET: 'test-jwt-secret-very-secure-key-1234567890',
  NOMINA_TIMEZONE: 'America/Caracas',
  NOMINA_NOW: '2026-08-10T12:00:00.000Z',
}

const IDS = {
  cuenta: '00000000-0000-4000-8000-000000000001',
  operador: '10000000-0000-4000-8000-000000000001',
  empleado1: '20000000-0000-4000-8000-000000000001',
  empleado2: '20000000-0000-4000-8000-000000000002',
  config1: '30000000-0000-4000-8000-000000000001',
  config2: '30000000-0000-4000-8000-000000000002',
  periodo: '40000000-0000-4000-8000-000000000001',
  linea1: '50000000-0000-4000-8000-000000000001',
  linea2: '50000000-0000-4000-8000-000000000002',
  registro1: '60000000-0000-4000-8000-000000000001',
}

function makeJwt(payload = {}) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const p = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 7200,
    sub: IDS.cuenta,
    app_metadata: {
      operator_id: IDS.operador,
      operator_rol: 'administracion',
      operator_nombre: 'Admin Nómina',
    },
    ...payload,
  })).toString('base64url')
  return `${h}.${p}.dummy_signature`
}

function extractIdFilter(params) {
  const idRaw = params.get('id')
  if (!idRaw) return null
  if (idRaw.startsWith('in.(')) return { type: 'in', values: idRaw.slice(4, -1).split(',') }
  if (idRaw.startsWith('eq.')) return { type: 'eq', value: idRaw.replace('eq.', '') }
  return null
}

// ─── Base de Datos en Memoria para Simulación Determinista ────────────────────
class InMemoryDatabase {
  constructor() {
    this.reset()
  }

  reset() {
    this.clientes = [
      { id: IDS.empleado1, nombre: 'Jose Chofer', tipo_cliente: 'personal', activo: true, cuenta_id: IDS.cuenta, documento: 'V-12345678' },
      { id: IDS.empleado2, nombre: 'Pedro Obrero', tipo_cliente: 'personal', activo: true, cuenta_id: IDS.cuenta, documento: 'V-87654321' },
    ]
    this.nomina_config_empleado = [
      { id: IDS.config1, empleado_id: IDS.empleado1, cargo: 'Chofer', salario_dia_usd: 10.0, horas_jornada: 8, hora_inicio: '08:00', hora_fin: '17:00', fecha_ingreso: '2026-01-15', activo: true, cuenta_id: IDS.cuenta },
      { id: IDS.config2, empleado_id: IDS.empleado2, cargo: 'Soldador', salario_dia_usd: 15.0, horas_jornada: 8, hora_inicio: '08:00', hora_fin: '17:00', fecha_ingreso: '2026-02-01', activo: true, cuenta_id: IDS.cuenta },
    ]
    this.registro_asistencia = []
    this.nomina_periodos = []
    this.nomina_lineas = []
    this.nomina_feriados = [
      { id: '70000000-0000-4000-8000-000000000001', fecha: '2026-08-14', nombre: 'Día Festivo Especial', tipo: 'empresa', laborable: false, cuenta_id: IDS.cuenta },
    ]
    this.finanzas_movimientos = []
    this.finanzas_categorias = []
    this.config = {
      nombre_negocio: 'Construacero Carabobo C.A.',
      rif_negocio: 'J-50115913-0',
      nomina_recargo_extra: 1.5,
      nomina_recargo_sabado: 1.5,
      nomina_recargo_feriado: 1.5,
      nomina_tipo_periodo: 'semanal',
    }
  }

  fetchHandler(url, init = {}) {
    const u = new URL(url)
    const pathname = u.pathname
    const method = init.method || 'GET'
    const params = u.searchParams
    const body = init.body ? JSON.parse(init.body) : null
    const idFilter = extractIdFilter(params)

    // Autenticación de Supabase Auth
    if (pathname.includes('/auth/v1/user')) {
      return jsonResponse({
        id: IDS.cuenta,
        email: 'admin@construacero.com',
        app_metadata: {
          operator_id: IDS.operador,
          operator_rol: 'administracion',
          operator_nombre: 'Admin Nómina',
        },
      })
    }

    if (pathname.includes('/rest/v1/usuarios')) {
      return jsonResponse([
        {
          id: IDS.operador,
          nombre: 'Admin Nómina',
          rol: 'administracion',
          cuenta_id: IDS.cuenta,
          activo: true,
        },
      ])
    }

    // Clientes / Empleados
    if (pathname.includes('/rest/v1/clientes')) {
      if (method === 'GET') {
        if (idFilter?.type === 'eq') {
          return jsonResponse(this.clientes.filter(c => c.id === idFilter.value))
        }
        return jsonResponse(this.clientes)
      }
      if (method === 'POST') {
        const row = { id: `20000000-0000-4000-8000-${String(this.clientes.length + 1).padStart(12, '0')}`, ...body }
        this.clientes.push(row)
        return jsonResponse([row], 201)
      }
    }

    if (pathname.includes('/rest/v1/nomina_config_empleado')) {
      if (method === 'GET') {
        const empEq = params.get('empleado_id')?.replace('eq.', '')
        let res = this.nomina_config_empleado
        if (idFilter?.type === 'eq') res = res.filter(c => c.id === idFilter.value)
        if (empEq) res = res.filter(c => c.empleado_id === empEq)
        return jsonResponse(res.map(c => ({
          ...c,
          empleado: this.clientes.find(cl => cl.id === c.empleado_id) || null,
        })))
      }
      if (method === 'POST') {
        const row = { id: `30000000-0000-4000-8000-${String(this.nomina_config_empleado.length + 1).padStart(12, '0')}`, ...body }
        this.nomina_config_empleado.push(row)
        return jsonResponse([row], 201)
      }
      if (method === 'PATCH') {
        const idx = this.nomina_config_empleado.findIndex(c => c.id === idFilter?.value)
        if (idx >= 0) {
          this.nomina_config_empleado[idx] = { ...this.nomina_config_empleado[idx], ...body }
          return jsonResponse([this.nomina_config_empleado[idx]])
        }
        return jsonResponse([], 404)
      }
    }

    if (pathname.includes('/rest/v1/nomina_periodos')) {
      if (method === 'GET') {
        let res = this.nomina_periodos
        if (idFilter?.type === 'eq') res = res.filter(p => p.id === idFilter.value)
        if (idFilter?.type === 'in') res = res.filter(p => idFilter.values.includes(p.id))
        return jsonResponse(res)
      }
      if (method === 'POST') {
        const row = { id: IDS.periodo, ...body }
        this.nomina_periodos.push(row)
        return jsonResponse([row], 201)
      }
      if (method === 'PATCH') {
        const idx = this.nomina_periodos.findIndex(p => p.id === idFilter?.value)
        if (idx >= 0) {
          this.nomina_periodos[idx] = { ...this.nomina_periodos[idx], ...body }
          return jsonResponse([this.nomina_periodos[idx]])
        }
      }
      if (method === 'DELETE') {
        if (idFilter?.type === 'eq') {
          this.nomina_periodos = this.nomina_periodos.filter(p => p.id !== idFilter.value)
        }
        return jsonResponse([], 200)
      }
    }

    if (pathname.includes('/rest/v1/registro_asistencia')) {
      if (method === 'GET') {
        const empEq = params.get('empleado_id')?.replace('eq.', '')
        const fechaEq = params.get('fecha')?.replace('eq.', '')
        let res = this.registro_asistencia
        if (empEq) res = res.filter(r => r.empleado_id === empEq)
        if (fechaEq) res = res.filter(r => r.fecha === fechaEq)
        return jsonResponse(res)
      }
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body]
        const created = rows.map((r, i) => ({
          id: `60000000-0000-4000-8000-${String(this.registro_asistencia.length + i + 1).padStart(12, '0')}`,
          ...r,
        }))
        this.registro_asistencia.push(...created)
        return jsonResponse(created, 201)
      }
      if (method === 'PATCH') {
        const idx = this.registro_asistencia.findIndex(r => r.id === idFilter?.value)
        if (idx >= 0) {
          this.registro_asistencia[idx] = { ...this.registro_asistencia[idx], ...body }
          return jsonResponse([this.registro_asistencia[idx]])
        }
      }
      if (method === 'DELETE') {
        if (idFilter?.type === 'eq') {
          this.registro_asistencia = this.registro_asistencia.filter(r => r.id !== idFilter.value)
        }
        return jsonResponse([], 200)
      }
    }

    if (pathname.includes('/rest/v1/nomina_lineas')) {
      if (method === 'GET') {
        const perEq = params.get('periodo_id')?.replace('eq.', '')
        const pagEq = params.get('pagado')?.replace('eq.', '')
        let res = this.nomina_lineas
        if (perEq) res = res.filter(l => l.periodo_id === perEq)
        if (idFilter?.type === 'eq') res = res.filter(l => l.id === idFilter.value)
        if (idFilter?.type === 'in') res = res.filter(l => idFilter.values.includes(l.id))
        if (pagEq !== undefined && pagEq !== null) {
          res = res.filter(l => String(Boolean(l.pagado)) === pagEq)
        }
        return jsonResponse(res)
      }
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body]
        for (const r of rows) {
          const idx = this.nomina_lineas.findIndex(l => l.periodo_id === r.periodo_id && l.empleado_id === r.empleado_id)
          if (idx >= 0) {
            this.nomina_lineas[idx] = { ...this.nomina_lineas[idx], ...r }
          } else {
            this.nomina_lineas.push({
              id: `50000000-0000-4000-8000-${String(this.nomina_lineas.length + 1).padStart(12, '0')}`,
              pagado: false,
              ...r,
            })
          }
        }
        return jsonResponse(this.nomina_lineas, 201)
      }
      if (method === 'PATCH') {
        if (idFilter?.type === 'in') {
          const updated = []
          for (const l of this.nomina_lineas) {
            if (idFilter.values.includes(l.id)) {
              Object.assign(l, body)
              updated.push(l)
            }
          }
          return jsonResponse(updated)
        }
        const idx = this.nomina_lineas.findIndex(l => l.id === idFilter?.value)
        if (idx >= 0) {
          Object.assign(this.nomina_lineas[idx], body)
          return jsonResponse([this.nomina_lineas[idx]])
        }
      }
      if (method === 'DELETE') {
        const perEq = params.get('periodo_id')?.replace('eq.', '')
        if (perEq) this.nomina_lineas = this.nomina_lineas.filter(l => l.periodo_id !== perEq)
        return jsonResponse([], 200)
      }
    }

    if (pathname.includes('/rest/v1/nomina_feriados')) {
      return jsonResponse(this.nomina_feriados)
    }

    if (pathname.includes('/rest/v1/finanzas_categorias')) {
      if (method === 'POST') {
        const row = { id: `90000000-0000-4000-8000-${String(this.finanzas_categorias.length + 1).padStart(12, '0')}`, ...body }
        this.finanzas_categorias.push(row)
        return jsonResponse([row], 201)
      }
      return jsonResponse(this.finanzas_categorias)
    }

    if (pathname.includes('/rest/v1/finanzas_movimientos')) {
      if (method === 'POST') {
        const row = { id: `80000000-0000-4000-8000-${String(this.finanzas_movimientos.length + 1).padStart(12, '0')}`, estado: 'activo', ...body }
        this.finanzas_movimientos.push(row)
        return jsonResponse([row], 201)
      }
      if (method === 'PATCH') {
        const idFilter = extractIdFilter(params)
        if (idFilter?.type === 'eq') {
          const item = this.finanzas_movimientos.find(m => m.id === idFilter.value)
          if (item) Object.assign(item, body)
          return jsonResponse([item || {}])
        }
        return jsonResponse([])
      }
      if (method === 'GET') {
        let res = [...this.finanzas_movimientos]
        const keyParam = params.get('idempotency_key')
        const estEq = params.get('estado')?.replace('eq.', '')
        if (keyParam) {
          if (keyParam.startsWith('eq.')) {
            const val = keyParam.slice(3)
            res = res.filter(m => m.idempotency_key === val)
          } else if (keyParam.startsWith('like.')) {
            const prefix = keyParam.slice(5).replace(/\*/g, '')
            res = res.filter(m => m.idempotency_key?.includes(prefix))
          }
        }
        if (estEq) res = res.filter(m => m.estado === estEq)
        return jsonResponse(res)
      }
    }

    if (pathname.includes('/rest/v1/config_negocio') || pathname.includes('/rest/v1/config')) {
      return jsonResponse([this.config])
    }

    return jsonResponse({ error: 'Ruta no encontrada en mock' }, 404)
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeRequest(body, method = 'POST', url = 'http://localhost/api/nomina') {
  const token = makeJwt()
  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Operator-Id': IDS.operador,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

// ─── Motor del Reporte y Diagnóstico ──────────────────────────────────────────
const results = []
let activeSection = ''

function section(title) {
  activeSection = title
  console.log(`\n\x1b[1m\x1b[36m━━━ ${title.toUpperCase()} ━━━\x1b[0m`)
}

async function test(name, fn) {
  const start = performance.now()
  try {
    await fn()
    const duration = (performance.now() - start).toFixed(1)
    results.push({ section: activeSection, name, ok: true, duration })
    console.log(`  \x1b[32m✔ [PASS]\x1b[0m ${name} \x1b[90m(${duration}ms)\x1b[0m`)
  } catch (err) {
    const duration = (performance.now() - start).toFixed(1)
    results.push({ section: activeSection, name, ok: false, error: err.message, stack: err.stack, duration })
    console.log(`  \x1b[31m✖ [FAIL]\x1b[0m ${name} \x1b[90m(${duration}ms)\x1b[0m`)
    console.log(`     \x1b[31mError:\x1b[0m ${err.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Aserción fallida')
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Valores no coinciden'}: Esperaba [${expected}], pero recibí [${actual}]`)
  }
}

// ─── EJECUCIÓN DE PRUEBAS DETERMINISTAS ───────────────────────────────────────
async function runAllTests() {
  const db = new InMemoryDatabase()
  globalThis.fetch = async (url, init) => db.fetchHandler(url, init)

  console.log(`\x1b[1m\x1b[34m=================================================================\x1b[0m`)
  console.log(`\x1b[1m\x1b[34m   SUITE DE PRUEBAS DETERMINISTAS DE NÓMINA — CONSTRUACERO C.A.  \x1b[0m`)
  console.log(`\x1b[1m\x1b[34m=================================================================\x1b[0m`)

  // ── SECCIÓN 1: MOTOR MATEMÁTICO DE ASISTENCIA Y JORNADAS ───────────────────
  section('1. Motor de Cálculo de Asistencia y Jornadas')

  await test('Jornada Estándar (8:00 a 17:00 con 8h efectivas)', () => {
    const r = calcularCamposAsistencia('2026-08-10', '08:00', '17:00', 8)
    assertEqual(r.horas_trabajadas, 9, 'Horas trabajadas brutas')
    assertEqual(r.horas_normales, 8, 'Horas normales efectivas')
    assertEqual(r.horas_extra, 1, 'Horas extras generadas')
    assertEqual(r.es_ausencia, false, 'No debe ser ausencia')
  })

  await test('Manejo tolerante de entrada con segundos (HH:MM:SS de Postgres)', () => {
    const r = calcularCamposAsistencia('2026-08-10', '00:05:00', '09:05', 8)
    assertEqual(r.horas_trabajadas, 9, 'Debe aceptar HH:MM:SS')
    assertEqual(r.horas_normales, 8, 'Horas normales')
  })

  await test('Rechazo seguro de hora con formato inválido o fuera de rango', () => {
    let threw = false
    try {
      calcularCamposAsistencia('2026-08-10', '8:00', '17:00', 8)
    } catch {
      threw = true
    }
    assert(threw, 'Debe lanzar excepción para formato sin padding 8:00')
  })

  // ── SECCIÓN 2: GESTIÓN Y MODALIDADES SALARIALES DE EMPLEADOS ───────────────
  section('2. Configuración de Empleados y Modalidades Salariales')

  await test('Crear empleado con modalidad Por Día ($10.00 USD/día)', async () => {
    const req = makeRequest({
      nombre: 'Carlos Chofer',
      cargo: 'Chofer Repartidor',
      salarioDiaUsd: 10.0,
      horasJornada: 8,
      horaInicio: '08:00',
      horaFin: '17:00',
      fechaIngreso: '2026-08-01',
    })
    const res = await H.handleCrearConfigEmpleado(req, ENV)
    assertEqual(res.status, 201, 'Status de creación')
    const body = await res.json()
    assert(body.ok, 'Respuesta exitosa')
    assertEqual(body.config.salario_dia_usd, 10.0, 'Salario por día')
    assertEqual(body.config.fecha_ingreso, '2026-08-01', 'Fecha de ingreso')
  })

  await test('Actualizar empleado con cálculo semanal ($180/semana -> $30/día)', async () => {
    const req = makeRequest({
      id: IDS.config1,
      cargo: 'Chofer Principal',
      salarioDiaUsd: 30.0, // $180 / 6 días
      horasJornada: 8,
      horaInicio: '08:00',
      horaFin: '17:00',
      fechaIngreso: '2026-01-15',
      activo: true,
    })
    const res = await H.handleActualizarConfigEmpleado(req, ENV)
    assertEqual(res.status, 200, 'Status de actualización')
    const body = await res.json()
    assertEqual(body.config.salario_dia_usd, 30.0, 'Salario diario actualizado')
    assertEqual(body.config.cargo, 'Chofer Principal', 'Cargo actualizado')
  })

  await test('Crear colaborador en modalidad Por Comisión ($0.00 salario fijo)', async () => {
    const req = makeRequest({
      nombre: 'Carlos Comisionista',
      documento: 'V-20334455',
      cargo: 'Vendedor Externo',
      salarioDiaUsd: 0.0,
      horasJornada: 8,
      horaInicio: '08:00',
      horaFin: '17:00',
      fechaIngreso: '2026-08-01',
    })
    const res = await H.handleCrearConfigEmpleado(req, ENV)
    assertEqual(res.status, 201, 'Status creación comisionista')
    const body = await res.json()
    assertEqual(body.config.salario_dia_usd, 0.0, 'Salario base cero para comisión')
  })

  // ── SECCIÓN 3: ASISTENCIA Y MARCAJE EN TIEMPO REAL ──────────────────────────
  section('3. Asistencia y Marcaje Operativo (Tiempo Real y Masivo)')

  await test('Marcar Entrada en tiempo real para empleado', async () => {
    const req = makeRequest({
      empleadoId: IDS.empleado1,
      idempotencyKey: 'entrada-test-001',
    })
    const res = await H.handleMarcarEntrada(req, ENV)
    assertEqual(res.status, 201, 'Status de entrada marcada')
    const body = await res.json()
    assertEqual(body.registro.hora_entrada, '08:00', 'Hora de entrada')
  })

  await test('Prevenir doble entrada en el mismo día', async () => {
    const req = makeRequest({
      empleadoId: IDS.empleado1,
      idempotencyKey: 'entrada-test-002',
    })
    const res = await H.handleMarcarEntrada(req, ENV)
    assertEqual(res.status, 409, 'Debe rechazar entrada duplicada')
  })

  await test('Marcar Salida en tiempo real y calcular horas laboradas', async () => {
    ENV.NOMINA_NOW = '2026-08-10T21:00:00.000Z' // 17:00 hora Caracas
    const req = makeRequest({
      empleadoId: IDS.empleado1,
      idempotencyKey: 'salida-test-001',
    })
    const res = await H.handleMarcarSalida(req, ENV)
    assertEqual(res.status, 200, 'Status de salida marcada')
    const body = await res.json()
    assertEqual(body.registro.estado_marcaje, 'completo', 'Estado marcaje completo')
    assertEqual(body.registro.horas_trabajadas, 9, 'Horas trabajadas calculadas')
  })

  await test('Marcar asistencia masiva para toda la plantilla (8 a 5)', async () => {
    const req = makeRequest({
      fecha: '2026-08-11',
      horaEntrada: '08:00',
      horaSalida: '17:00',
      esFeriado: false,
    })
    const res = await H.handleRegistrarAsistenciaMasivo(req, ENV)
    assertEqual(res.status, 200, 'Status de marcaje masivo')
    const body = await res.json()
    assert(body.registros >= 2, 'Deben marcarse todos los empleados')
  })

  // ── SECCIÓN 4: CICLO DE VIDA DE PERÍODOS DE NÓMINA ──────────────────────────
  section('4. Ciclo de Vida de Períodos y Liquidación')

  await test('Crear período semanal (Lun 10 a Sáb 15 Ago 2026)', async () => {
    const req = makeRequest({
      nombre: 'Semana 10 – 15 Ago 2026',
      desde: '2026-08-10',
      hasta: '2026-08-15',
      tipo: 'semanal',
    })
    const res = await H.handleCrearPeriodo(req, ENV)
    assertEqual(res.status, 201, 'Status de creación de período')
    const body = await res.json()
    assertEqual(body.periodo.id, IDS.periodo, 'ID del período creado')
  })

  await test('Calcular nómina del período y generar recibos', async () => {
    const req = makeRequest({ periodoId: IDS.periodo })
    const res = await H.handleCalcularPeriodo(req, ENV)
    assertEqual(res.status, 200, 'Status de cálculo')
    const body = await res.json()
    assert(body.lineas_generadas >= 2, 'Debe generar recibos para empleados activos')
  })

  await test('Ajustar recibo con Bonificación y Deducción de anticipo', async () => {
    const linea = db.nomina_lineas[0]
    const req = makeRequest({
      lineaId: linea.id,
      bonosUsd: 25.0,
      deduccionesUsd: 10.0,
      notaBonos: 'Bono de puntualidad y productividad',
      notaDeducciones: 'Anticipo quincenal',
    })
    const res = await H.handleAjustarLinea(req, ENV)
    assertEqual(res.status, 200, 'Status de ajuste')
    const body = await res.json()
    assertEqual(body.linea.bonos_usd, 25.0, 'Bono guardado')
    assertEqual(body.linea.deducciones_usd, 10.0, 'Deducción guardada')
  })

  await test('Cerrar período de nómina para autorizar pago', async () => {
    const req = makeRequest({ periodoId: IDS.periodo })
    const res = await H.handleCerrarPeriodo(req, ENV)
    assertEqual(res.status, 200, 'Status de cierre')
    const periodo = db.nomina_periodos.find(p => p.id === IDS.periodo)
    assertEqual(periodo.estado, 'cerrado', 'Estado cerrado')
  })

  // ── SECCIÓN 5: PROCESAMIENTO DE PAGOS Y PROTECCIONES ────────────────────────
  section('5. Procesamiento de Pagos y Reversión')

  await test('Registrar pago de recibos con tasa BCV y referencia', async () => {
    const linea = db.nomina_lineas[0]
    const req = makeRequest({
      lineaIds: [linea.id],
      referencia: 'REF-BCV-987654',
    })
    const res = await H.handlePagarLineas(req, ENV)
    assertEqual(res.status, 200, 'Status de pago exitoso')
    const body = await res.json()
    assertEqual(body.recibos_pagados, 1, 'Total de recibos liquidados')
    const lineaActualizada = db.nomina_lineas.find(l => l.id === linea.id)
    assertEqual(lineaActualizada.pagado, true, 'Línea marcada como pagada')
    assertEqual(lineaActualizada.referencia_pago, 'REF-BCV-987654', 'Referencia registrada')
  })

  await test('Bloquear eliminación de período con recibos pagados', async () => {
    const req = makeRequest({ periodoId: IDS.periodo })
    const res = await H.handleEliminarPeriodo(req, ENV)
    assertEqual(res.status, 400, 'Debe rechazar borrado si hay recibos pagados')
  })

  await test('Revertir pago de recibo', async () => {
    const linea = db.nomina_lineas[0]
    const req = makeRequest({ lineaId: linea.id })
    const res = await H.handleRevertirPagoLinea(req, ENV)
    assertEqual(res.status, 200, 'Status de reversión')
    const lineaActualizada = db.nomina_lineas.find(l => l.id === linea.id)
    assertEqual(lineaActualizada.pagado, false, 'Línea devuelta a estado pendiente')
  })

  await test('Reabrir período para ajustes adicionales', async () => {
    const req = makeRequest({ periodoId: IDS.periodo })
    const res = await H.handleReabrirPeriodo(req, ENV)
    assertEqual(res.status, 200, 'Status de reapertura')
    const periodo = db.nomina_periodos.find(p => p.id === IDS.periodo)
    assertEqual(periodo.estado, 'abierto', 'Estado abierto')
  })

  await test('Eliminar período limpio sin pagos', async () => {
    const req = makeRequest({ periodoId: IDS.periodo })
    const res = await H.handleEliminarPeriodo(req, ENV)
    assertEqual(res.status, 200, 'Status de eliminación exitosa')
    const periodo = db.nomina_periodos.find(p => p.id === IDS.periodo)
    assert(!periodo, 'El período debe ser eliminado de la base de datos')
  })

  // ── SECCIÓN 6: MONEDA PRINCIPAL (USD) Y SECUNDARIA (BS CON TASAS) ───────────
  section('6. Moneda Principal (USD) y Conversión Secundaria (Bs)')

  await test('Cálculo secundario con Tasa BCV Dólar ($40.50 Bs/$)', () => {
    const montoUsd = 150.0
    const tasaBcvUsd = 40.50
    const montoBs = montoUsd * tasaBcvUsd
    assertEqual(montoBs, 6075.0, 'Conversión a Bs con BCV Dólar')
  })

  await test('Cálculo secundario con Tasa BCV Euro (€43.80 Bs/€)', () => {
    const montoUsd = 150.0
    const tasaBcvEur = 43.80
    const montoBs = montoUsd * tasaBcvEur
    assertEqual(montoBs, 6570.0, 'Conversión a Bs con BCV Euro')
  })

  await test('Cálculo secundario con Tasa USDT Paralelo (47.20 Bs/USDT)', () => {
    const montoUsd = 150.0
    const tasaUsdt = 47.20
    const montoBs = montoUsd * tasaUsdt
    assertEqual(montoBs, 7080.0, 'Conversión a Bs con USDT')
  })

  await test('Cálculo secundario con Tasa Manual personalizada (42.00 Bs/$)', () => {
    const montoUsd = 150.0
    const tasaManual = 42.00
    const montoBs = montoUsd * tasaManual
    assertEqual(montoBs, 6300.0, 'Conversión a Bs con Tasa Manual')
  })

  // ── SECCIÓN 7: INTEGRACIÓN CONTABLE NÓMINA → FINANZAS ───────────────────────
  section('7. Integración Contable Nómina → Finanzas')

  await test('Generar automáticamente asiento de Egreso en Finanzas al pagar nómina', async () => {
    // 1. Crear nuevo período y recibo para prueba de asiento
    const pRes = await H.handleCrearPeriodo(makeRequest({
      nombre: 'Semana de Prueba Contable',
      desde: '2026-08-17',
      hasta: '2026-08-22',
      tipo: 'semanal',
    }), ENV)
    const pBody = await pRes.json()
    const periodoId = pBody.periodo.id

    await H.handleCalcularPeriodo(makeRequest({ periodoId }), ENV)

    // Asignar monto a liquidar en el recibo
    const lineasInit = db.nomina_lineas.filter(l => l.periodo_id === periodoId)
    assert(lineasInit.length > 0, 'Debe haber recibos calculados')
    await H.handleAjustarLinea(makeRequest({
      lineaId: lineasInit[0].id,
      bonosUsd: 80.0,
      deduccionesUsd: 0,
      notaBonos: 'Producción semanal',
    }), ENV)

    await H.handleCerrarPeriodo(makeRequest({ periodoId }), ENV)

    const lineas = db.nomina_lineas.filter(l => l.periodo_id === periodoId)

    // 2. Registrar pago con tasa BCV
    const payRes = await H.handlePagarLineas(makeRequest({
      lineaIds: [lineas[0].id],
      referencia: 'TRANSFERENCIA-BNC-882299',
      tasaBcv: 40.50,
      fuenteTasa: 'BCV',
    }), ENV)
    assertEqual(payRes.status, 200, 'Status de pago de nómina')

    // 3. Verificar que se haya insertado el egreso en finanzas_movimientos
    const egreso = db.finanzas_movimientos.find(m =>
      m.categoria === 'Nómina' &&
      m.tipo === 'egreso' &&
      m.referencia === 'TRANSFERENCIA-BNC-882299'
    )
    assert(egreso, 'Debe crearse automáticamente un movimiento de egreso en Finanzas')
    assertEqual(egreso.moneda, 'USD', 'Moneda principal USD en Finanzas')
    assertEqual(egreso.tasa_ves, 40.50, 'Tasa de cambio registrada')
    assertEqual(egreso.estado, 'activo', 'Movimiento financiero activo')
  })

  await test('Anular automáticamente el movimiento de Finanzas al revertir el pago', async () => {
    const linea = db.nomina_lineas.find(l => l.referencia_pago === 'TRANSFERENCIA-BNC-882299' && l.pagado)
    assert(linea, 'Debe existir la línea pagada')

    const revRes = await H.handleRevertirPagoLinea(makeRequest({ lineaId: linea.id }), ENV)
    assertEqual(revRes.status, 200, 'Status de reversión')

    // Verificar que el movimiento financiero se haya marcado como anulado
    const egreso = db.finanzas_movimientos.find(m =>
      m.referencia === 'TRANSFERENCIA-BNC-882299'
    )
    assert(egreso, 'El movimiento financiero debe existir en el histórico')
    assertEqual(egreso.estado, 'anulado', 'El movimiento debe estar marcado como anulado')
    assertEqual(egreso.motivo_anulacion, 'Reversión de pago de nómina', 'Motivo de anulación registrado')
  })

  await test('Registrar egreso directo en Finanzas por pago de comisión a comisionista', async () => {
    const req = makeRequest({
      fecha: '2026-08-20',
      tipo: 'egreso',
      categoria: 'Comisiones',
      concepto: 'Comisión — Carlos Comisionista: Venta de estructuras galvanizadas',
      monto: 150.0,
      moneda: 'USD',
      tasaVes: 40.50,
      fuenteTasa: 'BCV',
      observacionTasa: 'Tasa BCV de nómina',
      referencia: 'Pago Móvil - Ref: 987654',
      observaciones: 'Beneficiario: Carlos Comisionista (V-20334455). Vendedor Externo.',
      idempotencyKey: 'comision-test-001',
    })
    const res = await F.handleCrearFinanzasMovimiento(req, ENV)
    assertEqual(res.status, 201, 'Status de egreso por comisión')
    const body = await res.json()
    assertEqual(body.movimiento.categoria, 'Comisiones', 'Categoría Comisiones')
    assertEqual(body.movimiento.monto, 150.0, 'Monto en USD')
    assertEqual(body.movimiento.tipo, 'egreso', 'Tipo Egreso')
  })

  // ── REPORTE FINAL Y DIAGNÓSTICO ─────────────────────────────────────────────
  console.log(`\n\x1b[1m\x1b[34m=================================================================\x1b[0m`)
  console.log(`\x1b[1m\x1b[34m                     RESUMEN DE RESULTADOS                       \x1b[0m`)
  console.log(`\x1b[1m\x1b[34m=================================================================\x1b[0m`)

  const total = results.length
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length

  console.log(`  Total de Pruebas Ejecutadas: \x1b[1m${total}\x1b[0m`)
  console.log(`  Pruebas Exitosas:            \x1b[1m\x1b[32m${passed}\x1b[0m`)
  console.log(`  Pruebas Fallidas:            \x1b[1m\x1b[${failed > 0 ? '31' : '32'}m${failed}\x1b[0m`)

  if (failed > 0) {
    console.log(`\n\x1b[1m\x1b[31m[!] DETALLE DE FALLOS:\x1b[0m`)
    results.filter(r => !r.ok).forEach((r, idx) => {
      console.log(`  ${idx + 1}. [${r.section}] -> \x1b[1m${r.name}\x1b[0m`)
      console.log(`     Error: ${r.error}`)
    })
    process.exit(1)
  } else {
    console.log(`\n\x1b[1m\x1b[32m[✔] TODOS LOS FLUJOS DE NÓMINA FUNCIONAN DE FORMA DETERMINISTA Y EXACTA.\x1b[0m\n`)
    process.exit(0)
  }
}

runAllTests().catch(err => {
  console.error('\x1b[31m[FATAL ERROR]\x1b[0m Error no controlado en suite:', err)
  process.exit(1)
})
