// @vitest-environment jsdom
// compat/components/ui/__tests__/CustomSelect.rowAction.test.jsx
// Verifica la acción por fila (rowAction) del CustomSelect: render, click sin
// seleccionar el valor, y opt-out por opción (noAction).
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Trash2 } from 'lucide-react'

import CustomSelect from '../CustomSelect.jsx'

const OPCIONES = [
  { value: 'ventas', label: 'Ventas' },
  { value: 'sueldos', label: 'Sueldos' },
  { value: '__crear__', label: '+ Crear nueva categoría', noAction: true },
]

function renderSelect({ onSelect = vi.fn(), onChange = vi.fn() } = {}) {
  render(
    <CustomSelect
      value=""
      onChange={onChange}
      options={OPCIONES}
      placeholder="Selecciona..."
      searchable={false}
      rowAction={{ label: 'Eliminar', icon: Trash2, title: 'Eliminar categoría', onSelect }}
    />,
  )
  return { onSelect, onChange }
}

describe('CustomSelect rowAction', () => {
  it('no muestra el botón de acción hasta abrir el dropdown', () => {
    renderSelect()
    expect(screen.queryByRole('button', { name: /eliminar ventas/i })).toBeNull()
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('button', { name: /eliminar ventas/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /eliminar sueldos/i })).toBeTruthy()
  })

  it('la opción marcada noAction no muestra el botón', () => {
    renderSelect()
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.queryByRole('button', { name: /eliminar \+ crear/i })).toBeNull()
  })

  it('el click en la acción NO selecciona el valor ni cierra el dropdown', async () => {
    const user = userEvent.setup()
    const { onSelect, onChange } = renderSelect()
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('button', { name: /eliminar sueldos/i }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(OPCIONES[1])
    expect(onChange).not.toHaveBeenCalled()
    // El dropdown sigue abierto: el usuario puede seguir eligiendo categoría.
    expect(screen.getByRole('button', { name: /eliminar ventas/i })).toBeTruthy()
  })

  it('elegir la opción normalmente sigue funcionando con rowAction presente', async () => {
    const user = userEvent.setup()
    const { onChange, onSelect } = renderSelect()
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /ventas/i }))
    expect(onChange).toHaveBeenCalledWith('ventas')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('la acción responde a Enter/Space para accesibilidad', () => {
    const onSelect = vi.fn()
    renderSelect({ onSelect })
    fireEvent.click(screen.getByRole('combobox'))
    const btn = screen.getByRole('button', { name: /eliminar ventas/i })
    fireEvent.keyDown(btn, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
