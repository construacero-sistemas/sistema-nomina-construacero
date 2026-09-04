// @vitest-environment jsdom
// src/components/nomina/__tests__/HorarioGeneralModal.test.jsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import HorarioGeneralModal from '../HorarioGeneralModal.jsx'

const mockMutateAsync = vi.fn()

vi.mock('../../../hooks/useNomina.js', () => ({
  useGuardarConfigNomina: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

vi.mock('../../../../compat/utils/showToast.js', () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function renderModal(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    configActual: {
      nomina_hora_inicio: '08:00',
      nomina_hora_fin: '17:00',
      nomina_horas_jornada: 8.0,
      nomina_horas_descanso: 1.0,
    },
    ...props,
  }
  return {
    ...render(
      <QueryClientProvider client={qc}>
        <HorarioGeneralModal {...defaultProps} />
      </QueryClientProvider>
    ),
    props: defaultProps,
  }
}

describe('HorarioGeneralModal', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renderiza título, campos e indicador de 12 horas en la vista previa', () => {
    renderModal()
    expect(screen.getByText('Horario Laboral Estándar de la Empresa')).toBeTruthy()
    expect(screen.getAllByText('08:00 AM – 05:00 PM').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('8h efectivas')).toBeTruthy()
  })

  it('permite aplicar un preset predefinido', () => {
    renderModal()
    const presetBtn = screen.getByText('07:30 AM – 04:30 PM')
    fireEvent.click(presetBtn)

    expect(screen.getAllByText('07:30 AM – 04:30 PM').length).toBeGreaterThanOrEqual(2)
  })

  it('envía la configuración actualizada al enviar el formulario', async () => {
    mockMutateAsync.mockResolvedValueOnce({})
    const { props } = renderModal()

    const submitBtn = screen.getByText('Guardar Horario General')
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        nomina_hora_inicio: '08:00',
        nomina_hora_fin: '17:00',
        nomina_horas_jornada: 8,
        nomina_horas_descanso: 1,
      })
      expect(props.onClose).toHaveBeenCalled()
    })
  })
})
