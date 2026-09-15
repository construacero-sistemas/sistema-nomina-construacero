import { useRef } from 'react'
import { useCrearMovimiento } from './useFinanzas.js'
import useAuthStore from '../../compat/store/useAuthStore.js'
import { isoToday } from '../components/finanzas/fechasRapidas.js'

// La cuenta y su apertura son dos confirmaciones explícitas. Un reintento no
// vuelve a crear la cuenta ni cambia la clave/cuerpo del movimiento pendiente.
export default function useCustodySave({ agregarCuenta, editarCuenta, usd, usdt }) {
  const crearMovimiento = useCrearMovimiento()
  const pending = useRef(null)
  return async (fields, amount = 0, operationId, editingId = null) => {
    if (editingId) return editarCuenta(editingId, fields)
    if (!operationId) throw new Error('Falta la identidad del formulario. Vuelve a abrirlo.')
    const owner = useAuthStore.getState().accountId
    const generation = useAuthStore.getState().sessionGeneration
    const current = () => {
      const state = useAuthStore.getState()
      if (state.accountId !== owner || state.sessionGeneration !== generation) throw new DOMException('La sesión cambió', 'AbortError')
    }
    const fingerprint = JSON.stringify({ fields, amount })
    let record = pending.current
    if (!record || record.operationId !== operationId || record.owner !== owner) {
      const rate = fields.moneda === 'USDT' ? usdt : usd
      if (!Number.isFinite(Number(amount)) || amount < 0) throw new Error('El saldo de apertura es inválido.')
      if (amount > 0 && (!(usd > 0) || !(rate > 0))) throw new Error('Confirma las tasas antes de registrar la apertura.')
      record = { operationId, owner, fingerprint, cuenta: null, movement: amount > 0 ? {
        idempotencyKey: `apertura:${operationId}`, tipo: 'ingreso', categoria: 'Saldo Inicial',
        concepto: `Saldo inicial / Apertura de cuenta (${fields.nombre})`.slice(0, 180),
        monto: Number(amount), moneda: fields.moneda,
        tasaVes: fields.moneda === 'VES' ? 1 : rate, tasaUsdVes: usd,
        fuenteTasa: fields.moneda === 'USDT' ? 'USDT' : 'BCV',
        observacionTasa: 'Tasas confirmadas al iniciar la apertura', cuentaOrigen: fields.nombre,
        cuentaCustodiaId: operationId,
        metodoPago: ({ banco_ves: 'Banco en Bolívares', cripto_usdt: 'USDT', zelle: 'Zelle', efectivo_usd: 'Efectivo $' })[fields.tipo] || 'Efectivo Bs',
        fecha: isoToday(), referencia: 'Apertura',
      } : null }
      pending.current = record
    }
    if (record.fingerprint !== fingerprint) throw new Error('Conserva los datos originales mientras se confirma la apertura. No crees una cuenta nueva.')
    if (!record.cuenta) {
      const result = await agregarCuenta({ ...fields, id: operationId })
      current()
      if (!result?.ok || result.cuenta?.id !== operationId) throw new Error('La creación de la cuenta no pudo verificarse. Reintenta sin cambiar los datos.')
      record.cuenta = result.cuenta
    }
    if (record.movement) {
      try { await crearMovimiento.mutateAsync(record.movement); current() }
      catch (error) {
        if (error.name === 'AbortError') throw error
        throw new Error(`La cuenta ya está creada, pero la apertura no se confirmó. Reintenta los mismos datos; no se duplicará la cuenta. ${error.message}`)
      }
    }
    pending.current = null
    return { ok: true, cuenta: record.cuenta }
  }
}
