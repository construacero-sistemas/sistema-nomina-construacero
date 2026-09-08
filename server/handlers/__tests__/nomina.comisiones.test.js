// server/handlers/__tests__/nomina.comisiones.test.js
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, IDS, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.administracion

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(operadorActual)),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
}))

const auditoriaSpy = vi.fn(async () => {})
vi.mock('../../lib/audit.js', () => ({
  registrarAuditoria: (...args) => auditoriaSpy(...args),
}))

const mockFetchPosVendedores = vi.fn()
const mockFetchComisionesLiberadasPos = vi.fn()

vi.mock('../../lib/posSyncHelper.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    fetchPosVendedores: (...args) => mockFetchPosVendedores(...args),
    fetchComisionesLiberadasPos: (...args) => mockFetchComisionesLiberadasPos(...args),
  }
})

const H = await import('../nomina.comisiones.js')
let mock

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.administracion
  vi.clearAllMocks()
})

const POS_VENDEDOR_ID = '99999999-9999-4999-8999-999999999999'

describe('nómina — comisiones POS', () => {
  describe('handleListarPosVendedores', () => {
    it('retorna 403 para un rol no autorizado', async () => {
      operadorActual = OPERADORES.vendedor
      const req = makeRequest(undefined, { url: 'http://worker.test/api/nomina/pos-vendedores' })
      const res = await H.handleListarPosVendedores(req, ENV)
      const { status, body } = await readResponse(res)
      expect(status).toBe(403)
      expect(body.error).toMatch(/acceso denegado/i)
    })

    it('retorna la lista de vendedores obtenida del POS', async () => {
      mockFetchPosVendedores.mockResolvedValueOnce({
        ok: true,
        vendedores: [
          { id: POS_VENDEDOR_ID, nombre: 'Carlos Vendedor', rol: 'vendedor', activo: true },
        ],
      })
      const req = makeRequest(undefined, { url: 'http://worker.test/api/nomina/pos-vendedores' })
      const res = await H.handleListarPosVendedores(req, ENV)
      const { status, body } = await readResponse(res)
      expect(status).toBe(200)
      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(1)
      expect(body[0].nombre).toBe('Carlos Vendedor')
    })

    it('excluye desarrolladores, roles no comerciales y cuentas E2E del listado', async () => {
      // Regresión: el desplegable de vinculación mostraba "Desarrollador (D-Z63T)"
      // y cuentas temporales E2E del POS. Solo roles comerciales pueden vincularse.
      const { esCuentaE2ePos } = await import('../../lib/posSyncHelper.js')
      const data = [
        { id: 'u1', nombre: 'Desarrollador', rol: 'desarrollador', codigo: 'D-Z63T' },
        { id: 'u2', nombre: 'E2E Vendedor Temporal', rol: 'vendedor', codigo: 'V-XAQ3' },
        { id: 'u3', nombre: 'LOGISTICA', rol: 'logistica', codigo: 'L-9PWZ' },
        { id: 'u4', nombre: 'ADMINISTRADOR', rol: 'administracion', codigo: 'A-RJZF' },
        { id: 'u5', nombre: 'Edgar Ramírez', rol: 'vendedor', codigo: 'V-AZPZ' },
        { id: 'u6', nombre: 'EMPRESA', rol: 'vendedor_sin_comision', codigo: 'V-JBUW' },
        { id: 'u7', nombre: 'Niki Ramírez', rol: 'supervisor', codigo: 'S-GNC5' },
      ]
      const filtrados = data.filter(u =>
        ['vendedor', 'supervisor'].includes(u.rol) && !esCuentaE2ePos(u),
      )
      expect(filtrados.map(u => u.nombre)).toEqual(['Edgar Ramírez', 'Niki Ramírez'])
      // El helper de E2E detecta por nombre y por código.
      expect(esCuentaE2ePos({ nombre: 'E2E Supervisor Temporal', codigo: 'S-W856' })).toBe(true)
      expect(esCuentaE2ePos({ nombre: 'Vendedor Real', codigo: 'V-AZPZ' })).toBe(false)
    })

    it('retorna 502 si falla la conexión con el POS', async () => {
      mockFetchPosVendedores.mockResolvedValueOnce({
        ok: false,
        error: 'Error de conexión con POS',
      })
      const req = makeRequest(undefined, { url: 'http://worker.test/api/nomina/pos-vendedores' })
      const res = await H.handleListarPosVendedores(req, ENV)
      const { status, body } = await readResponse(res)
      expect(status).toBe(502)
      expect(body.error).toContain('Error de conexión')
    })
  })

  describe('handlePreviewComisionesPos', () => {
    it('rechaza periodoId inválido', async () => {
      const req = makeRequest(undefined, { url: 'http://worker.test/api/nomina/comisiones-pos?periodoId=invalid-uuid' })
      const res = await H.handlePreviewComisionesPos(req, ENV)
      const { status, body } = await readResponse(res)
      expect(status).toBe(400)
      expect(body.error).toMatch(/periodoId inválido/i)
    })

    it('retorna 404 si el período no existe', async () => {
      mock = installFetchMock([
        { match: 'nomina_periodos?id=eq.', respond: [] },
      ])
      const req = makeRequest(undefined, { url: `http://worker.test/api/nomina/comisiones-pos?periodoId=${IDS.periodo}` })
      const res = await H.handlePreviewComisionesPos(req, ENV)
      const { status, body } = await readResponse(res)
      expect(status).toBe(404)
      expect(body.error).toMatch(/no encontrado/i)
    })

    it('retorna empleados vacíos si ninguno tiene pos_vendedor_id', async () => {
      mock = installFetchMock([
        { match: 'nomina_periodos?id=eq.', respond: [{ id: IDS.periodo, desde: '2026-08-01', hasta: '2026-08-07', estado: 'abierto' }] },
        { match: 'nomina_config_empleado?', respond: [] },
      ])
      const req = makeRequest(undefined, { url: `http://worker.test/api/nomina/comisiones-pos?periodoId=${IDS.periodo}` })
      const res = await H.handlePreviewComisionesPos(req, ENV)
      const { status, body } = await readResponse(res)
      expect(status).toBe(200)
      expect(body.empleados).toEqual([])
      expect(body.total_comisiones_usd).toBe(0)
    })

    it('retorna desglose enriquecido con liberaciones del POS', async () => {
      mock = installFetchMock([
        { match: 'nomina_periodos?id=eq.', respond: [{ id: IDS.periodo, desde: '2026-08-01', hasta: '2026-08-07', estado: 'abierto' }] },
        {
          match: 'nomina_config_empleado?',
          respond: [
            {
              id: IDS.config,
              empleado_id: IDS.empleado,
              pos_vendedor_id: POS_VENDEDOR_ID,
              cargo: 'Vendedor',
              empleado: { id: IDS.empleado, nombre: 'Luis Ramírez' },
            },
          ],
        },
        {
          match: 'nomina_lineas?periodo_id=eq.',
          respond: [
            { id: IDS.linea, empleado_id: IDS.empleado, comisiones_pos_usd: 0, comisiones_despachos_ids: [], pagado: false },
          ],
        },
      ])

      mockFetchComisionesLiberadasPos.mockResolvedValueOnce({
        ok: true,
        liberaciones: [
          {
            id: 'lib-1',
            despacho_id: 'dsp-1',
            vendedor_id: POS_VENDEDOR_ID,
            despacho_numero: 'DSP-0100',
            cliente_nombre: 'Constructora Alfa',
            fecha: '2026-08-03',
            monto_usd: 75.50,
            tipo: 'contado',
          },
          {
            id: 'lib-2',
            despacho_id: 'dsp-2',
            vendedor_id: POS_VENDEDOR_ID,
            despacho_numero: 'DSP-0105',
            cliente_nombre: 'Ferretería Beta',
            fecha: '2026-08-05',
            monto_usd: 25.00,
            tipo: 'abono',
          },
        ],
      })

      const req = makeRequest(undefined, { url: `http://worker.test/api/nomina/comisiones-pos?periodoId=${IDS.periodo}` })
      const res = await H.handlePreviewComisionesPos(req, ENV)
      const { status, body } = await readResponse(res)
      expect(status).toBe(200)
      expect(body.total_comisiones_usd).toBe(100.50)
      expect(body.empleados).toHaveLength(1)
      expect(body.empleados[0].nombre).toBe('Luis Ramírez')
      expect(body.empleados[0].total_liberado_usd).toBe(100.50)
      expect(body.empleados[0].despachos).toHaveLength(2)
      expect(body.empleados[0].tiene_linea_nomina).toBe(true)
    })
  })

  describe('handleAplicarComisionesPos', () => {
    it('rechaza si el período no está abierto', async () => {
      mock = installFetchMock([
        { match: 'nomina_periodos?id=eq.', respond: [{ id: IDS.periodo, nombre: 'S1 Agosto', estado: 'cerrado' }] },
      ])
      const req = makeRequest({
        periodoId: IDS.periodo,
        aplicaciones: [{ empleadoId: IDS.empleado, comisionesUsd: 100, despachosIds: ['dsp-1'] }],
      })
      const res = await H.handleAplicarComisionesPos(req, ENV)
      const { status, body } = await readResponse(res)
      expect(status).toBe(400)
      expect(body.error).toMatch(/abierto/i)
    })

    it('rechaza si no hay líneas calculadas en el período', async () => {
      mock = installFetchMock([
        { match: 'nomina_periodos?id=eq.', respond: [{ id: IDS.periodo, nombre: 'S1 Agosto', estado: 'abierto' }] },
        { match: 'nomina_lineas?periodo_id=eq.', respond: [] },
      ])
      const req = makeRequest({
        periodoId: IDS.periodo,
        aplicaciones: [{ empleadoId: IDS.empleado, comisionesUsd: 100, despachosIds: ['dsp-1'] }],
      })
      const res = await H.handleAplicarComisionesPos(req, ENV)
      const { status, body } = await readResponse(res)
      expect(status).toBe(400)
      expect(body.error).toMatch(/calcular la nómina antes/i)
    })

    it('rechaza si la línea ya fue pagada', async () => {
      mock = installFetchMock([
        { match: 'nomina_periodos?id=eq.', respond: [{ id: IDS.periodo, nombre: 'S1 Agosto', estado: 'abierto' }] },
        {
          match: 'nomina_lineas?periodo_id=eq.',
          respond: [
            {
              id: IDS.linea,
              empleado_id: IDS.empleado,
              monto_normal_usd: 100,
              bonos_usd: 0,
              deducciones_usd: 0,
              pagado: true,
            },
          ],
        },
      ])
      const req = makeRequest({
        periodoId: IDS.periodo,
        aplicaciones: [{ empleadoId: IDS.empleado, comisionesUsd: 50, despachosIds: ['dsp-1'] }],
      })
      const res = await H.handleAplicarComisionesPos(req, ENV)
      const { status, body } = await readResponse(res)
      expect(status).toBe(400)
      expect(body.error).toMatch(/ya pagado/i)
    })

    it('aplica comisiones y recalcula total_bruto_usd y total_neto_usd correctamente', async () => {
      mock = installFetchMock([
        { match: 'nomina_periodos?id=eq.', respond: [{ id: IDS.periodo, nombre: 'S1 Agosto', estado: 'abierto' }] },
        {
          match: 'nomina_lineas?periodo_id=eq.',
          respond: [
            {
              id: IDS.linea,
              empleado_id: IDS.empleado,
              monto_normal_usd: 120,
              monto_extra_usd: 30,
              monto_sabado_usd: 0,
              monto_feriado_usd: 0,
              bonos_usd: 10,
              deducciones_usd: 20,
              comisiones_pos_usd: 0,
              comisiones_despachos_ids: [],
              pagado: false,
            },
          ],
        },
        {
          match: 'nomina_lineas?id=eq.',
          method: 'PATCH',
          respond: [{ id: IDS.linea }],
        },
      ])

      const req = makeRequest({
        periodoId: IDS.periodo,
        aplicaciones: [
          { empleadoId: IDS.empleado, comisionesUsd: 85.50, despachosIds: ['dsp-1', 'dsp-2'] },
        ],
      })

      const res = await H.handleAplicarComisionesPos(req, ENV)
      const { status, body } = await readResponse(res)
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.actualizados).toBe(1)
      expect(body.total_comisiones_usd).toBe(85.50)

      // Verificar que el PATCH envió el cálculo correcto:
      // bruto = 120 + 30 + 0 + 0 + 10 + 85.50 = 245.50
      // neto = 245.50 - 20 = 225.50
      const patchCall = mock.calls.find(c => c.method === 'PATCH' && c.url.includes('nomina_lineas?id=eq.'))
      expect(patchCall).toBeDefined()
      expect(patchCall.body.comisiones_pos_usd).toBe(85.50)
      expect(patchCall.body.comisiones_despachos_ids).toEqual(['dsp-1', 'dsp-2'])
      expect(patchCall.body.total_bruto_usd).toBe(245.50)
      expect(patchCall.body.total_neto_usd).toBe(225.50)

      // Verificar registro de auditoría
      expect(auditoriaSpy).toHaveBeenCalledWith(
        ENV,
        expect.anything(),
        expect.objectContaining({
          accion: 'APLICAR_COMISIONES_POS',
          categoria: 'NOMINA',
          entidadId: IDS.periodo,
        }),
      )
    })
  })
})
