// server/handlers/__tests__/finanzas.actualizar.test.js
// Tests de actualización de categoría y motivo de movimientos financieros (exclusivo jefe).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.jefe

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../finanzas.js')
let mock

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.jefe
  vi.clearAllMocks()
})

const activeMovement = {
  id: IDS.linea,
  fecha: '2026-08-18', tipo: 'egreso', categoria: 'Proveedores', concepto: 'Cemento Gris',
  monto: 100, moneda: 'USD', tasa_ves: 120, monto_ves: 12000,
  fuente_tasa: 'MANUAL', estado: 'activo', creado_en: '2026-08-18T12:00:00Z',
  referencia: 'Factura 101',
}

describe('finanzas — actualización de movimientos (exclusivo jefe)', () => {
  it('deniega acceso con 403 a rol finanzas (solo jefe puede editar)', async () => {
    operadorActual = OPERADORES.finanzas
    const response = await H.handleActualizarFinanzasMovimiento(
      makeRequest({ id: IDS.linea, categoria: 'Servicios', concepto: 'Luz eléctrica' }),
      ENV,
    )
    const result = await readResponse(response)
    expect(result.status).toBe(403)
  })

  it('valida parámetros de entrada (id, categoría y concepto)', async () => {
    const invalidIdRes = await H.handleActualizarFinanzasMovimiento(
      makeRequest({ id: 'invalido', categoria: 'Ventas', concepto: 'Venta perfiles' }),
      ENV,
    )
    expect((await readResponse(invalidIdRes)).status).toBe(400)

    const emptyCatRes = await H.handleActualizarFinanzasMovimiento(
      makeRequest({ id: IDS.linea, categoria: '   ', concepto: 'Venta perfiles' }),
      ENV,
    )
    expect((await readResponse(emptyCatRes)).status).toBe(400)

    const emptyConceptRes = await H.handleActualizarFinanzasMovimiento(
      makeRequest({ id: IDS.linea, categoria: 'Ventas', concepto: '   ' }),
      ENV,
    )
    expect((await readResponse(emptyConceptRes)).status).toBe(400)
  })

  it('deniega actualización con 409 si el movimiento está anulado', async () => {
    mock = installFetchMock([
      { match: `finanzas_movimientos?id=eq.${IDS.linea}`, method: 'GET', respond: [{ ...activeMovement, estado: 'anulado' }] },
    ])
    const response = await H.handleActualizarFinanzasMovimiento(
      makeRequest({ id: IDS.linea, categoria: 'Servicios', concepto: 'Luz eléctrica corregida' }),
      ENV,
    )
    const result = await readResponse(response)
    expect(result.status).toBe(409)
    expect(result.body.error).toMatch(/anulado/i)
  })

  it('jefe actualiza categoría, concepto y referencia exitosamente sin tocar variables financieras', async () => {
    let patchBody
    mock = installFetchMock([
      { match: `finanzas_movimientos?id=eq.${IDS.linea}`, method: 'GET', respond: [activeMovement] },
      {
        match: `finanzas_movimientos?id=eq.${IDS.linea}`,
        method: 'PATCH',
        respond: (url, init) => {
          patchBody = JSON.parse(init.body)
          return [{ ...activeMovement, ...patchBody }]
        },
      },
    ])

    const response = await H.handleActualizarFinanzasMovimiento(
      makeRequest({
        id: IDS.linea,
        categoria: 'Materia Prima',
        concepto: 'Cemento Blanco Especial',
        referencia: 'Factura 102',
      }),
      ENV,
    )
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(result.body.movimiento.categoria).toBe('Materia Prima')
    expect(result.body.movimiento.concepto).toBe('Cemento Blanco Especial')
    expect(patchBody.categoria).toBe('Materia Prima')
    expect(patchBody.concepto).toBe('Cemento Blanco Especial')
    expect(patchBody.referencia).toBe('Factura 102')

    // Variables financieras inalteradas en el PATCH
    expect(patchBody.monto).toBeUndefined()
    expect(patchBody.moneda).toBeUndefined()
    expect(patchBody.tasa_ves).toBeUndefined()
    expect(patchBody.fecha).toBeUndefined()
    expect(patchBody.cuenta_custodia_id).toBeUndefined()
  })
})
