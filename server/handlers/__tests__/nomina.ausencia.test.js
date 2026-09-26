// server/handlers/__tests__/nomina.ausencia.test.js
// Ausencia del reloj real: solo en día laborable y, desde F-6, nunca en un feriado
// que no sea laborable (nadie está obligado a asistir: sería una falta inventada).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion
vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
}))
const registrarAuditoria = vi.fn(async () => {})
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: (...args) => registrarAuditoria(...args) }))

const H = await import('../nomina.js')
let mock
afterEach(() => { mock?.restore(); operadorActual = OPERADORES.administracion; vi.clearAllMocks() })

// 2026-08-03 es lunes; 14:00 UTC = 10:00 en America/Caracas.
const ENV_HOY = { ...ENV, NOMINA_NOW: '2026-08-03T14:00:00.000Z' }
const periodosAbiertos = { match: '/nomina_periodos', respond: [] }
const config = { match: '/nomina_config_empleado', respond: [{ horas_jornada: 8 }] }

function rutas({ feriado = null, horarios = [], registro = [] } = {}) {
  return [
    periodosAbiertos,
    config,
    { match: '/registro_asistencia', method: 'GET', respond: registro },
    { match: '/nomina_horarios', respond: horarios },
    { match: '/nomina_feriados', respond: feriado ? [feriado] : [] },
  ]
}

describe('ausencia del reloj real', () => {
  it('registra la ausencia de un día laborable con estado manual y horas en cero', async () => {
    let inserted = null
    mock = installFetchMock([
      ...rutas(),
      { match: '/registro_asistencia', method: 'POST', respond: (url, init) => {
        inserted = JSON.parse(init.body)
        return [{ id: IDS.registro, estado_marcaje: 'manual' }]
      } },
    ])
    const { status, body } = await readResponse(await H.handleMarcarAusencia(
      makeRequest({ empleadoId: IDS.empleado }), ENV_HOY
    ))
    expect(status).toBe(201)
    expect(body.registro.id).toBe(IDS.registro)
    expect(inserted).toMatchObject({
      empleado_id: IDS.empleado, fecha: '2026-08-03', es_ausencia: true,
      estado_marcaje: 'manual', horas_trabajadas: 0, hora_entrada: null, hora_salida: null,
    })
  })

  it('permite al rol Nómina anular una entrada real abierta y audita la ausencia resultante', async () => {
    operadorActual = OPERADORES.nomina
    let actualizado = null
    const entrada = {
      id: IDS.registro,
      empleado_id: IDS.empleado,
      fecha: '2026-08-03',
      hora_entrada: '08:45:00',
      hora_salida: null,
      horas_trabajadas: 0,
      horas_normales: 0,
      horas_extra: 0,
      horas_descanso: 0,
      es_sabado: false,
      es_domingo: false,
      es_feriado: false,
      es_ausencia: false,
      estado_marcaje: 'entrada',
      entrada_marcada_en: '2026-08-03T12:45:00.000Z',        entrada_por: OPERADORES.nomina.id,

      entrada_idempotency_key: 'entrada-erronea-123',
    }
    mock = installFetchMock([
      ...rutas({ registro: [entrada] }),
      { match: '/registro_asistencia', method: 'PATCH', respond: (_url, init) => {
        actualizado = JSON.parse(init.body)
        return [{ id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-03', es_ausencia: true, estado_marcaje: 'manual', hora_entrada: null }]
      } },
    ])

    const { status, body } = await readResponse(await H.handleAnularEntradaComoAusencia(makeRequest({
      registroId: IDS.registro,
      motivo: 'Entrada marcada por error; el empleado estuvo ausente',
    }), ENV_HOY))

    expect(status).toBe(200)
    expect(body.registro).toMatchObject({ es_ausencia: true, estado_marcaje: 'manual', hora_entrada: null })
    expect(actualizado).toMatchObject({
      hora_entrada: null, hora_salida: null, horas_trabajadas: 0, horas_normales: 0,
      horas_extra: 0, es_ausencia: true, estado_marcaje: 'manual',
      entrada_marcada_en: null, entrada_por: null, entrada_idempotency_key: null,
      nota: 'Entrada marcada por error; el empleado estuvo ausente',
    })
    expect(actualizado).not.toHaveProperty('cuenta_id')
    expect(registrarAuditoria).toHaveBeenCalledWith(ENV_HOY, expect.any(Object), expect.objectContaining({
      accion: 'ANULAR_ENTRADA_MARCAR_AUSENCIA',
      entidadId: IDS.registro,
      meta: expect.objectContaining({
        motivo: 'Entrada marcada por error; el empleado estuvo ausente',
        entradaAnulada: expect.objectContaining({ hora: '08:45:00', marcadaPor: OPERADORES.nomina.id }),
        horasAnuladas: { trabajadas: 0, normales: 0, extra: 0 },
        estadoNuevo: 'ausencia',
      }),
    }))
  })

  it('no anula una jornada completa ni un registro de otra fecha', async () => {
    for (const overrides of [
      { hora_salida: '17:00:00', estado_marcaje: 'completo' },
      { fecha: '2026-08-02' },
    ]) {
      mock = installFetchMock([
        ...rutas({ registro: [{ id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-03', hora_entrada: '08:00:00', hora_salida: null, es_ausencia: false, estado_marcaje: 'entrada', ...overrides }] }),
      ])
      const { status } = await readResponse(await H.handleAnularEntradaComoAusencia(makeRequest({
        registroId: IDS.registro, motivo: 'Entrada fue marcada por error',
      }), ENV_HOY))
      expect(status).toBe(overrides.fecha ? 400 : 409)
      expect(mock.calls.some(call => ['POST', 'PATCH', 'DELETE'].includes(call.method))).toBe(false)
      mock.restore()
      mock = null
    }
  })

  it('no permite anular si el período ya no está abierto', async () => {
    mock = installFetchMock([
      { match: '/registro_asistencia', method: 'GET', respond: [{
        id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-03',
        hora_entrada: '08:00:00', hora_salida: null, es_ausencia: false, estado_marcaje: 'entrada',
      }] },
      { match: '/nomina_periodos', respond: [{ nombre: 'Semana 32', estado: 'cerrado' }] },
    ])

    const { status, body } = await readResponse(await H.handleAnularEntradaComoAusencia(makeRequest({
      registroId: IDS.registro, motivo: 'Entrada fue marcada por error',
    }), ENV_HOY))
    expect(status).toBe(400)
    expect(body.error).toMatch(/período está cerrado/i)
    expect(mock.calls.some(call => ['POST', 'PATCH', 'DELETE'].includes(call.method))).toBe(false)
  })

  it('rechaza motivo vacío y perfiles sin permiso antes de modificar', async () => {
    operadorActual = OPERADORES.administracion
    mock = installFetchMock([])
    const sinMotivo = await readResponse(await H.handleAnularEntradaComoAusencia(makeRequest({ registroId: IDS.registro, motivo: ' ' }), ENV_HOY))
    expect(sinMotivo.status).toBe(400)
    expect(mock.calls).toHaveLength(0)

    operadorActual = OPERADORES.logistica
    const sinPermiso = await readResponse(await H.handleAnularEntradaComoAusencia(makeRequest({ registroId: IDS.registro, motivo: 'Entrada errónea' }), ENV_HOY))
    expect(sinPermiso.status).toBe(403)
    expect(mock.calls).toHaveLength(0)
  })

  it('rechaza la ausencia en un feriado NO laborable sin escribir nada', async () => {
    mock = installFetchMock(rutas({
      feriado: { id: IDS.registro, fecha: '2026-08-03', nombre: 'Feriado patronal', laborable: false },
    }))
    const { status, body } = await readResponse(await H.handleMarcarAusencia(
      makeRequest({ empleadoId: IDS.empleado }), ENV_HOY
    ))
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/no es laborable/i)
    expect(mock.calls.some(call => ['POST', 'PATCH', 'DELETE'].includes(call.method))).toBe(false)
  })

  it('un feriado laborable sí admite la ausencia y la congela en el registro', async () => {
    let inserted = null
    mock = installFetchMock([
      ...rutas({ feriado: { id: IDS.registro, fecha: '2026-08-03', nombre: 'Feriado laborable', laborable: true } }),
      { match: '/registro_asistencia', method: 'POST', respond: (url, init) => {
        inserted = JSON.parse(init.body)
        return [{ id: IDS.registro, estado_marcaje: 'manual' }]
      } },
    ])
    const { status } = await readResponse(await H.handleMarcarAusencia(
      makeRequest({ empleadoId: IDS.empleado }), ENV_HOY
    ))
    expect(status).toBe(201)
    expect(inserted.es_feriado).toBe(true)
    expect(inserted.es_ausencia).toBe(true)
  })

  it('rechaza la ausencia en un día libre según su semana laboral', async () => {
    mock = installFetchMock(rutas({ horarios: [{ empleado_id: IDS.empleado, dia_semana: 2, trabaja: true }] }))
    const { status, body } = await readResponse(await H.handleMarcarAusencia(
      makeRequest({ empleadoId: IDS.empleado }), ENV_HOY
    ))
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/día libre/i)
    expect(mock.calls.some(call => call.method === 'POST')).toBe(false)
  })

  it('deshacer borra solo la ausencia manual de hoy', async () => {
    mock = installFetchMock([
      ...rutas({ registro: [{ id: IDS.registro, es_ausencia: true, estado_marcaje: 'manual' }] }),
      { match: '/registro_asistencia', method: 'DELETE', respond: [{ id: IDS.registro }] },
    ])
    const { status } = await readResponse(await H.handleMarcarAusencia(
      makeRequest({ empleadoId: IDS.empleado, quitar: true }), ENV_HOY
    ))
    expect(status).toBe(200)
    const borrado = mock.calls.find(call => call.method === 'DELETE')
    expect(borrado.url).toContain('es_ausencia=eq.true')
    expect(borrado.url).toContain('estado_marcaje=eq.manual')
  })

  it('no deshace un marcaje real del reloj', async () => {
    mock = installFetchMock([
      ...rutas({ registro: [{ id: IDS.registro, es_ausencia: false, estado_marcaje: 'completo' }] }),
    ])
    const { status, body } = await readResponse(await H.handleMarcarAusencia(
      makeRequest({ empleadoId: IDS.empleado, quitar: true }), ENV_HOY
    ))
    expect(status).toBe(409)
    expect(String(body.error)).toMatch(/corregir marcaje/i)
    expect(mock.calls.some(call => call.method === 'DELETE')).toBe(false)
  })
})
