import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CarterasHeader from '../CarterasHeader.jsx'

describe('CarterasHeader — acceso a la simulación de conciliación', () => {
  it('muestra el botón aunque las filas cargadas no tengan pendientes, si el libro sigue pendiente', () => {
    render(<CarterasHeader
      saldos={null}
      conciliacionPendiente
      sinCuenta={{ sinCuenta: 0, total: 50, totalServidor: 94 }}
      onPreviewConciliacion={vi.fn()}
    />)
    expect(screen.getByRole('button', { name: /Simular conciliación segura/ })).toBeInTheDocument()
    expect(screen.queryByText(/sin cuenta en/)).not.toBeInTheDocument()
  })

  it('muestra el contador y abre la simulación cuando las filas cargadas incluyen pendientes', () => {
    const onPreview = vi.fn()
    render(<CarterasHeader
      saldos={null}
      conciliacionPendiente
      sinCuenta={{ sinCuenta: 11, total: 94, totalServidor: 94 }}
      onPreviewConciliacion={onPreview}
    />)
    expect(screen.getByText(/11 sin cuenta en 94 cargados/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Simular conciliación segura/ }))
    expect(onPreview).toHaveBeenCalledTimes(1)
  })

  it('oculta el bloque cuando no hay pendientes ni en las filas ni en el libro', () => {
    render(<CarterasHeader
      saldos={null}
      conciliacionPendiente={false}
      sinCuenta={{ sinCuenta: 0, total: 50, totalServidor: 50 }}
      onPreviewConciliacion={vi.fn()}
    />)
    expect(screen.queryByRole('button', { name: /Simular conciliación segura/ })).not.toBeInTheDocument()
  })
})
