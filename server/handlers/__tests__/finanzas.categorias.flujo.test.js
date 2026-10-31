// server/handlers/__tests__/finanzas.categorias.flujo.test.js
// Flujo completo de categorías contra una "tabla" en memoria que respeta la
// restricción UNIQUE (cuenta_id, nombre): crear → eliminar → recrear → renombrar.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENV, OPERADORES, authOk, installFetchMock, makeRequest, readResponse } from './_harness'

vi.mock('../../lib/auth.js', () => ({
  validateOperator: vi.fn(async () => authOk(OPERADORES.administracion)),
  supaServiceHeaders: () => ({ apikey: 'test', Authorization: 'Bearer test', 'Content-Type': 'application/json' }),
}))
vi.mock('../../lib/audit.js', () => ({ registrarAuditoria: vi.fn(async () => {}) }))

const H = await import('../finanzas.js')
let mock

const UNIQUE = {
  __raw: 'duplicate key value violates unique constraint "finanzas_categorias_cuenta_id_nombre_key"',
  ok: false,
  status: 409,
}

function installTablaEnMemoria() {
  const filas = []
  const filtrar = url => {
    const params = new URL(url).searchParams
    const activo = params.get('activo')
    const nombre = params.get('nombre')
    const id = params.get('id')
    return filas.filter(fila =>
      (!activo || `eq.${fila.activo}` === activo) &&
      (!nombre || `eq.${fila.nombre}` === nombre) &&
      (!id || `eq.${fila.id}` === id))
  }
  mock = installFetchMock([
    {
      match: '/finanzas_categorias',
      method: 'POST',
      respond: (url, init) => {
        const body = JSON.parse(init.body)
        if (filas.some(fila => fila.nombre === body.nombre)) return UNIQUE
        const fila = { id: crypto.randomUUID(), nombre: body.nombre, tipo: body.tipo, activo: true }
        filas.push(fila)
        return [fila]
      },
    },
    { match: '/finanzas_categorias', method: 'GET', respond: url => filtrar(url).map(fila => ({ ...fila })) },
    {
      match: '/finanzas_categorias',
      method: 'PATCH',
      respond: (url, init) => {
        const [fila] = filtrar(url)
        if (!fila) return []
        const cambios = JSON.parse(init.body)
        if (cambios.nombre && filas.some(otra => otra !== fila && otra.nombre === cambios.nombre)) return UNIQUE
        Object.assign(fila, cambios)
        return [{ ...fila }]
      },
    },
    { match: '/finanzas_movimientos', method: 'GET', respond: [] },
  ])
  return filas
}

async function llamar(handler, body) {
  return readResponse(await handler(makeRequest(body), ENV))
}

async function listado() {
  const { body } = await readResponse(await H.handleGetFinanzasCategorias(makeRequest(), ENV))
  const propias = body.categorias.filter(item => !item.predeterminada)
  return { activas: propias.map(item => item.nombre), archivadas: body.eliminadas.map(item => item.nombre), propias }
}

afterEach(() => { mock?.restore() })

describe('finanzas — flujo completo de categorías personalizadas', () => {
  it('crear → eliminar → recrear mismo nombre → renombrar → reusar el nombre viejo', async () => {
    installTablaEnMemoria()

    const creada = await llamar(H.handleCrearFinanzasCategoria, { nombre: 'Mantenimiento', tipo: 'egreso' })
    expect(creada.status).toBe(201)
    const id = creada.body.categoria.id
    expect(await listado()).toMatchObject({ activas: ['Mantenimiento'], archivadas: [] })

    // Eliminar = baja lógica: sale de las activas y queda en archivadas.
    expect((await llamar(H.handleEliminarFinanzasCategoria, { id })).status).toBe(200)
    expect(await listado()).toMatchObject({ activas: [], archivadas: ['Mantenimiento'] })

    // Bug original: recrear el mismo nombre respondía "ya existe". Ahora reactiva.
    const recreada = await llamar(H.handleCrearFinanzasCategoria, { nombre: 'Mantenimiento', tipo: 'ingreso' })
    expect(recreada.status).toBe(200)
    expect(recreada.body.reactivada).toBe(true)
    expect(recreada.body.categoria).toMatchObject({ id, tipo: 'ingreso', activo: true })
    expect(await listado()).toMatchObject({ activas: ['Mantenimiento'], archivadas: [] })

    // Crear el mismo nombre estando activo sigue siendo un duplicado real.
    const duplicada = await llamar(H.handleCrearFinanzasCategoria, { nombre: 'Mantenimiento', tipo: 'egreso' })
    expect(duplicada.status).toBe(409)

    // Renombrar: el nombre cambia en el catálogo y el viejo queda libre.
    const renombrada = await llamar(H.handleRenombrarFinanzasCategoria, { id, nombre: 'Mantenimiento general' })
    expect(renombrada.status).toBe(200)
    expect(await listado()).toMatchObject({ activas: ['Mantenimiento general'], archivadas: [] })

    const nombreViejo = await llamar(H.handleCrearFinanzasCategoria, { nombre: 'Mantenimiento', tipo: 'egreso' })
    expect(nombreViejo.status).toBe(201)
    expect(nombreViejo.body.categoria.id).not.toBe(id)

    // Renombrar sobre un nombre en uso se rechaza sin tocar nada.
    const choque = await llamar(H.handleRenombrarFinanzasCategoria, { id, nombre: 'Mantenimiento' })
    expect(choque.status).toBe(409)
    expect((await listado()).activas.sort()).toEqual(['Mantenimiento', 'Mantenimiento general'])
  })

  it('una categoría archivada no se puede renombrar hasta restaurarla', async () => {
    installTablaEnMemoria()
    const { body } = await llamar(H.handleCrearFinanzasCategoria, { nombre: 'Temporal', tipo: 'ambos' })
    await llamar(H.handleEliminarFinanzasCategoria, { id: body.categoria.id })

    const rechazo = await llamar(H.handleRenombrarFinanzasCategoria, { id: body.categoria.id, nombre: 'Temporal 2' })
    expect(rechazo.status).toBe(400)

    await llamar(H.handleRestaurarFinanzasCategoria, { id: body.categoria.id })
    const ok = await llamar(H.handleRenombrarFinanzasCategoria, { id: body.categoria.id, nombre: 'Temporal 2' })
    expect(ok.status).toBe(200)
    expect(await listado()).toMatchObject({ activas: ['Temporal 2'], archivadas: [] })
  })
})
