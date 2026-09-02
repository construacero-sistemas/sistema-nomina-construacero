// src/constants/formasPago.js
// Estructura de Carteras y Métodos de Pago estandarizados de Construacero.
import {
  Banknote,
  Building2,
  CreditCard,
  DollarSign,
  Globe,
  Smartphone,
  Wallet,
} from 'lucide-react'

export const CARTERAS = [
  {
    id: 'USD',
    nombre: 'Cartera en Dólares',
    simbolo: '$',
    monedaBase: 'USD',
    color: 'emerald',
    icon: DollarSign,
    subcuentas: [
      { id: 'Efectivo $',          nombre: 'Efectivo en Dólares ($)',         moneda: 'USD', icon: DollarSign },
      { id: 'Zelle',               nombre: 'Zelle (USD)',                     moneda: 'USD', icon: Globe },
      { id: 'USDT',                nombre: 'USDT (Binance / Cripto)',          moneda: 'USDT', icon: Globe },
    ],
  },
  {
    id: 'VES',
    nombre: 'Cartera en Bolívares',
    simbolo: 'Bs.',
    monedaBase: 'VES',
    color: 'blue',
    icon: Building2,
    subcuentas: [
      { id: 'Efectivo Bs',         nombre: 'Efectivo en Bolívares (Bs)',        moneda: 'VES', icon: Banknote },
      { id: 'Banco en Bolívares',  nombre: 'Banco en Bolívares (Bs)',           moneda: 'VES', icon: Building2 },
    ],
  },
]

export const FORMAS_PAGO = [
  'Efectivo $',
  'Zelle',
  'USDT',
  'Efectivo Bs',
  'Banco en Bolívares',
  'Transferencia',
  'Pago Móvil',
  'Punto de Venta',
  'Transf. / Pago Móvil',
]

/** Opciones para Traspasos y Conversión entre Cuentas de Custodia */
export const FORMAS_PAGO_TRANSFERENCIA_OPCIONES = [
  // Cartera USD
  { value: 'Efectivo $',          label: 'Efectivo en Dólares ($)',         selectedLabel: 'Efectivo $',            cartera: 'USD', moneda: 'USD', icon: DollarSign, sub: 'Cartera USD' },
  { value: 'Zelle',               label: 'Zelle (USD)',                     selectedLabel: 'Zelle',                  cartera: 'USD', moneda: 'USD', icon: Globe,      sub: 'Cartera USD' },
  { value: 'USDT',                label: 'USDT (Binance / Cripto)',          selectedLabel: 'USDT (Cripto)',          cartera: 'USD', moneda: 'USDT', icon: Globe,     sub: 'Cartera USD' },
  // Cartera Bolívares (Cuentas Reales de Custodia)
  { value: 'Efectivo Bs',         label: 'Efectivo en Bolívares (Bs)',        selectedLabel: 'Efectivo Bs',           cartera: 'VES', moneda: 'VES', icon: Banknote,   sub: 'Cartera Bs' },
  { value: 'Banco en Bolívares',  label: 'Banco en Bolívares (Bs)',           selectedLabel: 'Banco en Bolívares',     cartera: 'VES', moneda: 'VES', icon: Building2,  sub: 'Cartera Bs' },
]

export const FORMAS_PAGO_OPCIONES = [
  // Cartera USD
  { value: 'Efectivo $',          label: 'Efectivo en Dólares ($)',         selectedLabel: 'Efectivo $',         cartera: 'USD', moneda: 'USD', icon: DollarSign, sub: 'Cartera USD', requiereReferencia: false },
  { value: 'Zelle',               label: 'Zelle (USD)',                     selectedLabel: 'Zelle',               cartera: 'USD', moneda: 'USD', icon: Globe,      sub: 'Cartera USD', requiereReferencia: true },
  { value: 'USDT',                label: 'USDT (Binance / Cripto)',          selectedLabel: 'USDT (Cripto)',       cartera: 'USD', moneda: 'USDT', icon: Globe,     sub: 'Cartera USD', requiereReferencia: true },
  // Cartera Bolívares (Cuentas y Métodos)
  { value: 'Efectivo Bs',         label: 'Efectivo en Bolívares (Bs)',        selectedLabel: 'Efectivo Bs',        cartera: 'VES', moneda: 'VES', icon: Banknote,   sub: 'Cartera Bs', requiereReferencia: false },
  { value: 'Banco en Bolívares',  label: 'Banco en Bolívares (Bs)',           selectedLabel: 'Banco en Bolívares', cartera: 'VES', moneda: 'VES', icon: Building2,  sub: 'Cartera Bs', requiereReferencia: true },
  { value: 'Transferencia',       label: 'Transferencia Bancaria (Bs)',       selectedLabel: 'Transferencia Bs',   cartera: 'VES', moneda: 'VES', icon: Building2,  sub: 'Cartera Bs', requiereReferencia: true },
  { value: 'Pago Móvil',          label: 'Pago Móvil (Bs)',                  selectedLabel: 'Pago Móvil Bs',      cartera: 'VES', moneda: 'VES', icon: Smartphone, sub: 'Cartera Bs', requiereReferencia: true },
  // soloIngreso: el POS es terminal de COBRO → solo genera entradas; no tiene sentido como egreso.
  { value: 'Punto de Venta',      label: 'Punto de Venta (Bs)',              selectedLabel: 'Punto Venta Bs',     cartera: 'VES', moneda: 'VES', icon: CreditCard, sub: 'Cartera Bs', requiereReferencia: true, soloIngreso: true },
]

export const FORMAS_PAGO_NOMINA_OPCIONES = [
  { value: 'Transferencia',       label: 'Transferencia Bancaria (Bs)',       cartera: 'VES', moneda: 'VES', icon: Building2 },
  { value: 'Pago Móvil',          label: 'Pago Móvil (Bs)',                  cartera: 'VES', moneda: 'VES', icon: Smartphone },
  { value: 'Efectivo $',          label: 'Efectivo en Dólares ($)',         cartera: 'USD', moneda: 'USD', icon: DollarSign },
  { value: 'Efectivo Bs',         label: 'Efectivo en Bolívares (Bs)',        cartera: 'VES', moneda: 'VES', icon: Banknote },
  { value: 'Zelle',               label: 'Zelle (USD)',                     cartera: 'USD', moneda: 'USD', icon: Globe },
  { value: 'USDT',                label: 'USDT (Binance / Cripto)',          cartera: 'USD', moneda: 'USDT', icon: Globe },
  { value: 'Punto de Venta',      label: 'Punto de Venta (Bs)',              cartera: 'VES', moneda: 'VES', icon: CreditCard },
]

/** Retorna la cartera correspondiente a un método de pago ('USD' o 'VES') */
export function getCarteraDeMetodo(metodo) {
  const m = String(metodo || '').toLowerCase()
  if (m.includes('usdt') || m.includes('zelle') || (m.includes('efectivo') && m.includes('$')) || m.includes('dólar') || m.includes('dolar')) {
    return 'USD'
  }
  return 'VES'
}
