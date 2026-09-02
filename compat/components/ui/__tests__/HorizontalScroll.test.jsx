// @vitest-environment jsdom
// compat/components/ui/__tests__/HorizontalScroll.test.jsx
// Verifica que el indicador "Desliza" del scroll horizontal aparezca cuando hay
// contenido oculto y desaparezca al llegar al final, y que no se muestre sin desborde.
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import HorizontalScroll from '../HorizontalScroll.jsx'

function renderScroll() {
  const { container } = render(
    <HorizontalScroll>
      <div style={{ width: 1000 }}>contenido ancho</div>
    </HorizontalScroll>,
  )
  const scroller = container.querySelector('[data-testid="hscroll"]')
  return { scroller }
}

function setDims(el, { clientWidth, scrollWidth, scrollLeft }) {
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true })
}

describe('HorizontalScroll', () => {
  it('muestra el aviso "Desliza" cuando hay contenido oculto a la derecha', () => {
    const { scroller } = renderScroll()
    setDims(scroller, { clientWidth: 300, scrollWidth: 1000, scrollLeft: 0 })
    fireEvent.scroll(scroller)
    expect(screen.getByText(/desliza/i)).toBeInTheDocument()
  })

  it('oculta el aviso al llegar al final del scroll', () => {
    const { scroller } = renderScroll()
    setDims(scroller, { clientWidth: 300, scrollWidth: 1000, scrollLeft: 700 })
    fireEvent.scroll(scroller)
    expect(screen.queryByText(/desliza/i)).not.toBeInTheDocument()
  })
})
