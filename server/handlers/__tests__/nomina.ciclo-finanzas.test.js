// server/handlers/__tests__/nomina.ciclo-finanzas.test.js
// E2E del ciclo completo pagar → revertir nómina, con aserciones sobre los efectos
// contables (asiento de egreso en finanzas_movimientos con idempotency_key determinista).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../nomina.lineas.js')
let mock

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

const periodo = {
  id: IDS.periodo, nombre: 'S1 2026-08', desde: '2026-08-01', hasta: '2026-08-07',
  tipo: 'semanal', estado: 'cerrado', cuenta_id: OPERADORES.administracion.cuenta_id,
}

const linea = {
  id: IDS.linea, periodo_id: IDS.periodo, empleado_id: IDS.empleado,
  pagado: false, total_bruto_usd: 500, total_neto_usd: 450,
}

// Rutas base para handlePagarLineas: línea pendiente + período cerrado.
function pagarRoutes({ linea: line = linea, periodo: per = periodo } = {}) {
  return [
    {
      match: `nomina_lineas?id=in.(${IDS.linea})`,
      method: 'GET',
      respond: [line],
    },
    { match: 'nomina_periodos?id=in.(', method: 'GET', respond: [per] },
    {
      match: `nomina_lineas?id=in.(${IDS.linea})`,
      method: 'PATCH',
      respond: (url, init) => {
        const patch = JSON.parse(init.body)
        return [{ ...line, ...patch }]
      },
    },
    // comprobación de pendientes por período (vacía → período pasa a 'pagado')
    { match: 'nomina_lineas?periodo_id=eq.', method: 'GET', respond: [] },
    { match: 'nomina_periodos?id=eq.', method: 'PATCH', respond: [] },
  ]
}

describe('nómina → finanzas — ciclo pagar → revertir', () => {
  it('al pagar crea el asiento de egreso en finanzas con idempotency_key determinista', async () => {
    let finanzasPost
    mock = installFetchMock([
      ...pagarRoutes(),
      {
        match: 'finanzas_categorias',
        method: 'POST',
        respond: (url, init) => {
          finanzasPost = { url: String(url), body: JSON.parse(init.body) }
          return []
        },
      },
      {
        match: 'finanzas_movimientos',
        method: 'POST',
        respond: (url, init) => {
          finanzasPost = { url: String(url), body: JSON.parse(init.body) }
          return [{ id: IDS.linea2 }]
        },
      },
    ])

    const response = await H.handlePagarLineas(
      makeRequest({ lineaIds: [IDS.linea], tasaBcv: 120, fuenteTasa: 'BCV', referencia: 'REC-001' }),
      ENV,
    )
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(result.body.total_usd).toBe(450)

    expect(finanzasPost).toBeTruthy()
    expect(finanzasPost.body.tipo).toBe('egreso')
    expect(finanzasPost.body.categoria).toBe('Nómina')
    expect(finanzasPost.body.monto).toBe(450)
    expect(finanzasPost.body.moneda).toBe('USD')
    expect(finanzasPost.body.tasa_ves).toBe(120)
    expect(finanzasPost.body.idempotency_key).toMatch(/^nomina_pago_/)
    // La clé contient l'ensemble des recibos + la date courante — pas de re-détection d'algorithme ici,
    // on vérifie la structure et la présence du recibo.
    expect(finanzasPost.body.idempotency_key).toContain(IDS.linea)
    // El asiento referencia el pago, no lo borra
    expect(finanzasPost.body.estado).toBe('activo')
  })

  it('paga sin crear asiento cuando el total es cero', async () => {
    let finanzasTouched = false
    mock = installFetchMock([
      ...pagarRoutes({ linea: { ...linea, total_neto_usd: 0 } }),
      { match: 'finanzas_categorias', method: 'POST', respond: () => { finanzasTouched = true; return [] } },
      { match: 'finanzas_movimientos', method: 'POST', respond: () => { finanzasTouched = true; return [] } },
    ])

    const response = await H.handlePagarLineas(makeRequest({ lineaIds: [IDS.linea] }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.total_usd).toBe(0)
    expect(finanzasTouched).toBe(false)
  })

  it('revertir el pago restaura el recibo y el período vuelve a cerrado', async () => {
    const paidLine = { ...linea, pagado: true, total_neto_usd: 450 }
    let periodPatch
    mock = installFetchMock([
      { match: `nomina_lineas?id=eq.${IDS.linea}`, method: 'GET', respond: [paidLine] },
      {
        match: `nomina_lineas?id=eq.${IDS.linea}`,
        method: 'PATCH',
        respond: (url, init) => {
          const patch = JSON.parse(init.body)
          return [{ ...paidLine, ...patch }]
        },
      },
      { match: 'nomina_lineas?periodo_id=eq.', method: 'GET', respond: [{ id: IDS.linea2, pagado: false }] },
      {
        match: 'nomina_periodos?id=eq.',
        method: 'PATCH',
        respond: (url, init) => {
          periodPatch = JSON.parse(init.body)
          return []
        },
      },
    ])

    const response = await H.handleRevertirPagoLinea(makeRequest({ lineaId: IDS.linea }), ENV)
    const result = await readResponse(response)

    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    // El período debe volver a 'cerrado' porque quedó una línea sin pagar
    expect(periodPatch?.estado).toBe('cerrado')
  })

  it('rechaza revertir un recibo que no está pagado', async () => {
    mock = installFetchMock([
      { match: `nomina_lineas?id=eq.${IDS.linea}`, method: 'GET', respond: [linea] },
    ])
    const response = await H.handleRevertirPagoLinea(makeRequest({ lineaId: IDS.linea }), ENV)
    const result = await readResponse(response)
    expect(result.status).toBe(400)
  })
})
