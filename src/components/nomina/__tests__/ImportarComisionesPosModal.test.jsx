// @vitest-environment jsdom
// src/components/nomina/__tests__/ImportarComisionesPosModal.test.jsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ImportarComisionesPosModal from '../ImportarComisionesPosModal.jsx'

vi.mock('../../../../compat/services/authFetch.js', async () => {
  const { apiUrl } = await import('../../../../compat/services/apiBase.js')
  return { authFetch: (path, options) => fetch(apiUrl(path), options) }
})

vi.mock('../../../../compat/services/apiBase.js', () => ({
  apiUrl: (p) => `https://worker.test${p}`,
  getAuthHeaders: async () => ({ Authorization: 'Bearer test' }),
}))

vi.mock('../../../../compat/store/useAuthStore.js', () => {
  const perfil = { id: 'admin-1', rol: 'jefe', nombre: 'Admin Test', cuenta_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' }
  const state = { perfil, user: { id: perfil.cuenta_id }, accountId: perfil.cuenta_id }
  const useAuthStore = vi.fn(selector => (selector ? selector(state) : state))
  useAuthStore.getState = () => state
  return { default: useAuthStore }
})

const mockPeriodo = {
  id: 'b0000000-0000-4000-8000-000000000001',
  nombre: 'Semana 1 Agosto',
  desde: '2026-08-01',
  hasta: '2026-08-07',
  estado: 'abierto',
}

const mockPreviewData = {
  periodo: mockPeriodo,
  total_comisiones_usd: 125.50,
  empleados: [
    {
      empleado_id: 'e0000000-0000-4000-8000-000000000001',
      nombre: 'Luis Ramírez',
      cargo: 'Vendedor',
      pos_vendedor_id: 'v0000000-0000-4000-8000-000000000001',
      tiene_linea_nomina: true,
      linea_id: 'l0000000-0000-4000-8000-000000000001',
      pagado: false,
      comisiones_actuales_usd: 0,
      total_liberado_usd: 125.50,
      despachos_count: 2,
      despachos: [
        {
          id: 'dsp-1',
          despacho_numero: 'DSP-0100',
          cliente_nombre: 'Constructora Alfa',
          fecha: '2026-08-03',
          monto_usd: 75.50,
          tipo: 'contado',
        },
        {
          id: 'dsp-2',
          despacho_numero: 'DSP-0105',
          cliente_nombre: 'Ferretería Beta',
          fecha: '2026-08-05',
          monto_usd: 50.00,
          tipo: 'abono',
        },
      ],
    },
  ],
}

function renderModal(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const fetchMock = vi.fn(async (url, opts = {}) => {
    const path = String(url)
    if (path.includes('/api/nomina/comisiones-pos')) {
      return { ok: true, json: async () => mockPreviewData }
    }
    if (path.includes('/api/nomina/aplicar-comisiones-pos')) {
      return { ok: true, json: async () => ({ ok: true, actualizados: 1, total_comisiones_usd: 125.50 }) }
    }
    return { ok: true, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)

  const utils = render(
    <QueryClientProvider client={qc}>
      <ImportarComisionesPosModal
        periodo={mockPeriodo}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  )

  return { ...utils, fetchMock, qc }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ImportarComisionesPosModal', () => {
  it('renderiza la cabecera y lista de comisiones del vendedor', async () => {
    renderModal()

    expect(screen.getByText(/Semana 1 Agosto/i)).toBeDefined()
    await waitFor(() => {
      expect(screen.getByText('Luis Ramírez')).toBeDefined()
      expect(screen.getByText(/2 tickets en POS/i)).toBeDefined()
    })
  })

  it('permite desplegar los despachos individuales', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('Luis Ramírez')).toBeDefined()
    })

    const expandBtn = screen.getByTitle('Ver despachos')
    fireEvent.click(expandBtn)

    expect(screen.getByText('DSP-0100')).toBeDefined()
    expect(screen.getByText('Constructora Alfa')).toBeDefined()
    expect(screen.getByText('DSP-0105')).toBeDefined()
    expect(screen.getByText('Ferretería Beta')).toBeDefined()
  })

  it('permite aplicar comisiones y llama al endpoint de aplicación', async () => {
    const onSuccess = vi.fn()
    const onClose = vi.fn()
    const { fetchMock } = renderModal({ onSuccess, onClose })

    await waitFor(() => {
      expect(screen.getByText('Luis Ramírez')).toBeDefined()
    })

    const applyBtn = screen.getByText(/Aplicar a Nómina/i)
    fireEvent.click(applyBtn)

    await waitFor(() => {
      const applyCall = fetchMock.mock.calls.find(c => String(c[0]).includes('/api/nomina/aplicar-comisiones-pos'))
      expect(applyCall).toBeDefined()
      expect(onSuccess).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('no contiene emojis en el DOM renderizado (cumple con AGENT.md)', async () => {
    const { container } = renderModal()

    await waitFor(() => {
      expect(screen.getByText('Luis Ramírez')).toBeDefined()
    })

    // Regex para detectar caracteres emoji comunes
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    expect(emojiRegex.test(container.innerHTML)).toBe(false)
  })
})
