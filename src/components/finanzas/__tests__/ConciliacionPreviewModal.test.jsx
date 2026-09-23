import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConciliacionPreviewModal from '../ConciliacionPreviewModal.jsx'

describe('ConciliacionPreviewModal', () => {
  it('muestra el resultado de simulación sin botón de aplicación', () => {
    render(<ConciliacionPreviewModal
      open
      onClose={vi.fn()}
      preview={{
        totalServidor: 2,
        versionLibro: '12',
        counts: { total: 2, propuesta: 1, ambiguo: 1, incompatible: 0, asignado: 0, omitido: 0 },
        mappings: [
          { cuentaCustodiaId: 'bvn', cuentaActual: 'Cuenta Venezuela', name: 'Banco de Venezuela', status: 'confirmada' },
          { cuentaCustodiaId: 'g', cuentaActual: 'Gaby3737', name: null, status: 'bloqueada', reason: 'La cuenta no tiene equivalencia canónica confirmada' },
        ],
        rows: [
          { id: 'm1', concepto: 'Banco Venezuela', fecha: '2026-09-21', monto: 100, moneda: 'VES', propuesta: { status: 'propuesta', reason: 'Coincidencia exacta' } },
          { id: 'm2', concepto: 'Sin origen', fecha: '2026-09-21', monto: 50, moneda: 'VES', propuesta: { status: 'ambiguo', reason: 'Hay dos bancos' } },
        ],
      }}
    />)
    expect(screen.getByText('Modo solo lectura')).toBeInTheDocument()
    expect(screen.getByText('Cuenta Venezuela')).toBeInTheDocument()
    expect(screen.getByText(/Bloqueada: La cuenta no tiene equivalencia/)).toBeInTheDocument()
    expect(screen.getByText('2 movimientos revisados · 1 propuesta · 1 ambiguo · 0 incompatibles.')).toBeInTheDocument()
    expect(screen.getByText(/Hay 1 propuesta segura/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'JSON' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /aplicar|asignar/i })).not.toBeInTheDocument()
  })
})
