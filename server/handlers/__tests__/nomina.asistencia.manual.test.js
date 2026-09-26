import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(OPERADORES.administracion)),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../nomina.js')
let mock
afterEach(() => { mock?.restore(); vi.clearAllMocks() })

const config = { match: '/nomina_config_empleado', respond: [{ horas_jornada: 8 }] }
const periodsOpen = { match: '/nomina_periodos', respond: [] }
const noHoliday = { match: '/nomina_feriados', respond: [] }

function body(patch = {}) {
  return {
    empleadoId: IDS.empleado,
    fecha: '2026-08-03',
    horaEntrada: '08:00',
    horaSalida: '17:00',
    esAusencia: false,
    esFeriado: false,
    ...patch,
  }
}

describe('safe manual attendance writes', () => {
  it('inserts a new manual row with the stored rest and manual marker state', async () => {
    let inserted
    mock = installFetchMock([
      periodsOpen,
      noHoliday,
      config,
      { match: '/registro_asistencia', method: 'GET', respond: [] },
      { match: '/registro_asistencia', method: 'POST', respond: (_url, init) => {
        inserted = JSON.parse(init.body)
        return [{ id: IDS.registro, estado_marcaje: 'manual' }]
      } },
    ])
    const result = await readResponse(await H.handleRegistrarAsistencia(makeRequest(body({ horasDescanso: 0.5 })), ENV))
    expect(result.status).toBe(201)
    expect(inserted).toMatchObject({
      empleado_id: IDS.empleado,
      fecha: '2026-08-03',
      estado_marcaje: 'manual',
      horas_descanso: 0.5,
      horas_trabajadas: 8.5,
      horas_normales: 8,
      horas_extra: 0.5,
    })
    expect(mock.calls.some(call => call.method === 'POST' && call.url.includes('on_conflict'))).toBe(false)
  })

  it('updates an existing manual row through a state-guarded PATCH', async () => {
    let patched
    mock = installFetchMock([
      periodsOpen,
      noHoliday,
      { match: '/configuracion_negocio', respond: [{ nomina_horas_descanso: 1 }] },
      config,
      { match: '/registro_asistencia', method: 'GET', respond: [{ id: IDS.registro, estado_marcaje: 'manual', hora_entrada: '07:30:00', hora_salida: '17:30:00', es_ausencia: false }] },
      { match: '/registro_asistencia', method: 'PATCH', respond: (_url, init) => {
        patched = JSON.parse(init.body)
        return [{ id: IDS.registro, estado_marcaje: 'manual' }]
      } },
    ])
    const result = await readResponse(await H.handleRegistrarAsistencia(makeRequest(body()), ENV))
    expect(result.status).toBe(200)
    expect(patched).toMatchObject({ estado_marcaje: 'manual', hora_entrada: '08:00' })
    expect(mock.calls.find(call => call.method === 'PATCH').url).toContain('estado_marcaje=eq.manual')
    expect(mock.calls.find(call => call.method === 'PATCH').url).toContain('hora_entrada=eq.07%3A30%3A00')
  })

  // F-1: antes un registro sin horas se guardaba como día completo con 0 h
  // trabajadas. El contrato es entrada Y salida, o ausencia.
  it('rechaza un registro de horas sin salida antes de tocar la base', async () => {
    mock = installFetchMock([periodsOpen, noHoliday])
    const result = await readResponse(await H.handleRegistrarAsistencia(makeRequest(body({ horaSalida: '' })), ENV))
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/entrada y la de salida/i)
    expect(mock.calls.some(call => ['POST', 'PATCH'].includes(call.method))).toBe(false)
  })

  it('el lote de horario previsto también exige las dos horas', async () => {
    mock = installFetchMock([periodsOpen, noHoliday])
    const result = await readResponse(await H.handleRegistrarAsistenciaMasivo(makeRequest({
      fecha: '2026-08-03', horaEntrada: '08:00', empleadoIds: [IDS.empleado],
    }), ENV))
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/entrada y la de salida/i)
    expect(mock.calls.some(call => ['POST', 'PATCH'].includes(call.method))).toBe(false)
  })

  it('la ausencia sin horas sigue siendo válida y guarda las horas en null', async () => {
    let inserted
    mock = installFetchMock([
      periodsOpen,
      noHoliday,
      { match: '/configuracion_negocio', respond: [{ nomina_horas_descanso: 1 }] },
      config,
      // F-10: la ausencia consulta los días laborables. Sin filas propias = Lun–Sáb,
      // y el 2026-08-03 es lunes: le toca trabajar.
      { match: '/nomina_horarios', method: 'GET', respond: [] },
      { match: '/registro_asistencia', method: 'GET', respond: [] },
      { match: '/registro_asistencia', method: 'POST', respond: (_url, init) => {
        inserted = JSON.parse(init.body)
        return [{ id: IDS.registro, estado_marcaje: 'manual' }]
      } },
    ])
    const result = await readResponse(await H.handleRegistrarAsistencia(
      makeRequest(body({ horaEntrada: '', horaSalida: '', esAusencia: true })), ENV
    ))
    expect(result.status).toBe(201)
    expect(inserted).toMatchObject({ es_ausencia: true, hora_entrada: null, hora_salida: null, horas_trabajadas: 0 })
  })

  // F-10: «Manual nómina» ya no puede inventar faltas en un día que no le toca
  // (día libre o feriado no laborable). Las HORAS sí se pueden cargar en cualquier
  // fecha: no afirman que la persona faltó.
  it('rechaza una ausencia en día libre sin escribir nada', async () => {
    mock = installFetchMock([
      periodsOpen,
      noHoliday,
      config,
      { match: '/nomina_horarios', method: 'GET', respond: [{ empleado_id: IDS.empleado, dia_semana: 1, trabaja: true, fecha_desde: '2000-01-01' }] },
    ])
    // 2026-08-05 es miércoles y esa persona solo trabaja los lunes.
    const result = await readResponse(await H.handleRegistrarAsistencia(
      makeRequest(body({ fecha: '2026-08-05', horaEntrada: '', horaSalida: '', esAusencia: true })), ENV
    ))
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/es libre para esta persona/i)
    expect(mock.calls.some(call => ['POST', 'PATCH'].includes(call.method))).toBe(false)
  })

  it('rechaza una ausencia en feriado no laborable sin escribir nada', async () => {
    mock = installFetchMock([
      periodsOpen,
      { match: '/nomina_feriados', respond: [{ id: IDS.registro, fecha: '2026-08-03', nombre: 'Feriado patronal', laborable: false }] },
      config,
      { match: '/nomina_horarios', method: 'GET', respond: [] },
    ])
    const result = await readResponse(await H.handleRegistrarAsistencia(
      makeRequest(body({ horaEntrada: '', horaSalida: '', esAusencia: true })), ENV
    ))
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/no es laborable/i)
    expect(mock.calls.some(call => ['POST', 'PATCH'].includes(call.method))).toBe(false)
  })

  it('sí permite cargar horas aunque el día no le toque (historia), sin consultar la semana', async () => {
    let inserted
    mock = installFetchMock([
      periodsOpen,
      noHoliday,
      { match: '/configuracion_negocio', respond: [{ nomina_horas_descanso: 1 }] },
      config,
      { match: '/registro_asistencia', method: 'GET', respond: [] },
      { match: '/registro_asistencia', method: 'POST', respond: (_url, init) => { inserted = JSON.parse(init.body); return [{ id: IDS.registro }] } },
    ])
    // 2026-08-05 es miércoles; esta prueba no declara `/nomina_horarios`, así que
    // cualquier consulta de la semana haría fallar el mock.
    const result = await readResponse(await H.handleRegistrarAsistencia(
      makeRequest(body({ fecha: '2026-08-05' })), ENV
    ))
    expect(result.status).toBe(201)
    expect(inserted).toMatchObject({ es_ausencia: false, horas_trabajadas: 8 })
    expect(mock.calls.some(call => call.url.includes('/nomina_horarios'))).toBe(false)
  })

  it('does not replace a real clock record with a manual attendance entry', async () => {
    mock = installFetchMock([
      periodsOpen,
      noHoliday,
      { match: '/configuracion_negocio', respond: [{ nomina_horas_descanso: 1 }] },
      config,
      { match: '/registro_asistencia', method: 'GET', respond: [{ id: IDS.registro, estado_marcaje: 'completo' }] },
    ])
    const result = await readResponse(await H.handleRegistrarAsistencia(makeRequest(body()), ENV))
    expect(result.status).toBe(409)
    expect(result.body.error).toMatch(/marcaje real/i)
    expect(mock.calls.some(call => ['PATCH', 'POST'].includes(call.method))).toBe(false)
  })

  it('rejects manual attendance for a profile without attendance control', async () => {
    mock = installFetchMock([
      periodsOpen,
      noHoliday,
      { match: '/nomina_config_empleado', respond: [{ horas_jornada: 8, controla_asistencia: false }] },
    ])
    const result = await readResponse(await H.handleRegistrarAsistencia(makeRequest(body()), ENV))
    expect(result.status).toBe(400)
    expect(result.body.error).toMatch(/no tiene control de asistencia/i)
    expect(mock.calls.some(call => ['PATCH', 'POST'].includes(call.method))).toBe(false)
  })

  it('aborts the bulk load when the selection includes a profile without attendance control', async () => {
    mock = installFetchMock([
      periodsOpen,
      noHoliday,
      { match: '/configuracion_negocio', respond: [{ nomina_horas_descanso: 1 }] },
      { match: '/nomina_config_empleado', respond: [{ empleado_id: IDS.empleado, horas_jornada: 8, controla_asistencia: false }] },
    ])
    const result = await readResponse(await H.handleRegistrarAsistenciaMasivo(makeRequest({
      fecha: '2026-08-03', horaEntrada: '08:00', horaSalida: '17:00', empleadoIds: [IDS.empleado],
    }), ENV))
    expect(result.status).toBe(409)
    expect(result.body.error).toMatch(/sin control de asistencia/i)
    expect(mock.calls.some(call => call.method === 'POST')).toBe(false)
  })

  it('rejects a database-unique race when the row appears after the initial check', async () => {
    mock = installFetchMock([
      periodsOpen,
      noHoliday,
      { match: '/configuracion_negocio', respond: [{ nomina_horas_descanso: 1 }] },
      config,
      { match: '/registro_asistencia', method: 'GET', respond: [] },
      { match: '/registro_asistencia', method: 'POST', respond: { __raw: { code: '23505' }, ok: false, status: 409 } },
    ])
    const result = await readResponse(await H.handleRegistrarAsistencia(makeRequest(body()), ENV))
    expect(result.status).toBe(409)
    expect(result.body.error).toMatch(/no se pudo guardar/i)
  })

  it('requires an explicit bounded, unique list of employees for bulk attendance', async () => {
    mock = installFetchMock([periodsOpen])
    const result = await readResponse(await H.handleRegistrarAsistenciaMasivo(makeRequest({
      fecha: '2026-08-03', horaEntrada: '08:00', horaSalida: '17:00', empleadoIds: [],
    }), ENV))
    expect(result.status).toBe(400)
    // El período se valida antes de la lista para no permitir cargas en períodos cerrados;
    // aun así no debe existir ninguna escritura de asistencia.
    expect(mock.calls.every(call => call.method === 'GET' && call.url.includes('/nomina_periodos'))).toBe(true)
    expect(mock.calls.some(call => ['POST', 'PATCH', 'PUT'].includes(call.method))).toBe(false)
  })

  it('bulk-inserts only the requested employees and aborts if any already has a row', async () => {
    mock = installFetchMock([
      periodsOpen,
      noHoliday,
      { match: '/configuracion_negocio', respond: [{ nomina_horas_descanso: 1 }] },
      { match: '/nomina_config_empleado', respond: [{ empleado_id: IDS.empleado, horas_jornada: 8 }] },
      { match: '/nomina_horarios', method: 'GET', respond: [] },
      { match: '/registro_asistencia', method: 'GET', respond: [{ empleado_id: IDS.empleado, estado_marcaje: 'entrada' }] },
    ])
    const result = await readResponse(await H.handleRegistrarAsistenciaMasivo(makeRequest({
      fecha: '2026-08-03', horaEntrada: '08:00', horaSalida: '17:00', empleadoIds: [IDS.empleado],
    }), ENV))
    expect(result.status).toBe(409)
    expect(result.body.error).toMatch(/no se modificó ninguno/i)
    expect(mock.calls.some(call => call.method === 'POST')).toBe(false)
  })

  it('bulk insert contains only selected employees, has manual state and stores configured rest', async () => {
    let inserted
    mock = installFetchMock([
      periodsOpen,
      noHoliday,
      { match: '/configuracion_negocio', respond: [{ nomina_horas_descanso: 0.5 }] },
      { match: '/nomina_config_empleado', respond: [{ empleado_id: IDS.empleado, horas_jornada: 8 }] },
      { match: '/nomina_horarios', method: 'GET', respond: [] },
      { match: '/registro_asistencia', method: 'GET', respond: [] },
      { match: '/registro_asistencia', method: 'POST', respond: (_url, init) => { inserted = JSON.parse(init.body); return [] } },
    ])
    const result = await readResponse(await H.handleRegistrarAsistenciaMasivo(makeRequest({
      fecha: '2026-08-03', horaEntrada: '08:00', horaSalida: '17:00', empleadoIds: [IDS.empleado],
    }), ENV))
    expect(result.status).toBe(200)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      empleado_id: IDS.empleado,
      estado_marcaje: 'manual',
      horas_descanso: 0.5,
      horas_trabajadas: 8.5,
      horas_normales: 8,
      horas_extra: 0.5,
    })
    expect(mock.calls.find(call => call.method === 'POST' && call.url.endsWith('/registro_asistencia')).url).not.toContain('on_conflict')
  })
})
