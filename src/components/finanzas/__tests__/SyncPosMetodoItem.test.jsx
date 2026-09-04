// @vitest-environment jsdom
// src/components/finanzas/__tests__/SyncPosMetodoItem.test.jsx
// Pruebas unitarias para la selección de cuenta, división multi-banco y paginación de despachos
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Smartphone } from 'lucide-react'
import SyncPosMetodoItem from '../SyncPosMetodoItem.jsx'
import SyncPosDespachosList from '../SyncPosDespachosList.jsx'

afterEach(() => {
  cleanup()
})

const cuentasPrueba = [
  { id: 'c-1', nombre: 'Cuenta Venezuela', moneda: 'VES', tipo: 'banco_ves' },
  { id: 'c-2', nombre: 'Banesco', moneda: 'VES', tipo: 'banco_ves' },
  { id: 'c-3', nombre: 'Caja Efectivo $', moneda: 'USD', tipo: 'efectivo_usd' },
]

const despachosPrueba = Array.from({ length: 14 }, (_, i) => ({
  id: `dsp-${i + 1}-1`,
  despacho_id: `dsp-${i + 1}`,
  numero: `DSP-${1000 + i}`,
  cliente: `Cliente ${i + 1}`,
  fecha: '2026-09-03',
  metodo_original: 'Pago Móvil',
  metodo_clave: 'pago_movil_ves',
  monto_usd: 100,
  monto_ves: 5000,
  tasa: 50,
}))

describe('SyncPosMetodoItem — selección y distribución de pagos', () => {
  it('renderiza el método de pago con su monto y sin emojis', () => {
    render(
      <SyncPosMetodoItem
        metodoKey="pago_movil_ves"
        label="Pago Móvil"
        icon={Smartphone}
        montoOriginal={70000}
        moneda="VES"
        tasaBcv={50}
        despachos={despachosPrueba}
        cuentas={cuentasPrueba}
        config={{ activo: true, cuenta_origen: 'Cuenta Venezuela', dividido: false, partes: [], excluidos: [] }}
        onChangeConfig={vi.fn()}
      />
    )

    expect(screen.getByText('Pago Móvil')).toBeInTheDocument()
    expect(screen.getByText(/Bs\.\s*70\.000,00/i)).toBeInTheDocument()
    expect(screen.getAllByText(/14 despachos/i).length).toBeGreaterThanOrEqual(1)
    // Sin emojis en el DOM
    const bodyText = document.body.textContent || ''
    expect(bodyText).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u)
  })

  it('permite alternar el estado activo mediante el checkbox accesible', () => {
    const onChangeConfig = vi.fn()
    render(
      <SyncPosMetodoItem
        metodoKey="pago_movil_ves"
        label="Pago Móvil"
        icon={Smartphone}
        montoOriginal={70000}
        moneda="VES"
        tasaBcv={50}
        despachos={[]}
        cuentas={cuentasPrueba}
        config={{ activo: true, cuenta_origen: 'Cuenta Venezuela', dividido: false, partes: [], excluidos: [] }}
        onChangeConfig={onChangeConfig}
      />
    )

    const btnToggle = screen.getByRole('button', { name: /Desmarcar Pago Móvil/i })
    fireEvent.click(btnToggle)

    expect(onChangeConfig).toHaveBeenCalledWith(
      expect.objectContaining({ activo: false })
    )
  })

  it('activa el modo dividido y calcula la distribución inicial entre cuentas', () => {
    const onChangeConfig = vi.fn()
    render(
      <SyncPosMetodoItem
        metodoKey="pago_movil_ves"
        label="Pago Móvil"
        icon={Smartphone}
        montoOriginal={10000}
        moneda="VES"
        tasaBcv={50}
        despachos={[]}
        cuentas={cuentasPrueba}
        config={{ activo: true, cuenta_origen: 'Cuenta Venezuela', dividido: false, partes: [], excluidos: [] }}
        onChangeConfig={onChangeConfig}
      />
    )

    const btnDividir = screen.getByRole('button', { name: /Dividir entre cuentas/i })
    fireEvent.click(btnDividir)

    expect(onChangeConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        dividido: true,
        partes: expect.arrayContaining([
          expect.objectContaining({ monto: 5000 }),
          expect.objectContaining({ monto: 5000 }),
        ]),
      })
    )
  })

  it('muestra aviso de cuadre exacto cuando la suma de partes coincide al 100%', () => {
    render(
      <SyncPosMetodoItem
        metodoKey="pago_movil_ves"
        label="Pago Móvil"
        icon={Smartphone}
        montoOriginal={10000}
        moneda="VES"
        tasaBcv={50}
        despachos={[]}
        cuentas={cuentasPrueba}
        config={{
          activo: true,
          dividido: true,
          partes: [
            { cuenta_origen: 'Cuenta Venezuela', monto: 6000 },
            { cuenta_origen: 'Banesco', monto: 4000 },
          ],
          excluidos: [],
        }}
        onChangeConfig={vi.fn()}
      />
    )

    expect(screen.getByText(/Distribución exacta cuadra al 100%/i)).toBeInTheDocument()
  })

  it('muestra aviso de faltante cuando la suma de partes es menor al total', () => {
    render(
      <SyncPosMetodoItem
        metodoKey="pago_movil_ves"
        label="Pago Móvil"
        icon={Smartphone}
        montoOriginal={10000}
        moneda="VES"
        tasaBcv={50}
        despachos={[]}
        cuentas={cuentasPrueba}
        config={{
          activo: true,
          dividido: true,
          partes: [
            { cuenta_origen: 'Cuenta Venezuela', monto: 6000 },
            { cuenta_origen: 'Banesco', monto: 2000 }, // Faltan 2000
          ],
          excluidos: [],
        }}
        onChangeConfig={vi.fn()}
      />
    )

    expect(screen.getByText(/Falta por asignar: Bs\. 2\.000,00/i)).toBeInTheDocument()
  })
})

describe('SyncPosDespachosList — paginación obligatoria de 6 filas y selección individual', () => {
  it('pagina a 6 despachos por página y permite navegar a la siguiente página', () => {
    render(
      <SyncPosDespachosList
        despachos={despachosPrueba} // 14 despachos -> 3 páginas (6 + 6 + 2)
        excluidos={[]}
        onToggleDespacho={vi.fn()}
        onToggleTodos={vi.fn()}
        moneda="VES"
      />
    )

    // Primera página muestra DSP-1000 hasta DSP-1005
    expect(screen.getByText('DSP-1000')).toBeInTheDocument()
    expect(screen.getByText('DSP-1005')).toBeInTheDocument()
    expect(screen.queryByText('DSP-1006')).toBeNull()
    expect(screen.getByText(/Página 1 de 3/i)).toBeInTheDocument()

    // Clic en Siguiente
    const btnSiguiente = screen.getByRole('button', { name: /Siguiente/i })
    fireEvent.click(btnSiguiente)

    // Segunda página muestra DSP-1006
    expect(screen.getByText('DSP-1006')).toBeInTheDocument()
    expect(screen.getByText(/Página 2 de 3/i)).toBeInTheDocument()
  })

  it('permite desmarcar y marcar tickets individuales', () => {
    const onToggle = vi.fn()
    render(
      <SyncPosDespachosList
        despachos={despachosPrueba.slice(0, 3)}
        excluidos={['dsp-1-1']}
        onToggleDespacho={onToggle}
        onToggleTodos={vi.fn()}
        moneda="VES"
      />
    )

    const btnDespacho2 = screen.getByRole('button', { name: /Desmarcar DSP-1001/i })
    fireEvent.click(btnDespacho2)

    expect(onToggle).toHaveBeenCalledWith('dsp-2-1')
  })
})
