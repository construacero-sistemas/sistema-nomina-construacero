// @vitest-environment jsdom
// src/components/finanzas/__tests__/CategoriasModal.test.jsx
// Pruebas unitarias para el gestor de categorías: creación, badges de movimientos,
// diálogo de archivado seguro (Opción A) y restauración desde la papelera.
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CategoriasModal from '../CategoriasModal.jsx'

const MOCK_CATEGORIAS = [
  { id: 'cat-1', nombre: 'Alquiler', tipo: 'egreso', movimientos_count: 0, activo: true },
  { id: 'cat-2', nombre: 'Mantenimiento', tipo: 'egreso', movimientos_count: 5, activo: true },
  { id: null, nombre: 'Nómina', tipo: 'egreso', predeterminada: true, movimientos_count: 12, activo: true },
]

const MOCK_ELIMINADAS = [
  { id: 'cat-old', nombre: 'Papelería', tipo: 'egreso', movimientos_count: 3, activo: false },
]

describe('CategoriasModal — Gestión Integral (Opción A)', () => {
  it('renderiza la lista de categorías con badges de movimientos y etiquetas del sistema', () => {
    render(
      <CategoriasModal
        categorias={MOCK_CATEGORIAS}
        eliminadas={MOCK_ELIMINADAS}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Alquiler')).toBeInTheDocument()
    expect(screen.getByText('0 movs')).toBeInTheDocument()

    expect(screen.getByText('Mantenimiento')).toBeInTheDocument()
    expect(screen.getByText('5 movs')).toBeInTheDocument()

    expect(screen.getByText('Nómina')).toBeInTheDocument()
    expect(screen.getByText('del sistema')).toBeInTheDocument()

    // Papelera
    expect(screen.getByText('Papelería')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /restaurar papelería/i })).toBeInTheDocument()
  })

  it('permite crear una nueva categoría desde el formulario superior', async () => {
    const user = userEvent.setup()
    const onCrear = vi.fn().mockResolvedValue({ ok: true })

    render(
      <CategoriasModal
        categorias={MOCK_CATEGORIAS}
        eliminadas={[]}
        onCrear={onCrear}
        onClose={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText(/nombre \(ej\./i)
    await user.type(input, 'Publicidad y Mercadeo')

    const btn = screen.getByRole('button', { name: /añadir/i })
    await user.click(btn)

    await waitFor(() => {
      expect(onCrear).toHaveBeenCalledTimes(1)
      expect(onCrear).toHaveBeenCalledWith({
        nombre: 'Publicidad y Mercadeo',
        tipo: 'ambos',
      })
    })
  })

  it('al intentar archivar una categoría con movimientos (>0), muestra el diálogo informativo de la Opción A', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn().mockResolvedValue({ ok: true })

    render(
      <CategoriasModal
        categorias={MOCK_CATEGORIAS}
        eliminadas={[]}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    )

    // Categoría 'Mantenimiento' tiene 5 movimientos
    const btnArchivar = screen.getByRole('button', { name: /eliminar mantenimiento/i })
    await user.click(btnArchivar)

    // Aparece el diálogo de la Opción A explicando que los 5 movimientos se preservan intactos
    expect(screen.getByText(/¿archivar la categoría "mantenimiento"\?/i)).toBeInTheDocument()
    expect(screen.getByText(/5 movimiento\(s\)/i)).toBeInTheDocument()
    expect(screen.getByText(/no se perderá ningún dato/i)).toBeInTheDocument()

    // Confirmar archivado
    const btnConfirmar = screen.getByRole('button', { name: /sí, archivar/i })
    await user.click(btnConfirmar)

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('cat-2')
    })
  })

  it('permite restaurar una categoría dada de baja', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn().mockResolvedValue({ ok: true })

    render(
      <CategoriasModal
        categorias={MOCK_CATEGORIAS}
        eliminadas={MOCK_ELIMINADAS}
        onRestore={onRestore}
        onClose={vi.fn()}
      />,
    )

    const btnRestaurar = screen.getByRole('button', { name: /restaurar papelería/i })
    await user.click(btnRestaurar)

    expect(onRestore).toHaveBeenCalledWith('cat-old')
  })
})
