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
    fireEvent.click(screen.getByRole('combobox', { name: 'Selecciona...' }))
    expect(screen.getByRole('button', { name: /eliminar ventas/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /eliminar sueldos/i })).toBeTruthy()
  })

  it('la opción marcada noAction no muestra el botón', () => {
    renderSelect()
    fireEvent.click(screen.getByRole('combobox', { name: 'Selecciona...' }))
    expect(screen.queryByRole('button', { name: /eliminar \+ crear/i })).toBeNull()
  })

  it('la acción no selecciona el valor y cierra el dropdown para dar paso a la confirmación', async () => {
    const user = userEvent.setup()
    const { onSelect, onChange } = renderSelect()
    await user.click(screen.getByRole('combobox', { name: 'Selecciona...' }))
    await user.click(screen.getByRole('button', { name: /eliminar sueldos/i }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(OPCIONES[1])
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Selecciona...' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('elegir la opción normalmente sigue funcionando con rowAction presente', async () => {
    const user = userEvent.setup()
    const { onChange, onSelect } = renderSelect()
    await user.click(screen.getByRole('combobox', { name: 'Selecciona...' }))
    await user.click(screen.getByRole('option', { name: /ventas/i }))
    expect(onChange).toHaveBeenCalledWith('ventas')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it.each(['{Enter}', ' '])('la acción nativa responde a %s sin seleccionar la opción', async key => {
    const user = userEvent.setup()
    const { onSelect, onChange } = renderSelect()
    await user.click(screen.getByRole('combobox', { name: 'Selecciona...' }))
    const btn = screen.getByRole('button', { name: /eliminar ventas/i })
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.closest('[role="option"]')).toBeNull()
    btn.focus()
    await user.keyboard(key)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(OPCIONES[0])
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('las opciones y acciones son controles hermanos con nombres independientes', async () => {
    const user = userEvent.setup()
    renderSelect()
    await user.click(screen.getByRole('combobox', { name: 'Selecciona...' }))
    const option = screen.getByRole('option', { name: 'Ventas' })
    const action = screen.getByRole('button', { name: 'Eliminar Ventas' })
    expect(option.parentElement).toBe(action.parentElement)
    expect(option.querySelector('button, [role="button"], input, a')).toBeNull()
    expect(option).toHaveAccessibleName('Ventas')
  })
})
