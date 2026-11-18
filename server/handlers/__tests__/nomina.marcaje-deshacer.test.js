// M-6 (PLAN_MARCAJE_BOTONES_UX): deshacer un toque equivocado en «Marcar entrada» o
// «Marcar salida» durante VENTANA_DESHACER_SEGUNDOS, solo con la clave de
// idempotencia de esa acción (la tiene únicamente el dispositivo que la hizo).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.nomina
vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn(async () => authOk(operadorActual)) }))
const registrarAuditoria = vi.fn(async () => {})
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: (...args) => registrarAuditoria(...args) }))

const H = await import('../nomina.js')
let mock
afterEach(() => { mock?.restore(); operadorActual = OPERADORES.nomina; vi.clearAllMocks() })

// 2026-08-03 (lunes) 12:46:00 UTC = 08:46 en Caracas: 60 s después de la entrada.
const ENV_HOY = { ...ENV, NOMINA_NOW: '2026-08-03T12:46:00.000Z' }
const ENV_TARDE = { ...ENV, NOMINA_NOW: '2026-08-03T12:48:01.000Z' }

const entrada = {
  id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-03',
  hora_entrada: '08:45:00', hora_salida: null, es_ausencia: false, estado_marcaje: 'entrada',
  horas_trabajadas: 0, horas_normales: 0, horas_extra: 0, horas_descanso: null,
  entrada_marcada_en: '2026-08-03T12:45:00.000Z', entrada_idempotency_key: 'entrada-emp-clave-1',
  salida_marcada_en: null, salida_idempotency_key: null,
}
const completa = {
  ...entrada, hora_entrada: '08:00:00', hora_salida: '08:45:00', estado_marcaje: 'completo',
  horas_trabajadas: 0.75, horas_normales: 0.75, horas_descanso: 0,
  entrada_marcada_en: '2026-08-03T12:00:00.000Z', entrada_idempotency_key: 'entrada-emp-clave-0',
  salida_marcada_en: '2026-08-03T12:45:00.000Z', salida_idempotency_key: 'salida-emp-clave-1',
}

function rutas(registro, escritura = null) {
  return [
    { match: '/nomina_periodos', respond: [] },
    { match: '/registro_asistencia', method: 'GET', respond: registro ? [registro] : [] },
    ...(escritura ? [escritura] : []),
  ]
}
const escrituras = () => mock.calls.filter(call => ['POST', 'PATCH', 'DELETE'].includes(call.method))
async function deshacer(body, env = ENV_HOY) {
  return readResponse(await H.handleDeshacerMarcaje(makeRequest({ registroId: IDS.registro, ...body }), env))
}

describe('deshacer marcaje (M-6)', () => {
  it('deshace una entrada recién marcada con un DELETE condicional y lo audita', async () => {
    mock = installFetchMock(rutas(entrada, { match: '/registro_asistencia', method: 'DELETE', respond: [{ id: IDS.registro }] }))
    const { status, body } = await deshacer({ tipo: 'entrada', idempotencyKey: 'entrada-emp-clave-1' })
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, tipo: 'entrada', registro: null })
    const [borrado] = escrituras()
    expect(borrado.method).toBe('DELETE')
    for (const filtro of ['estado_marcaje=eq.entrada', 'entrada_idempotency_key=eq.entrada-emp-clave-1', 'hora_salida=is.null', 'es_ausencia=eq.false', 'cuenta_id=eq.']) {
      expect(borrado.url).toContain(filtro)
    }
    expect(registrarAuditoria).toHaveBeenCalledWith(ENV_HOY, expect.any(Object), expect.objectContaining({
      accion: 'DESHACER_ENTRADA', entidadId: IDS.registro,
      meta: expect.objectContaining({ antes: expect.objectContaining({ hora_entrada: '08:45:00' }) }),
    }))
  })

  it('deshace una salida recién marcada: la jornada vuelve a estar abierta y sin horas', async () => {
    let cambios = null
    mock = installFetchMock(rutas(completa, { match: '/registro_asistencia', method: 'PATCH', respond: (_url, init) => {
      cambios = JSON.parse(init.body)
      return [{ id: IDS.registro, hora_salida: null, estado_marcaje: 'entrada' }]
    } }))
    const { status, body } = await deshacer({ tipo: 'salida', idempotencyKey: 'salida-emp-clave-1' })
    expect(status).toBe(200)
    expect(body.registro).toMatchObject({ estado_marcaje: 'entrada', hora_salida: null })
    expect(cambios).toMatchObject({
      hora_salida: null, horas_trabajadas: 0, horas_normales: 0, horas_extra: 0, horas_descanso: null,
      estado_marcaje: 'entrada', salida_marcada_en: null, salida_por: null, salida_idempotency_key: null,
    })
    const patch = escrituras()[0]
    expect(patch.url).toContain('salida_idempotency_key=eq.salida-emp-clave-1')
    expect(patch.url).toContain('hora_salida=eq.08%3A45%3A00')
    expect(registrarAuditoria).toHaveBeenCalledWith(ENV_HOY, expect.any(Object), expect.objectContaining({ accion: 'DESHACER_SALIDA' }))
  })

  it('una salida de un marcaje corregido vuelve a «corregido», no a «entrada»', async () => {
    let cambios = null
    mock = installFetchMock(rutas({ ...completa, estado_marcaje: 'corregido' }, { match: '/registro_asistencia', method: 'PATCH', respond: (_url, init) => {
      cambios = JSON.parse(init.body)
      return [{ id: IDS.registro }]
    } }))
    const { status } = await deshacer({ tipo: 'salida', idempotencyKey: 'salida-emp-clave-1' })
    expect(status).toBe(200)
    expect(cambios.estado_marcaje).toBe('corregido')
  })

  it('con otra clave responde 403 sin escribir', async () => {
    mock = installFetchMock(rutas(entrada))
    const { status } = await deshacer({ tipo: 'entrada', idempotencyKey: 'entrada-de-otro-equipo' })
    expect(status).toBe(403)
    expect(escrituras()).toHaveLength(0)
  })

  it(`pasada la ventana responde 409 sin escribir`, async () => {
    mock = installFetchMock(rutas(entrada))
    const { status, body } = await deshacer({ tipo: 'entrada', idempotencyKey: 'entrada-emp-clave-1' }, ENV_TARDE)
    expect(status).toBe(409)
    expect(body.error).toMatch(/Corregir|anular/i)
    expect(escrituras()).toHaveLength(0)
  })

  it('no deshace la entrada de una jornada que ya tiene salida', async () => {
    mock = installFetchMock(rutas({ ...completa, entrada_marcada_en: '2026-08-03T12:45:30.000Z', entrada_idempotency_key: 'entrada-emp-clave-1' }))
    const { status } = await deshacer({ tipo: 'entrada', idempotencyKey: 'entrada-emp-clave-1' })
    expect(status).toBe(409)
    expect(escrituras()).toHaveLength(0)
  })

  it('si la fila cambió entre la lectura y la escritura responde 409 y no audita', async () => {
    mock = installFetchMock(rutas(entrada, { match: '/registro_asistencia', method: 'DELETE', respond: [] }))
    const { status } = await deshacer({ tipo: 'entrada', idempotencyKey: 'entrada-emp-clave-1' })
    expect(status).toBe(409)
    expect(registrarAuditoria).not.toHaveBeenCalled()
  })

  it('no deshace en un período cerrado ni un registro de otra fecha', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [{ nombre: 'Semana 32', estado: 'cerrado' }] },
      { match: '/registro_asistencia', method: 'GET', respond: [entrada] },
    ])
    expect((await deshacer({ tipo: 'entrada', idempotencyKey: 'entrada-emp-clave-1' })).status).toBe(400)
    mock.restore()
    mock = installFetchMock(rutas({ ...entrada, fecha: '2026-08-02' }))
    expect((await deshacer({ tipo: 'entrada', idempotencyKey: 'entrada-emp-clave-1' })).status).toBe(400)
    expect(escrituras()).toHaveLength(0)
  })

  it('valida el cuerpo y el permiso antes de consultar', async () => {
    mock = installFetchMock([])
    expect((await deshacer({ tipo: 'ausencia', idempotencyKey: 'entrada-emp-clave-1' })).status).toBe(400)
    expect((await deshacer({ tipo: 'entrada', idempotencyKey: 'x' })).status).toBe(400)
    operadorActual = OPERADORES.logistica
    expect((await deshacer({ tipo: 'entrada', idempotencyKey: 'entrada-emp-clave-1' })).status).toBe(403)
    expect(mock.calls).toHaveLength(0)
  })
})
