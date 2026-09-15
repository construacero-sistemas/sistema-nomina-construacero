import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from '../Modal.jsx'
import CustomSelect from '../CustomSelect.jsx'
import DatePicker from '../DatePicker.jsx'

const OPTIONS = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]

function NestedForm({ onClose = () => {} }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open form</button>
    <Modal isOpen={open} title="Parent form" onClose={() => { setOpen(false); onClose() }}>
      <input aria-label="Unsaved note" defaultValue="Keep this note" />
      <CustomSelect placeholder="Category" options={OPTIONS} value="" onChange={() => {}} searchable />
      <DatePicker value="2026-09-15" onChange={() => {}} />
      <button type="button">Final action</button>
    </Modal>
  </>
}

function LocalDraft() {
  const [draft, setDraft] = useState('Initial draft')
  return <input aria-label="Local draft" value={draft} onChange={event => setDraft(event.target.value)} />
}

beforeEach(() => {
  vi.stubGlobal('innerWidth', 390)
  vi.stubGlobal('innerHeight', 844)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('coordinated overlay interaction', () => {
  it.each([390, 1280])('Escape dismisses only the child at width %i and restores both focus levels', async width => {
    vi.stubGlobal('innerWidth', width)
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<NestedForm onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Open form' })
    await user.click(opener)
    const parent = screen.getByRole('dialog', { name: 'Parent form' })
    const trigger = screen.getByRole('combobox', { name: 'Category' })
    await user.click(trigger)
    const child = screen.getByRole('dialog', { name: 'Category' })
    const search = within(child).getByRole('combobox', { name: 'Buscar: Category' })
    expect(search).toHaveFocus()
    expect(parent.closest('[inert]')).not.toBeNull()
    expect(child.closest('[inert]')).toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Category' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Parent form' })).toBe(parent)
    expect(onClose).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Unsaved note' })).toHaveValue('Keep this note')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('traps Tab and Shift+Tab in the active portal and rejects focus in its parent', async () => {
    const user = userEvent.setup()
    render(<NestedForm />)
    await user.click(screen.getByRole('button', { name: 'Open form' }))
    const parent = screen.getByRole('dialog', { name: 'Parent form' })
    await user.click(screen.getByRole('combobox', { name: 'Category' }))
    const child = screen.getByRole('dialog', { name: 'Category' })
    const first = within(child).getByRole('button', { name: 'Cerrar opciones' })
    const last = within(child).getByRole('button', { name: 'Cerrar', exact: true })
    last.focus()
    await user.tab()
    expect(first).toHaveFocus()
    await user.tab({ shift: true })
    expect(last).toHaveFocus()
    parent.querySelector('input').focus()
    expect(child).toContainElement(document.activeElement)
    await user.keyboard('{Escape}')
    expect(parent.closest('[inert]')).toBeNull()
  })

  it('uses the latest busy flag and close callback without resetting field focus', async () => {
    const user = userEvent.setup()
    const oldClose = vi.fn()
    const latestClose = vi.fn()
    const view = render(<Modal isOpen title="Save record" onClose={oldClose}><input aria-label="Draft" /></Modal>)
    const input = screen.getByRole('textbox', { name: 'Draft' })
    await user.click(input)
    await user.type(input, 'Do not discard')
    view.rerender(<Modal isOpen title="Save record" busy onClose={latestClose}><input aria-label="Draft" /></Modal>)
    expect(input).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(oldClose).not.toHaveBeenCalled()
    expect(latestClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeDisabled()
    view.rerender(<Modal isOpen title="Save record" onClose={latestClose}><input aria-label="Draft" /></Modal>)
    await user.keyboard('{Escape}')
    expect(latestClose).toHaveBeenCalledTimes(1)
    expect(oldClose).not.toHaveBeenCalled()
    expect(input).toHaveValue('Do not discard')
  })

  it('allows an absent close callback and traps an otherwise empty dialog', async () => {
    const user = userEvent.setup()
    const view = render(<Modal isOpen title="Read only" busy />)
    const dialog = screen.getByRole('dialog', { name: 'Read only' })
    await user.tab()
    expect(dialog).toHaveFocus()
    view.rerender(<Modal isOpen title="Read only" />)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(dialog).toBeInTheDocument()
  })

  it('preserves a local draft when the user continues after a dirty close request', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Modal isOpen title="Dirty form" dirty onClose={onClose}><LocalDraft /></Modal>)
    const input = screen.getByRole('textbox', { name: 'Local draft' })
    await user.clear(input)
    await user.type(input, 'Unsaved replacement')
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Seguir editando' }))
    expect(screen.getByRole('textbox', { name: 'Local draft' })).toHaveValue('Unsaved replacement')
    expect(screen.getByRole('textbox', { name: 'Local draft' })).toHaveFocus()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('blocks discarding when busy starts after the dirty prompt is visible', async () => {
    const user = userEvent.setup(), onClose = vi.fn()
    const view = render(<Modal isOpen title="Draft" dirty onClose={onClose}><LocalDraft /></Modal>)
    await user.click(screen.getByRole('textbox', { name: 'Local draft' }))
    await user.keyboard('{Escape}')
    view.rerender(<Modal isOpen title="Draft" dirty busy onClose={onClose}><LocalDraft /></Modal>)
    expect(screen.getByRole('button', { name: 'Descartar cambios' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Descartar cambios' }))
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('restores existing inert attributes, body styles and scroll after StrictMode teardown', async () => {
    const user = userEvent.setup()
    const fixed = document.createElement('div')
    fixed.setAttribute('inert', '')
    fixed.setAttribute('aria-hidden', 'false')
    document.body.appendChild(fixed)
    const previousStyle = document.body.getAttribute('style')
    document.body.style.position = 'relative'
    document.body.style.overflow = 'auto'
    document.body.style.paddingRight = '7px'
    vi.stubGlobal('scrollY', 240)
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    try {
      render(<StrictMode><NestedForm /></StrictMode>)
      await user.click(screen.getByRole('button', { name: 'Open form' }))
      expect(document.body.style.position).toBe('fixed')
      expect(document.body.style.top).toBe('-240px')
      await user.click(screen.getByRole('combobox', { name: 'Category' }))
      await user.keyboard('{Escape}')
      expect(document.body.style.position).toBe('fixed')
      await user.keyboard('{Escape}')
      expect(document.body.style.position).toBe('relative')
      expect(document.body.style.overflow).toBe('auto')
      expect(document.body.style.paddingRight).toBe('7px')
      expect(scrollTo).toHaveBeenCalledWith(0, 240)
      expect(fixed).toHaveAttribute('inert', '')
      expect(fixed).toHaveAttribute('aria-hidden', 'false')
    } finally {
      cleanup()
      fixed.remove()
      if (previousStyle === null) document.body.removeAttribute('style')
      else document.body.setAttribute('style', previousStyle)
    }
  })

  it('repositions the desktop selector on container scrolling and viewport resizing', async () => {
    vi.stubGlobal('innerWidth', 1280)
    const user = userEvent.setup()
    render(<CustomSelect placeholder="Category" options={OPTIONS} value="" onChange={() => {}} />)
    const trigger = screen.getByRole('combobox', { name: 'Category' })
    let rect = { left: 100, right: 400, top: 100, bottom: 144, width: 300, height: 44 }
    vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => rect)
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Category' })
    expect(dialog.style.left).toBe('100px')
    expect(dialog.style.top).toBe('150px')
    rect = { ...rect, left: 160, right: 460, top: 130, bottom: 174 }
    fireEvent.scroll(window)
    expect(dialog.style.left).toBe('160px')
    expect(dialog.style.top).toBe('180px')
    vi.stubGlobal('innerWidth', 900)
    rect = { ...rect, left: 820, right: 1120 }
    fireEvent.resize(window)
    expect(Number.parseFloat(dialog.style.left) + Number.parseFloat(dialog.style.width)).toBeLessThanOrEqual(888)
  })

  it('keeps the parent form open when Escape dismisses its calendar', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<NestedForm onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Open form' }))
    const trigger = screen.getByRole('button', { name: 'Fecha: 15/09/2026' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Elegir fecha' })).toContainElement(document.activeElement)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Elegir fecha' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Parent form' })).toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('DatePicker real dates and keyboard boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 25, 12))
  })

  function renderCalendar(props = {}) {
    const onChange = vi.fn()
    render(<DatePicker value="2026-09-15" onChange={onChange} min="2026-09-10" max="2026-09-20" {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /^Fecha:/ }))
    return { onChange, dialog: screen.getByRole('dialog', { name: 'Elegir fecha' }) }
  }

  it('rejects days 1 and 30 and Today outside min/max for mouse, touch and keyboard', async () => {
    const user = userEvent.setup()
    const { onChange, dialog } = renderCalendar()
    const first = within(dialog).getByRole('button', { name: /martes, 1 de septiembre de 2026/i })
    const thirtieth = within(dialog).getByRole('button', { name: /miércoles, 30 de septiembre de 2026/i })
    const today = within(dialog).getByRole('button', { name: 'Hoy' })
    for (const button of [first, thirtieth, today]) {
      expect(button).toBeDisabled()
      await user.click(button)
      await user.pointer([{ keys: '[TouchA>]', target: button }, { keys: '[/TouchA]' }])
      fireEvent.keyDown(button, { key: 'Enter' })
    }
    expect(onChange).not.toHaveBeenCalled()
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Mes anterior' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Mes siguiente' })).toBeDisabled()
  })

  it('clamps arrow navigation at min and max, then emits a valid keyboard selection', async () => {
    const user = userEvent.setup()
    const { onChange, dialog } = renderCalendar()
    expect(document.activeElement).toHaveAttribute('data-date', '2026-09-15')
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toHaveAttribute('data-date', '2026-09-10')
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toHaveAttribute('data-date', '2026-09-10')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(document.activeElement).toHaveAttribute('data-date', '2026-09-20')
    await user.keyboard('{ArrowRight}{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-09-20')
    expect(dialog).not.toBeInTheDocument()
  })

  it('names adjacent-month days uniquely and exposes grid selection and current date', () => {
    const { dialog } = renderCalendar({ min: undefined, max: undefined })
    expect(within(dialog).getByRole('grid', { name: 'Septiembre 2026' })).toBeInTheDocument()
    expect(within(dialog).getAllByRole('columnheader')).toHaveLength(7)
    expect(within(dialog).getByRole('button', { name: /martes, 1 de septiembre de 2026/i })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /jueves, 1 de octubre de 2026/i })).toBeInTheDocument()
    const selected = within(dialog).getByRole('button', { name: /martes, 15 de septiembre de 2026/i })
    expect(selected.closest('[role="gridcell"]')).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByRole('button', { name: /viernes, 25 de septiembre de 2026/i })).toHaveAttribute('aria-current', 'date')
    expect(dialog.querySelector('button button, button [role="button"], button input')).toBeNull()
  })

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '0000-01-01'])('does not normalize invalid value %s into another date', value => {
    render(<DatePicker value={value} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Fecha: DD/MM/AAAA' })).toHaveTextContent('DD/MM/AAAA')
  })

  it('clears through a sibling native button without opening the calendar', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DatePicker value="2026-09-15" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: 'Fecha: 15/09/2026' })
    const clear = screen.getByRole('button', { name: 'Borrar fecha' })
    expect(clear.parentElement).toBe(trigger.parentElement)
    expect(trigger.contains(clear)).toBe(false)
    clear.focus()
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('navigates Home, End and PageDown with one roving day tab stop', async () => {
    const user = userEvent.setup()
    const { dialog } = renderCalendar({ min: undefined, max: undefined })
    await user.keyboard('{Home}')
    expect(document.activeElement).toHaveAttribute('data-date', '2026-09-13')
    await user.keyboard('{End}')
    expect(document.activeElement).toHaveAttribute('data-date', '2026-09-19')
    await user.keyboard('{PageDown}')
    expect(document.activeElement).toHaveAttribute('data-date', '2026-10-19')
    expect(dialog.querySelectorAll('button[data-date][tabindex="0"]')).toHaveLength(1)
  })
})
