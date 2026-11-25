// server/handlers/__tests__/nomina.excepciones.test.js
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

// 2026-08-03 es lunes; 2026-08-09 es domingo.
const ENV_LUNES = { ...ENV, NOMINA_NOW: '2026-08-03T14:00:00.000Z' }
const ENV_DOMINGO = { ...ENV, NOMINA_NOW: '2026-08-09T14:00:00.000Z' }

function rutasBase({ periodos = [], config = [{ horas_jornada: 8, hora_inicio: '07:30', hora_fin: '16:30' }], horarios = [], feriados = [], registro = [] } = {}) {
  return [
    { match: '/nomina_periodos', respond: periodos },
    { match: '/nomina_config_empleado', respond: config },
    { match: '/nomina_horarios', respond: horarios },
    { match: '/nomina_feriados', respond: feriados },
    { match: '/registro_asistencia', method: 'GET', respond: registro },
    { match: '/configuracion_negocio', respond: [{ nomina_horas_descanso: 1 }] },
  ]
}

describe('asistencia por excepción — horas extras y días trabajados', () => {
  it('registra 0.5 horas extras respetando el horario configurado del empleado y audita', async () => {
    let inserted = null
    mock = installFetchMock([
      ...rutasBase({
        horarios: [{
          empleado_id: IDS.empleado, dia_semana: 1, trabaja: true, fecha_desde: '2000-01-01',
          hora_inicio: '07:00', hora_fin: '16:00', horas_jornada: 8,
        }],
      }),
      { match: '/registro_asistencia', method: 'POST', respond: (_url, init) => {
        inserted = JSON.parse(init.body)
        return [{ id: IDS.registro, ...inserted }]
      } },
    ])

    const { status, body } = await readResponse(await H.handleRegistrarHorasExtra(
      makeRequest({ empleadoId: IDS.empleado, horasExtra: 0.5 }), ENV_LUNES,
    ))
    expect(status).toBe(201)
    expect(inserted).toMatchObject({
      empleado_id: IDS.empleado,
      fecha: '2026-08-03',
      hora_entrada: '07:00',
      hora_salida: '16:30',
      horas_normales: 8,
      horas_extra: 0.5,
      horas_trabajadas: 8.5,
      estado_marcaje: 'manual',
    })
    expect(body.registro.horas_extra).toBe(0.5)
    expect(registrarAuditoria).toHaveBeenCalledWith(ENV_LUNES, expect.anything(), expect.objectContaining({ accion: 'REGISTRAR_HORAS_EXTRA' }))
  })

  it('rechaza horas extras inválidas (< 0.5 o > 16) o sobre una ausencia', async () => {
    mock = installFetchMock(rutasBase())
    const bad = await readResponse(await H.handleRegistrarHorasExtra(
      makeRequest({ empleadoId: IDS.empleado, horasExtra: 0.2 }), ENV_LUNES,
    ))
    expect(bad.status).toBe(400)

    mock.restore()
    mock = installFetchMock(rutasBase({
      registro: [{ id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-03', es_ausencia: true, estado_marcaje: 'manual' }],
    }))
    const sobreAusencia = await readResponse(await H.handleRegistrarHorasExtra(
      makeRequest({ empleadoId: IDS.empleado, horasExtra: 2 }), ENV_LUNES,
    ))
    expect(sobreAusencia.status).toBe(409)
  })

  it('quitar extras (0) en día hábil elimina la fila con concurrencia optimista (G-3); 0 filas -> 409', async () => {
    const row = { id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-03', hora_entrada: '08:00', hora_salida: '19:00', horas_extra: 2, es_ausencia: false, estado_marcaje: 'manual' }
    let deleteUrl = ''
    mock = installFetchMock([
      ...rutasBase({ registro: [row] }),
      { match: '/registro_asistencia', method: 'DELETE', respond: (url) => { deleteUrl = url; return [{ id: IDS.registro }] } },
    ])
    const ok = await readResponse(await H.handleRegistrarHorasExtra(
      makeRequest({ empleadoId: IDS.empleado, horasExtra: 0 }), ENV_LUNES,
    ))
    expect(ok.status).toBe(200)
    expect(ok.body.registro).toBeNull()
    expect(deleteUrl).toContain('hora_salida=eq.19%3A00')
    expect(deleteUrl).toContain('estado_marcaje=eq.manual')

    // Concurrencia optimista: si DELETE afecta 0 filas devuelve 409
    mock.restore()
    mock = installFetchMock([
      ...rutasBase({ registro: [row] }),
      { match: '/registro_asistencia', method: 'DELETE', respond: [] },
    ])
    const conflict = await readResponse(await H.handleRegistrarHorasExtra(
      makeRequest({ empleadoId: IDS.empleado, horasExtra: 0 }), ENV_LUNES,
    ))
    expect(conflict.status).toBe(409)
  })

  it('en descanso/feriado trabajado, quitar extras (0) conserva el día trabajado con 0 extras', async () => {
    const row = { id: IDS.registro, empleado_id: IDS.empleado, fecha: '2026-08-09', hora_entrada: '08:00', hora_salida: '19:00', horas_extra: 2, es_domingo: true, es_feriado: true, es_ausencia: false, estado_marcaje: 'manual' }
    let patched = null
    mock = installFetchMock([
      ...rutasBase({ registro: [row] }),
      { match: '/registro_asistencia', method: 'PATCH', respond: (_u, init) => {
        patched = JSON.parse(init.body)
        return [{ ...row, ...patched }]
      } },
    ])
    const res = await readResponse(await H.handleRegistrarHorasExtra(
      makeRequest({ empleadoId: IDS.empleado, horasExtra: 0 }), ENV_DOMINGO,
    ))
    expect(res.status).toBe(200)
    expect(patched).toMatchObject({ horas_extra: 0, horas_normales: 8, es_domingo: true, es_ausencia: false })
  })

  it('marca y quita día de descanso/feriado trabajado, y rechaza en día hábil normal', async () => {
    let inserted = null
    mock = installFetchMock([
      ...rutasBase(),
      { match: '/registro_asistencia', method: 'POST', respond: (_u, init) => {
        inserted = JSON.parse(init.body)
        return [{ id: IDS.registro, ...inserted }]
      } },
    ])
    const ok = await readResponse(await H.handleMarcarDiaTrabajado(
      makeRequest({ empleadoId: IDS.empleado }), ENV_DOMINGO,
    ))
    expect(ok.status).toBe(201)
    expect(inserted).toMatchObject({ es_domingo: true, es_feriado: true, horas_normales: 8, horas_extra: 0, es_ausencia: false })

    // Rechaza en día hábil normal
    const habil = await readResponse(await H.handleMarcarDiaTrabajado(
      makeRequest({ empleadoId: IDS.empleado }), ENV_LUNES,
    ))
    expect(habil.status).toBe(400)
  })

  it('bloquea período cerrado y perfil sin control de asistencia', async () => {
    mock = installFetchMock(rutasBase({ periodos: [{ nombre: 'Semana', estado: 'pagado' }] }))
    const cerrado = await readResponse(await H.handleRegistrarHorasExtra(
      makeRequest({ empleadoId: IDS.empleado, horasExtra: 1 }), ENV_LUNES,
    ))
    expect(cerrado.status).toBe(400)

    mock.restore()
    mock = installFetchMock(rutasBase({ config: [{ horas_jornada: 8, controla_asistencia: false }] }))
    const sinControl = await readResponse(await H.handleMarcarDiaTrabajado(
      makeRequest({ empleadoId: IDS.empleado }), ENV_DOMINGO,
    ))
    expect(sinControl.status).toBe(400)
  })
})
