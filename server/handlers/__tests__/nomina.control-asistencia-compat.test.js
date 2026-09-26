// La bandera `controla_asistencia` llega con la migración 246. Mientras no esté
// aplicada, PostgREST responde 42703 y estos tests garantizan que el flujo de
// asistencia no se caiga: se reintenta sin la columna y todos controlan asistencia.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchConfigsConControl } from '../nomina.shared.js'

const ENV_TEST = { SUPABASE_URL: 'http://supabase.test.invalid', SUPABASE_SERVICE_KEY: 'test' }
const HEADERS = { apikey: 'test' }

const sinColumna = {
  status: 400,
  ok: false,
  json: async () => ({}),
  text: async () => JSON.stringify({
    code: '42703',
    message: 'column nomina_config_empleado.controla_asistencia does not exist',
  }),
}

const conFilas = (filas, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => filas,
  text: async () => JSON.stringify(filas),
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchConfigsConControl', () => {
  it('reintenta sin la columna y asume control de asistencia cuando la migración 246 no está aplicada', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sinColumna)
      .mockResolvedValueOnce(conFilas([{ horas_jornada: 8 }, { horas_jornada: 6 }]))
    vi.stubGlobal('fetch', fetchMock)

    const { ok, rows } = await fetchConfigsConControl(ENV_TEST, HEADERS, {
      filtros: 'activo=eq.true&cuenta_id=eq.cuenta-1',
      select: 'empleado_id,horas_jornada',
      limit: 500,
    })

    expect(ok).toBe(true)
    expect(rows).toEqual([
      { horas_jornada: 8, controla_asistencia: true },
      { horas_jornada: 6, controla_asistencia: true },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // El primer intento pide la columna nueva; el segundo se queda con lo de antes.
    expect(fetchMock.mock.calls[0][0]).toContain('controla_asistencia')
    expect(fetchMock.mock.calls[1][0]).not.toContain('controla_asistencia')
    expect(fetchMock.mock.calls[1][0]).toContain('limit=500')
  })

  it('respeta la bandera cuando la columna existe', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(conFilas([
      { empleado_id: 'e-1', horas_jornada: 8, controla_asistencia: false },
      { empleado_id: 'e-2', horas_jornada: 8, controla_asistencia: true },
      { empleado_id: 'e-3', horas_jornada: 8 },
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const { ok, rows } = await fetchConfigsConControl(ENV_TEST, HEADERS, {
      filtros: 'activo=eq.true',
      select: 'empleado_id,horas_jornada',
    })

    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(rows.map(row => row.controla_asistencia)).toEqual([false, true, true])
  })

  it('no reintenta ni inventa banderas si el error es de otra causa', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      status: 500,
      ok: false,
      json: async () => ({}),
      text: async () => 'internal error',
    })
    vi.stubGlobal('fetch', fetchMock)

    const { ok, rows } = await fetchConfigsConControl(ENV_TEST, HEADERS, {
      filtros: 'activo=eq.true',
      select: 'empleado_id',
    })

    expect(ok).toBe(false)
    expect(rows).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('propaga el fallo del reintento en vez de devolver filas sin la bandera', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sinColumna)
      .mockResolvedValueOnce({ status: 500, ok: false, json: async () => ({}), text: async () => 'boom' })
    vi.stubGlobal('fetch', fetchMock)

    const { ok, rows } = await fetchConfigsConControl(ENV_TEST, HEADERS, { filtros: 'activo=eq.true', select: 'empleado_id' })

    expect(ok).toBe(false)
    expect(rows).toEqual([])
  })
})
