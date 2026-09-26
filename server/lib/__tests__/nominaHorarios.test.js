// server/lib/__tests__/nominaHorarios.test.js
// Resolución de los días laborables por empleado (tabla `nomina_horarios`).
// F-9: un horario programado a futuro no se aplica todavía. F-2: la lectura
// pagina la tabla en vez de pedir mil filas en una sola consulta.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DIAS_LABORABLES_DEFAULT,
  HORARIOS_POR_PAGINA,
  diasLaborablesResueltos,
  diaSemanaDeFecha,
  empleadosLibresEseDia,
  fetchDiasLaborablesEmpleado,
  fetchDiasLaborablesPorEmpleado,
  fetchFilasHorarioPorEmpleado,
  trabajaEnFecha,
} from '../nominaHorarios.js'

const ENV = { SUPABASE_URL: 'http://supabase.test.invalid' }
const HEADERS = { apikey: 'test' }
const CUENTA = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const EMPLEADO = 'e0000000-0000-4000-8000-000000000001'
const EMPLEADO2 = 'e0000000-0000-4000-8000-000000000002'

function fila(patch = {}) {
  return { empleado_id: EMPLEADO, dia_semana: 2, trabaja: true, fecha_desde: '2000-01-01', semana_ciclo: null, fecha_hasta: null, ...patch }
}

function installFetch(paginas) {
  const calls = []
  const impl = vi.fn(async (url) => {
    calls.push(String(url))
    const offset = Number(new URL(String(url)).searchParams.get('offset') || 0)
    const pagina = paginas[offset / HORARIOS_POR_PAGINA] ?? []
    return { ok: true, status: 200, json: async () => pagina }
  })
  const original = globalThis.fetch
  globalThis.fetch = impl
  return { calls, restore() { globalThis.fetch = original } }
}

let mock
afterEach(() => { mock?.restore(); vi.clearAllMocks() })

describe('días laborables resueltos', () => {
  it('sin filas propias conserva el horario histórico y lo marca no configurado', () => {
    expect(diasLaborablesResueltos([], '2026-08-03')).toEqual({ dias: [...DIAS_LABORABLES_DEFAULT], configurado: false })
    expect(diasLaborablesResueltos(null)).toEqual({ dias: [...DIAS_LABORABLES_DEFAULT], configurado: false })
  })

  it('devuelve los días de la semana propia, ordenados y sin domingo', () => {
    const filas = [fila({ dia_semana: 6 }), fila({ dia_semana: 2 }), fila({ dia_semana: 0 }), fila({ dia_semana: 3, trabaja: false })]
    expect(diasLaborablesResueltos(filas)).toEqual({ dias: [2, 6], configurado: true })
  })

  it('ignora un horario programado a futuro y sigue usando el anterior', () => {
    const filas = [
      fila({ dia_semana: 1 }),
      fila({ dia_semana: 5, fecha_desde: '2026-09-01' }),
      fila({ dia_semana: 3, fecha_desde: '2026-08-20' }),
    ]
    expect(diasLaborablesResueltos(filas, '2026-08-03')).toEqual({ dias: [1], configurado: true })
    // El mismo conjunto, mirado desde septiembre, ya incluye lo programado.
    expect(diasLaborablesResueltos(filas, '2026-09-10')).toEqual({ dias: [1, 3, 5], configurado: true })
  })

  it('la vigencia es por fecha completa, no por prefijo de texto', () => {
    const filas = [fila({ dia_semana: 1 }), fila({ dia_semana: 4, fecha_desde: '2026-08-03T00:00:00Z' })]
    expect(diasLaborablesResueltos(filas, '2026-08-03').dias).toEqual([1, 4])
    expect(diasLaborablesResueltos(filas, '2026-08-02').dias).toEqual([1])
  })
})

describe('calendario semanal', () => {
  it('el domingo nunca es laborable y la fecha inválida no rompe el cálculo', () => {
    expect(diaSemanaDeFecha('2026-08-09')).toBe(0)
    expect(diaSemanaDeFecha('2026-13-99')).toBeNull()
    expect(trabajaEnFecha([1, 2, 3, 4, 5], '2026-08-09')).toBe(false)
    expect(trabajaEnFecha([1, 2, 3, 4, 5], '2026-08-04')).toBe(true)
    expect(trabajaEnFecha(undefined, '2026-08-04')).toBe(true)
  })

  it('marca como libres solo a quienes no trabajan esa fecha', () => {
    const porEmpleado = new Map([
      [EMPLEADO, { dias: [1, 2, 3, 4, 5], configurado: true }],
      [EMPLEADO2, { dias: [6], configurado: true }],
    ])
    expect(empleadosLibresEseDia([EMPLEADO, EMPLEADO2, 'e-desconocido'], porEmpleado, '2026-08-03')).toEqual([EMPLEADO2])
  })
})

describe('lectura paginada de la tabla de horarios', () => {
  it('no pide mil filas: pagina con offset y acota por empleados cuando le pasan la lista', async () => {
    mock = installFetch([[fila({ dia_semana: 1 })]])
    const { ok, porEmpleado } = await fetchFilasHorarioPorEmpleado(ENV, HEADERS, CUENTA, { empleadoIds: [EMPLEADO], fecha: '2026-08-03' })

    expect(ok).toBe(true)
    expect(porEmpleado.get(EMPLEADO)).toHaveLength(1)
    const url = mock.calls[0]
    // El guardarraíl de egress prohíbe pedir mil filas: la página es acotada.
    expect(Number(new URL(url).searchParams.get('limit'))).toBe(HORARIOS_POR_PAGINA)
    expect(url).toContain('offset=0')
    expect(url).toContain(`empleado_id=in.(${EMPLEADO})`)
    expect(url).toContain('fecha_desde=lte.2026-08-03')
    expect(url).toContain(`cuenta_id=eq.${CUENTA}`)
  })

  it('sigue paginando mientras la página venga llena', async () => {
    const llena = Array.from({ length: HORARIOS_POR_PAGINA }, (_, i) => fila({ dia_semana: (i % 6) + 1 }))
    mock = installFetch([llena, [fila({ dia_semana: 6 })]])
    const { ok, porEmpleado } = await fetchFilasHorarioPorEmpleado(ENV, HEADERS, CUENTA)

    expect(ok).toBe(true)
    expect(mock.calls).toHaveLength(2)
    expect(mock.calls[1]).toContain(`offset=${HORARIOS_POR_PAGINA}`)
    expect(porEmpleado.get(EMPLEADO)).toHaveLength(HORARIOS_POR_PAGINA + 1)
  })

  it('resuelve la semana de cada empleado y la de uno en particular', async () => {
    mock = installFetch([[fila({ dia_semana: 2 }), fila({ empleado_id: EMPLEADO2, dia_semana: 4 })]])
    const todas = await fetchDiasLaborablesPorEmpleado(ENV, HEADERS, CUENTA, { fecha: '2026-08-03' })
    expect(todas.porEmpleado.get(EMPLEADO)).toEqual({ dias: [2], configurado: true })

    mock.restore()
    mock = installFetch([[]])
    const una = await fetchDiasLaborablesEmpleado(ENV, HEADERS, CUENTA, EMPLEADO2, '2026-08-03')
    expect(una.ok).toBe(true)
    expect(una).toMatchObject({ dias: [...DIAS_LABORABLES_DEFAULT], configurado: false })
  })

  it('si la lectura falla, avisa sin inventar una semana', async () => {
    const impl = vi.fn(async () => ({ ok: false, status: 500, json: async () => [] }))
    const original = globalThis.fetch
    globalThis.fetch = impl
    try {
      const { ok, porEmpleado } = await fetchFilasHorarioPorEmpleado(ENV, HEADERS, CUENTA)
      expect(ok).toBe(false)
      expect(porEmpleado.size).toBe(0)
    } finally {
      globalThis.fetch = original
    }
  })
})
