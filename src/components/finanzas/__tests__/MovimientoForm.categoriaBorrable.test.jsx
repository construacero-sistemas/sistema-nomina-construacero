// @vitest-environment jsdom
// src/components/finanzas/__tests__/MovimientoForm.categoriaBorrable.test.jsx
// Flujo de borrado de categoría desde el formulario: acción en el selector →
// confirmación → mutación → corrección de la selección.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const eliminarCategoriaMock = vi.fn(async () => ({ ok: true }))

vi.mock('../../../hooks/useFinanzas.js', () => ({
  useCrearMovimiento: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false }),
  useCrearCategoria: () => ({ mutateAsync: vi.fn(async () => ({ ok: true, categoria: { nombre: 'Nueva', tipo: 'egreso' } })), isPending: false }),
  useEliminarCategoria: () => ({ mutateAsync: eliminarCategoriaMock, isPending: false }),
  useRestaurarCategoria: () => ({ mutateAsync: vi.fn(async () => ({ ok: true })), isPending: false, reset: () => {} }),
}))

vi.mock('../../../hooks/useTasaCambioNomina.js', () => ({
  default: () => ({ usd: 120, eur: 130, usdt: 120 }),
}))

import MovimientoForm from '../MovimientoForm.jsx'

const CATEGORIAS = [
  { id: 'c1', nombre: 'Sueldos', tipo: 'egreso' },
  { id: 'c2', nombre: 'Ventas', tipo: 'ingreso' },
  { id: 'c3', nombre: 'General', tipo: 'ambos' },
]

function renderForm(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MovimientoForm categorias={CATEGORIAS} onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}

async function abrirSelectorCategoria(user) {
  await user.click(screen.getByText(/selecciona una categor/i))
  return await screen.findByRole('option', { name: /sueldos/i })
}

describe('MovimientoForm — borrado de categoría desde el selector', () => {
  beforeEach(() => {
    eliminarCategoriaMock.mockClear()
  })

  it('muestra el botón Eliminar por categoría dentro del dropdown', async () => {
    const user = userEvent.setup()
    renderForm()
    await abrirSelectorCategoria(user)
    // Modo egreso por defecto: Sueldos (egreso) y General (ambos)
    expect(screen.getByRole('button', { name: /eliminar sueldos/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /eliminar general/i })).toBeTruthy()
    // La opción especial de crear NO lleva botón de borrar
    expect(screen.queryByRole('button', { name: /eliminar \+ crear/i })).toBeNull()
  })

  it('pide confirmación antes de eliminar y confirma con el id correcto', async () => {
    const user = userEvent.setup()
    renderForm()
    await abrirSelectorCategoria(user)
    await user.click(screen.getByRole('button', { name: /eliminar sueldos/i }))

    // Aparece el diálogo con el nombre y no se ha llamado la mutación aún.
    // (El formulario también es role=dialog: distinguir por su título.)
    const dialogo = await screen.findByRole('dialog', { name: /eliminar la categoría/i })
    expect(dialogo.textContent).toMatch(/sueldos/i)
    expect(eliminarCategoriaMock).not.toHaveBeenCalled()

    await user.click(within(dialogo).getByRole('button', { name: /sí, eliminar/i }))
    await waitFor(() => expect(eliminarCategoriaMock).toHaveBeenCalledWith({ id: 'c1' }))
  })

  it('si la categoría eliminada estaba seleccionada, limpia la elección', async () => {
    const user = userEvent.setup()
    renderForm()
    // Seleccionar "Sueldos" primero
    const opcion = await abrirSelectorCategoria(user)
    await user.click(opcion)
    expect(screen.getByText('Sueldos')).toBeTruthy()

    // Abrir de nuevo y eliminarla
    await user.click(screen.getByText('Sueldos'))
    await user.click(screen.getByRole('button', { name: /eliminar sueldos/i }))
    const dialogo = await screen.findByRole('dialog', { name: /eliminar la categoría/i })
    await user.click(within(dialogo).getByRole('button', { name: /sí, eliminar/i }))

    await waitFor(() => expect(eliminarCategoriaMock).toHaveBeenCalled())
    // El trigger vuelve al placeholder (la categoría ya no existe)
    await waitFor(() => expect(screen.getByText(/selecciona una categor/i)).toBeTruthy())
  })

  it('cancelar cierra el diálogo sin llamar a la mutación', async () => {
    const user = userEvent.setup()
    renderForm()
    await abrirSelectorCategoria(user)
    await user.click(screen.getByRole('button', { name: /eliminar sueldos/i }))
    const dialogo = await screen.findByRole('dialog', { name: /eliminar la categoría/i })
    await user.click(within(dialogo).getByRole('button', { name: /^cancelar$/i }))
    expect(eliminarCategoriaMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: /eliminar la categoría/i })).toBeNull()
  })
})
