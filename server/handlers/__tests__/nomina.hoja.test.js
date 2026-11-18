// GET /api/nomina/periodos/hoja — solo lectura (docs/PLAN_HOJA_SEMANAL.md).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, readResponse } from './_harness'

let operadorActual = OPERADORES.nomina
vi.mock('../../lib/auth.js', () => ({ validateOperator: vi.fn(async () => authOk(operadorActual)) }))

const H = await import('../nomina.js')
let mock
afterEach(() => { mock?.restore(); operadorActual = OPERADORES.nomina })

const PERIODO = { id: IDS.periodo, nombre: 'Semana 05–11/11', desde: '2026-11-05', hasta: '2026-11-11', estado: 'abierto' }
const pedir = (periodoId = IDS.periodo) => new Request(`http://worker.test/api/nomina/periodos/hoja?periodoId=${periodoId}`, { method: 'GET' })

// Recibo de 240 al mes (8 $/día): 5 laborables + 2 descansos + el sábado trabajado.
const linea = {
  id: IDS.registro, empleado_id: IDS.empleado, salario_dia_usd_snap: 8, dias_trabajados: 6, dias_descanso: 2, horas_extra: 2,
  monto_normal_usd: 64, monto_extra_usd: 5, monto_sabado_usd: 0, monto_feriado_usd: 0, bonos_usd: 0, comisiones_pos_usd: 0,
  deducciones_usd: 20, total_bruto_usd: 69, total_neto_usd: 49, pagado: false, empleado: { id: IDS.empleado, nombre: 'Juan Orozco' },
}
const sabado = {
  empleado_id: IDS.empleado, fecha: '2026-11-07', es_sabado: true, es_domingo: false, es_feriado: false, es_ausencia: false,
  hora_entrada: '08:00:00', hora_salida: '17:00:00', horas_normales: 8, horas_extra: 0, horas_trabajadas: 8, estado_marcaje: 'completo',
}

function rutas({ periodo = [PERIODO], lineas = [linea], asistencias = [sabado] } = {}) {
  return [
    { match: '/nomina_periodos', respond: periodo },
    { match: '/nomina_lineas', respond: lineas },
    { match: '/registro_asistencia', respond: asistencias },
    { match: '/nomina_horarios', respond: [] },
    { match: '/configuracion_negocio', respond: [{ nomina_divisor_mensual: 30, nomina_dias_laborables_default: [1, 2, 3, 4, 5] }] },
  ]
}

describe('hoja semanal del período', () => {
  it('devuelve las columnas de la planilla y totales, sin escribir nada', async () => {
    mock = installFetchMock(rutas())
    const { status, body } = await readResponse(await H.handleGetHojaSemanal(pedir(), ENV))
    expect(status).toBe(200)
    expect(body.bonoSemanal).toBe(35)
    expect(body.filas).toHaveLength(1)
    expect(body.filas[0]).toMatchObject({
      nombre: 'Juan Orozco', sueldoMensual: 240, diasTrabajados: 5, diasDescansoTrabajados: 1,
      semana: 56, bonoSemanal: 35, sueldoSemanal: 21, totalExtras: 5, valorDescansoTrabajado: 8,
      totalACobrar: 69, descuentos: 20, neto: 49,
    })
    expect(body.totales).toMatchObject({ empleados: 1, totalACobrar: 69, neto: 49 })
    expect(mock.calls.every(call => call.method === 'GET')).toBe(true)
    expect(mock.calls.filter(call => call.url.includes('/rest/v1/')).every(call => call.url.includes(`cuenta_id=eq.${OPERADORES.nomina.cuenta_id}`) || call.url.includes('configuracion_negocio'))).toBe(true)
  })

  it('rechaza un periodoId inválido y uno inexistente', async () => {
    mock = installFetchMock(rutas({ periodo: [] }))
    expect((await readResponse(await H.handleGetHojaSemanal(pedir('no-es-uuid'), ENV))).status).toBe(400)
    expect((await readResponse(await H.handleGetHojaSemanal(pedir(), ENV))).status).toBe(404)
  })

  it('un rol sin capacidad de ver nómina recibe 403 sin consultar datos', async () => {
    operadorActual = OPERADORES.logistica
    mock = installFetchMock([])
    expect((await readResponse(await H.handleGetHojaSemanal(pedir(), ENV))).status).toBe(403)
    expect(mock.calls).toHaveLength(0)
  })

  // Igual que el listado de recibos: sin la migración 262 la hoja sigue funcionando
  // (sin descanso pagado) en vez de caerse. Lo detectó el smoke de staging.
  it('si la base no tiene dias_descanso (migración 262), reintenta sin esa columna', async () => {
    let intentos = 0
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [PERIODO] },
      { match: '/nomina_lineas', respond: url => {
        intentos += 1
        return url.includes('dias_descanso')
          ? { __raw: { message: 'column nomina_lineas.dias_descanso does not exist' }, ok: false, status: 400 }
          : [{ ...linea, dias_descanso: undefined }]
      } },
      { match: '/registro_asistencia', respond: [sabado] },
      { match: '/nomina_horarios', respond: [] },
      { match: '/configuracion_negocio', respond: [{}] },
    ])
    const { status, body } = await readResponse(await H.handleGetHojaSemanal(pedir(), ENV))
    expect(status).toBe(200)
    expect(intentos).toBe(2)
    expect(body.filas[0].diasDescansoPagados).toBe(0)
  })

  it('si no se pueden leer los recibos responde 500', async () => {
    mock = installFetchMock([
      { match: '/nomina_periodos', respond: [PERIODO] },
      { match: '/nomina_lineas', respond: { __raw: { error: 'x' }, ok: false, status: 500 } },
      { match: '/registro_asistencia', respond: [] },
      { match: '/nomina_horarios', respond: [] },
      { match: '/configuracion_negocio', respond: [{}] },
    ])
    expect((await readResponse(await H.handleGetHojaSemanal(pedir(), ENV))).status).toBe(500)
  })
})
