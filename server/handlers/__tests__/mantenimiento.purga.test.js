// server/handlers/__tests__/mantenimiento.purga.test.js
// Zona de mantenimiento: purga de registros Nómina + Finanzas con respaldo.
// Autorización (solo gestionarUsuarios), frase de confirmación, módulos
// válidos, contrato del RPC, auditoría y descarga del respaldo. Sin red ni secretos.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, OPERADORES, installFetchMock, makeRequest, readResponse } from './_harness'

let operadorActual = OPERADORES.jefe

vi.mock('../../lib/auth.js', async () => {
  const { jsonError } = await import('../../lib/utils.js')
  const { authOk: ok } = await import('./_harness')
  return {
    validateOperator: vi.fn(async request => (operadorActual ? ok(operadorActual) : { error: jsonError('No autenticado', 401, request) })),
    supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
  }
})
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../mantenimiento.js')
const audit = await import('../../lib/audit.js')
let mock

afterEach(() => {
  mock?.restore()
  operadorActual = OPERADORES.jefe
  vi.clearAllMocks()
})

function getRequest(url) {
  const req = makeRequest()
  return { ...req, url, method: 'GET' }
}

describe('mantenimiento — autorización', () => {
  it('rechaza sin sesión (401)', async () => {
    operadorActual = null
    const res = await H.handlePurgarRegistros(makeRequest({ modulos: ['nomina'], confirmacion: 'ELIMINAR' }), ENV)
    expect((await readResponse(res)).status).toBe(401)
  })

  it('rechaza roles sin gestionarUsuarios (403) — nomina, finanzas y vendedor', async () => {
    for (const operador of [OPERADORES.nomina, OPERADORES.finanzas, OPERADORES.vendedor]) {
      operadorActual = operador
      const res = await H.handlePurgarRegistros(makeRequest({ modulos: ['nomina'], confirmacion: 'ELIMINAR' }), ENV)
      expect((await readResponse(res)).status).toBe(403)
    }
  })

  it('permite a jefe y desarrollador (llegan al RPC)', async () => {
    for (const operador of [OPERADORES.jefe, OPERADORES.desarrollador]) {
      operadorActual = operador
      mock = installFetchMock([
        { match: '/rpc/mantenimiento_purgar', method: 'POST', respond: () => ({ backup_id: 'b1', total_eliminadas: 0, por_tabla: {} }) },
      ])
      const res = await H.handlePurgarRegistros(makeRequest({ modulos: ['nomina'], confirmacion: 'ELIMINAR' }), ENV)
      expect((await readResponse(res)).status).toBe(200)
      mock.restore()
    }
  })
})

describe('mantenimiento — validaciones de la purga', () => {
  it('exige la frase de confirmación exacta (400)', async () => {
    mock = installFetchMock([])
    for (const confirmacion of ['eliminar', 'ELIMINAR!', '', undefined]) {
      const res = await H.handlePurgarRegistros(makeRequest({ modulos: ['nomina'], confirmacion }), ENV)
      expect((await readResponse(res)).status).toBe(400)
    }
    expect(mock.calls.length).toBe(0)
  })

  it('rechaza módulos vacíos o desconocidos (400) sin tocar la red', async () => {
    mock = installFetchMock([])
    for (const modulos of [[], ['todo'], ['nomina', 'contabilidad']]) {
      const res = await H.handlePurgarRegistros(makeRequest({ modulos, confirmacion: 'ELIMINAR' }), ENV)
      expect((await readResponse(res)).status).toBe(400)
    }
    expect(mock.calls.length).toBe(0)
  })
})

describe('mantenimiento — previo, purga y respaldo', () => {
  it('el previo devuelve los conteos por tabla del RPC', async () => {
    mock = installFetchMock([
      { match: '/rpc/mantenimiento_purge_preview', method: 'POST', respond: () => ({ registro_asistencia: 3, nomina_periodos: 1 }) },
    ])
    const res = await H.handlePreviewPurga(getRequest('http://worker.test/api/mantenimiento/purga-preview?modulos=nomina'), ENV)
    const body = await readResponse(res)
    expect(body.status).toBe(200)
    expect(body.body.conteos).toEqual({ registro_asistencia: 3, nomina_periodos: 1 })
    expect(mock.calls[0].body.p_modulos).toEqual(['nomina'])
    expect(mock.calls[0].body.p_cuenta_id).toBe(OPERADORES.jefe.cuenta_id)
  })

  it('la purga invoca el RPC con operador, devuelve backup_id y audita', async () => {
    mock = installFetchMock([
      { match: '/rpc/mantenimiento_purgar', method: 'POST', respond: () => ({ backup_id: 'b1', total_eliminadas: 4, por_tabla: { registro_asistencia: 4 } }) },
    ])
    const res = await H.handlePurgarRegistros(makeRequest({ modulos: ['nomina', 'finanzas'], confirmacion: 'ELIMINAR' }), ENV)
    const body = await readResponse(res)
    expect(body.status).toBe(200)
    expect(body.body.backup_id).toBe('b1')
    expect(body.body.total_eliminadas).toBe(4)
    const enviado = mock.calls[0].body
    expect(enviado.p_modulos).toEqual(['nomina', 'finanzas'])
    expect(enviado.p_operador_id).toBe(OPERADORES.jefe.id)
    expect(enviado.p_cuenta_id).toBe(OPERADORES.jefe.cuenta_id)
    expect(audit.registrarAuditoria).toHaveBeenCalledTimes(1)
  })

  it('una regla de negocio del RPC (pagos vinculados) llega como 409 con el mensaje', async () => {
    mock = installFetchMock([
      { match: '/rpc/mantenimiento_purgar', method: 'POST', respond: () => ({ __raw: { message: 'Hay 2 pago(s) de nómina vinculados; selecciona también Finanzas' }, ok: false, status: 400 }) },
    ])
    const res = await H.handlePurgarRegistros(makeRequest({ modulos: ['nomina'], confirmacion: 'ELIMINAR' }), ENV)
    const body = await readResponse(res)
    expect(body.status).toBe(409)
    expect(body.body.error).toMatch(/vinculados/)
    expect(audit.registrarAuditoria).not.toHaveBeenCalled()
  })

  it('el respaldo se descarga por id dentro de la cuenta', async () => {
    mock = installFetchMock([
      { match: '/rest/v1/purga_backups', method: 'GET', respond: () => [{ id: 'b1', payload: { registro_asistencia: [] }, total_filas: 0, modulos: ['nomina'], creado_en: '2026-09-28' }] },
    ])
    const res = await H.handleDescargarBackupPurga(getRequest('http://worker.test/api/mantenimiento/purga-backup?id=b1'), ENV)
    const body = await readResponse(res)
    expect(body.status).toBe(200)
    expect(body.body.respaldo.id).toBe('b1')
    expect(mock.calls[0].url).toContain('cuenta_id=eq.')
  })
})
