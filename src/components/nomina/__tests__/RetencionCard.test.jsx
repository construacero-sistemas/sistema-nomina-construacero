// @vitest-environment jsdom
// src/components/nomina/__tests__/RetencionCard.test.jsx
// Tests del panel de retención: medidor de uso de BD y sincronización del valor guardado.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RetencionCard from '../RetencionCard.jsx'

vi.mock('../../../../compat/services/supabase/client.js', () => ({
  default: { auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }), refreshSession: async () => ({ data: { session: { access_token: 'test' } } }) } },
}))

vi.mock('../../../../compat/services/apiBase.js', () => ({
  apiUrl: (p) => `https://worker.test${p}`,
  getAuthHeaders: async () => ({ Authorization: 'Bearer test' }),
}))

vi.mock('../../../../compat/store/useAuthStore.js', () => ({
  default: { getState: () => ({ perfil: { id: 'op-1' } }) },
}))

const USO = {
  presupuesto_mb: 500,
  total_bytes: 638976,
  total_filas: 917,
  pct: 0.12,
  n_tablas: 2,
  max_fila: 1065,
  tablas: [
    { tabla: 'registro_asistencia', total_bytes: 114688, total_filas: 900, max_fila: 379 },
    { tabla: 'auditoria', total_bytes: 81920, total_filas: 17, max_fila: 1065 },
  ],
}

function renderCard(overrides = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const fetchMock = vi.fn(async (url) => {
    const path = String(url)
    if (path.includes('/api/retencion/uso')) {
      return { ok: true, json: async () => ({ ...USO, ...overrides }) }
    }
    if (path.includes('/api/retencion')) {
      return { ok: true, json: async () => ({ retencion_meses: 6, min_meses: 1, max_meses: 36, ultimos_logs: [] }) }
    }
    return { ok: true, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
  const utils = render(
    <QueryClientProvider client={qc}>
      <RetencionCard />
    </QueryClientProvider>,
  )
  return { ...utils, fetchMock, qc }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('RetencionCard — medidor de uso de BD', () => {
  it('muestra el gauge con % usado, MB y filas totales', async () => {
    const { container } = renderCard()
    const gauge = await screen.findByRole('progressbar', { name: /uso de la base de datos/i })
    expect(gauge).toHaveAttribute('aria-valuenow', '0.12')
    await screen.findByText(/0,12% de 500 MB/)
    expect(await screen.findByText('624 kB')).toBeInTheDocument()
    expect(await screen.findByText('917')).toBeInTheDocument()
    expect(container.textContent).toMatch(/Filas:\s*917 en 2 tabla\(s\)/)
  })

  it('desglosa por tabla con nombre legible, filas y bytes, ordenado por tamaño', async () => {
    renderCard()
    await screen.findByRole('progressbar')
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Asistencia diaria')
    expect(items[0]).toHaveTextContent('900 filas')
    expect(items[1]).toHaveTextContent('Logs de auditoría')
    // El max_fila global se muestra en el encabezado
    expect(await screen.findByText('1.065 B')).toBeInTheDocument()
  })

  it('con 0 bytes la barra está vacía y sin filas no lista nada', async () => {
    renderCard({ total_bytes: 0, total_filas: 0, pct: 0, n_tablas: 0, max_fila: 0, tablas: [] })
    await screen.findByRole('progressbar')
    const gauge = screen.getByRole('progressbar')
    const fill = gauge.firstElementChild
    expect(fill.style.width).toBe('0%')
    expect(screen.getByText(/Aún no hay datos registrados/)).toBeInTheDocument()
  })

  it('muestra aviso si la migración 229 no está aplicada', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // Stub ANTES de render: los efectos de react-query disparan el fetch al montar.
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/api/retencion/uso')) {
        return { ok: false, status: 500, json: async () => ({ error: 'No se pudo medir el uso: function db_usage does not exist' }) }
      }
      return { ok: true, json: async () => ({ retencion_meses: 3, min_meses: 1, max_meses: 36, ultimos_logs: [] }) }
    }))
    const { container } = render(
      <QueryClientProvider client={qc}>
        <RetencionCard />
      </QueryClientProvider>,
    )
    // retry:1 de la query + retryDelay default (~1s) antes del estado de error.
    await waitFor(() => expect(container.textContent).toMatch(/No se pudo medir el uso/i), { timeout: 4000 })
    expect(container.textContent).toMatch(/db_usage does not exist/)
  })
})

describe('RetencionCard — sincronización del valor guardado', () => {
  it('refleja el retencion_meses del servidor (no el default 3)', async () => {
    const { container } = renderCard()
    await waitFor(async () => {
      const input = screen.getByLabelText('Meses de retención')
      await waitFor(() => expect(input.value).toBe('6'))
    })
    expect(container.textContent).toMatch(/Ventana:\s*6 meses/)
  })
})
