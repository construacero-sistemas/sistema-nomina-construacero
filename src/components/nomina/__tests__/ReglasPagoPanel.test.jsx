// @vitest-environment jsdom
// Configuración → «Reglas de pago y de la ley»: lo que se guarda y quién puede guardarlo.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const mocks = vi.hoisted(() => ({ guardar: vi.fn(async () => ({})), rol: 'jefe' }))

vi.mock('../../../hooks/useNomina.js', () => ({
  useGuardarConfigNomina: () => ({ mutateAsync: mocks.guardar, isPending: false }),
}))
vi.mock('../../../../compat/store/useAuthStore.js', () => {
  const useAuthStore = vi.fn(selector => {
    const state = { perfil: { rol: mocks.rol } }
    return selector ? selector(state) : state
  })
  useAuthStore.getState = () => ({ perfil: { rol: mocks.rol } })
  return { default: useAuthStore }
})

const ReglasPagoPanel = (await import('../ReglasPagoPanel.jsx')).default

// Configuración como la dejó la empresa en Excel: montos fijos de $2,50 y $10.
const CONFIG_EXCEL = {
  nomina_factor_hora_extra: 1.5, nomina_monto_hora_extra_usd: 2.5,
  nomina_factor_sabado: 1.25, nomina_monto_sabado_usd: 10,
  nomina_factor_feriado: 2, nomina_monto_feriado_usd: 10, nomina_feriado_modo: 'monto_fijo',
}

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.rol = 'jefe' })

const renderPanel = (data = CONFIG_EXCEL) => render(<ReglasPagoPanel config={{ data, isLoading: false }} />)

describe('ReglasPagoPanel', () => {
  it('muestra cada concepto en su modo actual', () => {
    renderPanel()
    expect(screen.getByRole('textbox', { name: 'Hora extra: monto fijo' })).toHaveValue('2.5')
    expect(screen.getByRole('textbox', { name: 'Divisor del sueldo mensual' })).toHaveValue('30')
  })

  it('pasa a factor 2,5 en horas extra y factor 1 en sábado y feriado, y lo guarda limpiando los montos', async () => {
    renderPanel()
    for (const titulo of ['Hora extra', 'Sábado trabajado', 'Domingo o feriado trabajado']) {
      fireEvent.click(screen.getByRole('radiogroup', { name: `Cómo se paga: ${titulo}` }).querySelector('[role="radio"]'))
    }
    fireEvent.change(screen.getByRole('textbox', { name: 'Hora extra: factor' }), { target: { value: '2,5' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Sábado trabajado: factor' }), { target: { value: '1' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Domingo o feriado trabajado: factor' }), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }))
    await vi.waitFor(() => expect(mocks.guardar).toHaveBeenCalledTimes(1))
    const payload = mocks.guardar.mock.calls[0][0]
    expect(payload).toMatchObject({
      nomina_factor_hora_extra: 2.5, nomina_monto_hora_extra_usd: null,
      nomina_factor_sabado: 1, nomina_monto_sabado_usd: null,
      nomina_factor_feriado: 1, nomina_monto_feriado_usd: null, nomina_feriado_modo: 'factor',
      nomina_divisor_mensual: 30, nomina_dias_laborables_default: [1, 2, 3, 4, 5],
      nomina_descanso_remunerado: true, nomina_faltas_pierde_descanso: 2,
    })
  })

  it('«Valores de la ley» propone los mínimos de la LOTTT sin guardar', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /Valores de la ley/ }))
    expect(screen.getByRole('textbox', { name: 'Hora extra: factor' })).toHaveValue('1.5')
    expect(mocks.guardar).not.toHaveBeenCalled()
  })

  it('no guarda un factor menor que 1', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('radiogroup', { name: 'Cómo se paga: Hora extra' }).querySelector('[role="radio"]'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Hora extra: factor' }), { target: { value: '0.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar reglas' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/entre 1 y 10/)
    expect(mocks.guardar).not.toHaveBeenCalled()
  })

  it('el rol nómina puede cambiar las reglas', () => {
    mocks.rol = 'nomina'
    renderPanel()
    expect(screen.queryByText('Solo quien administra la nómina puede cambiar estas reglas.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Guardar reglas' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Divisor del sueldo mensual' })).not.toBeDisabled()
  })

  it('un rol sin nómina ve las reglas pero no puede cambiarlas', () => {
    mocks.rol = 'finanzas'
    renderPanel()
    expect(screen.getByText('Solo quien administra la nómina puede cambiar estas reglas.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar reglas' })).toBeNull()
  })
})
