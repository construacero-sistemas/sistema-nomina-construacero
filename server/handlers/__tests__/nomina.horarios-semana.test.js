// server/handlers/__tests__/nomina.horarios-semana.test.js
// F-7: guardar la semana laboral no puede borrar antes de escribir. La semana
// nueva se escribe fila por fila (PATCH de los días que ya existían, POST de los
// nuevos) y solo después se retiran los días que salieron de la semana. Además el
// editor solo toca la semana vigente: un horario programado a futuro no se pisa (F-9).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(OPERADORES.administracion)),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../nomina.js')
let mock
afterEach(() => { mock?.restore(); vi.clearAllMocks() })

// 14:00 UTC = 10:00 en America/Caracas: hoy operativo es el 2026-08-03 (lunes).
const ENV_HOY = { ...ENV, NOMINA_NOW: '2026-08-03T14:00:00.000Z' }
const config = { match: '/nomina_config_empleado', respond: [{ horas_jornada: 8 }] }

function dia(diaSemana, patch = {}) {
  return { diaSemana, horaInicio: '08:00', horaFin: '17:00', horasJornada: 8, ...patch }
}

function peticion(dias) {
  return makeRequest({ empleadoId: IDS.empleado, dias })
}

describe('guardar la semana laboral de un empleado', () => {
  it('actualiza los días que ya existían y solo retira los que salen de la semana', async () => {
    const parches = []
    let insertado
    let borrado
    mock = installFetchMock([
      config,
      { match: '/nomina_horarios', method: 'GET', respond: [{ id: IDS.registro, dia_semana: 1 }, { id: IDS.linea, dia_semana: 2 }] },
      { match: '/nomina_horarios', method: 'PATCH', respond: (url, init) => {
        parches.push({ url, body: JSON.parse(init.body) })
        return [{ id: url.includes(IDS.registro) ? IDS.registro : IDS.linea, dia_semana: 1 }]
      } },
      { match: '/nomina_horarios', method: 'POST', respond: (url, init) => { insertado = JSON.parse(init.body); return [{ id: IDS.linea2, dia_semana: 3 }] } },
      { match: '/nomina_horarios', method: 'DELETE', respond: (url) => { borrado = url; return [] } },
    ])
    const { status, body } = await readResponse(await H.handleGuardarHorarioEmpleado(peticion([dia(1, { horaFin: '16:00' }), dia(3)]), ENV_HOY))

    expect(status).toBe(200)
    expect(body.dias_laborables).toEqual([1, 3])
    expect(body.aviso).toBeUndefined()
    expect(parches).toHaveLength(1)
    expect(parches[0].url).toContain(`id=eq.${IDS.registro}`)
    expect(parches[0].body).toMatchObject({ hora_fin: '16:00', semana_ciclo: null, fecha_hasta: null, trabaja: true })
    expect(parches[0].body.empleado_id).toBeUndefined()
    expect(insertado).toHaveLength(1)
    expect(insertado[0]).toMatchObject({ empleado_id: IDS.empleado, dia_semana: 3, cuenta_id: OPERADORES.administracion.cuenta_id })
    // El día 2 salió de la semana: se retira solo esa fila, nunca toda la semana.
    expect(borrado).toContain(`id=in.(${IDS.linea})`)
    expect(borrado).not.toContain(IDS.registro)
    expect(mock.calls.filter(call => call.method === 'DELETE')).toHaveLength(1)
  })

  it('si una escritura falla no retira ningún día: la semana anterior sigue completa', async () => {
    mock = installFetchMock([
      config,
      { match: '/nomina_horarios', method: 'GET', respond: [{ id: IDS.registro, dia_semana: 1 }, { id: IDS.linea, dia_semana: 2 }] },
      { match: '/nomina_horarios', method: 'PATCH', respond: [{ id: IDS.registro }] },
      { match: '/nomina_horarios', method: 'POST', respond: { __raw: { code: '23505' }, ok: false, status: 409 } },
    ])
    const { status, body } = await readResponse(await H.handleGuardarHorarioEmpleado(peticion([dia(1), dia(2), dia(5)]), ENV_HOY))

    expect(status).toBe(409)
    expect(String(body.error)).toMatch(/no se retiró ningún día/i)
    expect(mock.calls.some(call => call.method === 'DELETE')).toBe(false)
    expect(mock.calls.filter(call => call.method === 'PATCH')).toHaveLength(2)
  })

  it('si el retiro falla, la semana nueva queda guardada y se avisa', async () => {
    mock = installFetchMock([
      config,
      { match: '/nomina_horarios', method: 'GET', respond: [{ id: IDS.registro, dia_semana: 1 }, { id: IDS.linea, dia_semana: 5 }] },
      { match: '/nomina_horarios', method: 'PATCH', respond: [{ id: IDS.registro }] },
      { match: '/nomina_horarios', method: 'DELETE', respond: { __raw: { message: 'boom' }, ok: false, status: 500 } },
    ])
    const { status, body } = await readResponse(await H.handleGuardarHorarioEmpleado(peticion([dia(1)]), ENV_HOY))

    expect(status).toBe(200)
    expect(body.dias_laborables).toEqual([1])
    expect(String(body.aviso)).toMatch(/no se pudieron retirar/i)
    expect(mock.calls.some(call => call.method === 'POST')).toBe(false)
  })

  it('solo toca la semana vigente: filtra por fecha_desde <= hoy operativo', async () => {
    mock = installFetchMock([
      config,
      { match: '/nomina_horarios', method: 'GET', respond: [] },
      { match: '/nomina_horarios', method: 'POST', respond: [{ id: IDS.registro, dia_semana: 1 }] },
    ])
    const { status } = await readResponse(await H.handleGuardarHorarioEmpleado(peticion([dia(1)]), ENV_HOY))

    expect(status).toBe(200)
    const lectura = mock.calls.find(call => call.method === 'GET' && call.url.includes('/nomina_horarios'))
    expect(lectura.url).toContain('semana_ciclo=is.null')
    expect(lectura.url).toContain('fecha_hasta=is.null')
    expect(lectura.url).toContain('fecha_desde=lte.2026-08-03')
    expect(mock.calls.some(call => call.method === 'DELETE')).toBe(false)
  })

  it('rechaza un día repetido sin escribir nada', async () => {
    mock = installFetchMock([config])
    const { status, body } = await readResponse(await H.handleGuardarHorarioEmpleado(peticion([dia(2), dia(2)]), ENV_HOY))
    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/repetidos/i)
    expect(mock.calls.some(call => ['POST', 'PATCH', 'DELETE'].includes(call.method))).toBe(false)
  })
})
