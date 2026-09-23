import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
}))
vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: vi.fn(async () => {}),
}))

const H = await import('../nomina.js')

let mock
afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

describe('aislamiento de tenant en nómina', () => {
  it('lista empleados personales solo dentro de la cuenta del operador', async () => {
    mock = installFetchMock([
      { match: '/clientes?tipo_cliente=eq.personal', respond: [
        { id: IDS.empleado, nombre: 'Empleado A', tipo_cliente: 'personal', activo: true },
      ] },
    ])

    const res = await H.handleGetEmpleados(makeRequest(), ENV)
    const { status, body } = await readResponse(res)

    expect(status).toBe(200)
    expect(body).toHaveLength(1)
    expect(mock.calls[0].url).toContain(`cuenta_id=eq.${OPERADORES.administracion.cuenta_id}`)
    expect(mock.calls[0].url).toContain('tipo_cliente=eq.personal')
    expect(mock.calls[0].url).toContain('select=id,nombre,tipo_cliente,activo')
  })

  it('rechaza operadores sin cuenta antes de consultar Supabase', async () => {
    operadorActual = { ...OPERADORES.administracion, cuenta_id: null }
    mock = installFetchMock([])

    const res = await H.handleGetPeriodos(makeRequest(), ENV)
    const { status, body } = await readResponse(res)

    expect(status).toBe(403)
    expect(String(body.error)).toMatch(/cuenta/i)
    expect(mock.calls).toHaveLength(0)
  })

  it('incluye cuenta_id al resolver líneas por UUID', async () => {
    mock = installFetchMock([
      { match: '/nomina_lineas', respond: [] },
    ])

    const request = makeRequest(undefined, {
      url: `http://worker.test/api/nomina/lineas?periodoId=${IDS.periodo}`,
    })
    const res = await H.handleGetLineas(request, ENV)

    expect((await readResponse(res)).status).toBe(200)
    expect(mock.calls[0].url).toContain(`cuenta_id=eq.${OPERADORES.administracion.cuenta_id}`)
  })

  it('el listado de líneas expone tasa de pago y monto en Bs congelados (migración 241)', async () => {
    mock = installFetchMock([
      { match: '/nomina_lineas', respond: [{
        id: IDS.periodo, pagado: true, tasa_pago_usd_ves: '804.81', total_pagado_bs: '48288.60',
      }] },
    ])

    const res = await H.handleGetLineas(makeRequest(undefined, {
      url: `http://worker.test/api/nomina/lineas?periodoId=${IDS.periodo}`,
    }), ENV)
    const { status, body } = await readResponse(res)

    expect(status).toBe(200)
    expect(body[0].tasa_pago_usd_ves).toBe('804.81')
    expect(body[0].total_pagado_bs).toBe('48288.60')
    // Guardrail: el SELECT debe pedir ambas columnas o la UI/PDF pierde la evidencia.
    expect(mock.calls[0].url).toContain('tasa_pago_usd_ves')
    expect(mock.calls[0].url).toContain('total_pagado_bs')
  })
})
