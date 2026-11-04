// src/components/finanzas/CierreMesWizard.jsx
// Cierre del mes en 3 pasos: 1) contar el dinero de cada cuenta, 2) revisar, 3) listo
// (PDF y apertura del mes siguiente). Cada cuenta exige una acción del usuario: el campo
// empieza vacío y "Coincide" copia el saldo del sistema, así nadie cierra por accidente.
import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileText, LockKeyhole, RefreshCw } from 'lucide-react'
import { Modal } from '../../../compat/components/ui/Modal.jsx'
import { formatNumber, normalizarMontoInput } from './formatos.js'
import { conteoValido } from '../../utils/montoUtils.js'
import { cargarCierre, cargarMovimientosCierre } from '../../hooks/useHistorialCierres.js'
import { generarFinanzasResumenPDF } from '../../services/pdf/finanzasResumenPDF.js'

const money = value => value == null ? '—' : formatNumber(value)
const signo = value => `${value > 0 ? '+' : ''}${formatNumber(value)}`
const idDe = wallet => wallet.cuentaCustodiaId
const PASOS = ['Cuenta el dinero', 'Revisa', 'Listo']

// Equivalente a la tasa del día: las cuentas en Bs y USDT se ven en dólares; las de dólares, en Bs.
function equivalente(monto, moneda, rates) {
  const usd = Number(rates?.usd), usdt = Number(rates?.usdt), valor = Number(monto)
  if (!Number.isFinite(valor) || !(usd > 0)) return null
  if (moneda === 'USD') return `≈ ${formatNumber(valor * usd)} Bs`
  if (moneda === 'VES') return `≈ $${formatNumber(valor / usd)} USD`
  if (moneda === 'USDT' && usdt > 0) return `≈ $${formatNumber(valor * usdt / usd)} USD`
  return null
}
const MIN_MOTIVO = 8

// Saldo que da el sistema al final del mes. Una cuenta sin apertura (el cierre la da de
// alta sola) usa su saldo histórico completo.
const saldoSistemaDe = wallet => wallet.saldoCalculado != null
  ? Number(wallet.saldoCalculado)
  : (wallet.saldoHistorico != null ? Number(wallet.saldoHistorico) : NaN)

function Pasos({ paso }) {
  return (
    <ol className="flex items-center gap-2 border-b border-slate-100 pb-3 text-xs font-bold">
      {PASOS.map((nombre, index) => (
        <li key={nombre} aria-current={paso === index ? 'step' : undefined}
          className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 ${paso === index ? 'bg-primary text-white' : paso > index ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-black ${paso === index ? 'bg-white text-primary' : paso > index ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
            {paso > index ? '✓' : index + 1}
          </span>
          <span className="truncate">{nombre}</span>
        </li>
      ))}
    </ol>
  )
}

export default function CierreMesWizard({ periodo, mesNombre, mesSiguienteNombre, rates, pending, onConfirmClose, onRefresh, onClose, onAbrirSiguiente }) {
  const wallets = periodo?.cuentas || []
  const [paso, setPaso] = useState(0)
  const [conteo, setConteo] = useState({})
  const [mensaje, setMensaje] = useState('')
  const [descargando, setDescargando] = useState(false)
  const claveRef = useRef(null)
  const mesRef = useRef(periodo?.mes)

  const fila = wallet => {
    const entrada = conteo[idDe(wallet)] || {}
    const sistema = saldoSistemaDe(wallet)
    const escrito = String(entrada.saldoReal ?? '').trim()
    const contado = escrito !== '' && conteoValido(escrito) ? Number(escrito) : null
    const diferencia = contado == null || !Number.isFinite(sistema) ? 0 : contado - sistema
    const hayDiferencia = Math.abs(diferencia) > 0.000001
    const motivo = String(entrada.motivo || '').trim()
    return { wallet, sistema, escrito, contado, diferencia, hayDiferencia, motivo, lista: contado != null && contado >= 0 && (!hayDiferencia || motivo.length >= MIN_MOTIVO) }
  }
  const filas = wallets.map(fila)
  const listas = filas.filter(item => item.lista).length
  const todoListo = filas.length > 0 && listas === filas.length
  const cambiar = (id, campo, valor) => setConteo(actual => ({ ...actual, [id]: { ...actual[id], [campo]: valor } }))

  async function cerrar() {
    if (!claveRef.current) claveRef.current = crypto.randomUUID()
    setMensaje('')
    try {
      await onConfirmClose({
        accion: 'cerrar', mesInicio: mesRef.current, idempotencyKey: claveRef.current,
        payload: {
          cuentas: filas.map(item => ({
            cuentaCustodiaId: idDe(item.wallet), saldoReal: item.contado, motivo: item.hayDiferencia ? item.motivo : null,
            tasaUsdVes: String(rates.usd), tasaUsdtVes: String(rates.usdt),
          })),
          tasaUsdVes: String(rates.usd), tasaUsdtVes: String(rates.usdt),
        },
      })
      claveRef.current = null
      await onRefresh?.()
      setPaso(2)
    } catch (cause) {
      // Misma clave al reintentar: si el cierre sí llegó, el servidor lo reconoce y no lo duplica.
      setMensaje(cause?.message || 'No se confirmó el cierre. Revisa la conexión y vuelve a intentarlo.')
    }
  }

  async function descargarPdf() {
    setDescargando(true)
    setMensaje('')
    try {
      const cierre = await cargarCierre(mesRef.current)
      const movimientos = await cargarMovimientosCierre(mesRef.current)
      await generarFinanzasResumenPDF({
        movimientos, resumen: { tipoFiltro: '' }, rango: { desde: cierre.mes, hasta: cierre.hasta },
        tipoReporte: 'resumido', cierre, action: 'download',
      })
    } catch (cause) {
      setMensaje(cause?.message || 'No se pudo generar el PDF. Descárgalo desde "Historial de cierres".')
    } finally {
      setDescargando(false)
    }
  }

  const boton = 'flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold shadow-xs transition-colors disabled:opacity-50 sm:w-auto'
  const pie = paso === 2 ? (
    <div className="flex w-full flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
      <button type="button" onClick={onClose} className={`${boton} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>Terminar</button>
      {onAbrirSiguiente && mesSiguienteNombre && (
        <button type="button" onClick={onAbrirSiguiente} className={`${boton} bg-primary text-white hover:bg-primary-hover`}>Abrir {mesSiguienteNombre}</button>
      )}
    </div>
  ) : (
    <div className="flex w-full flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between">
      <button type="button" onClick={() => paso ? setPaso(0) : onClose()} disabled={pending}
        className={`${boton} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
        {paso ? 'Anterior' : 'Cancelar'}
      </button>
      {paso === 0 ? (
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <span className="text-center text-xs font-semibold text-slate-500">{listas} de {filas.length} cuenta(s) listas</span>
          <button type="button" onClick={() => setPaso(1)} disabled={!todoListo} className={`${boton} bg-primary text-white hover:bg-primary-hover`}>Siguiente</button>
        </div>
      ) : (
        <button type="button" onClick={cerrar} disabled={pending || !todoListo} className={`${boton} bg-amber-700 text-white hover:bg-amber-800`}>
          {pending ? <><RefreshCw size={15} className="animate-spin" />Cerrando…</> : <><LockKeyhole size={15} />Cerrar {mesNombre}</>}
        </button>
      )}
    </div>
  )

  return (
    <Modal isOpen busy={pending} onClose={() => !pending && onClose()} title={`Cierre de ${mesNombre}`} className="sm:max-w-2xl max-h-[92vh] sm:max-h-[88vh]" footer={pie}>
      <div className="space-y-4">
        <Pasos paso={paso} />
        {mensaje && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">{mensaje}</p>}

        {paso === 0 && (
          <>
            <p className="text-sm text-slate-600">Revisa cuánto dinero hay de verdad en cada cuenta (banco o caja) y escríbelo. Si es igual a lo que dice el sistema, pulsa <strong>Coincide</strong>.</p>
            {filas.map(item => {
              const id = idDe(item.wallet)
              return (
                <article key={id} className={`rounded-xl border p-3.5 ${item.lista ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-bold text-slate-900">{item.wallet.nombre}</span>
                    {item.lista && <CheckCircle2 size={16} className="shrink-0 text-emerald-600" aria-label="Lista" />}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    El sistema dice: <span className="font-mono font-bold text-slate-800">{money(item.sistema)} {item.wallet.moneda}</span>
                    {equivalente(item.sistema, item.wallet.moneda, rates) && <span className="ml-1.5 font-mono text-slate-500">({equivalente(item.sistema, item.wallet.moneda, rates)})</span>}
                  </p>
                  <div className="mt-2 flex items-end gap-2">
                    <label className="flex-1 text-xs font-bold text-slate-700">
                      Hay en la cuenta
                      <div className="relative mt-1">
                        <input
                          aria-label={`Saldo contado de ${item.wallet.nombre}`}
                          className="w-full rounded-lg border border-slate-300 p-2 pr-14 font-mono text-base font-semibold text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          inputMode="decimal" placeholder="Ej.: 1.500,00" value={conteo[id]?.saldoReal ?? ''} disabled={pending}
                          onChange={event => { const valor = normalizarMontoInput(event.target.value); if (valor !== null) cambiar(id, 'saldoReal', valor) }}
                        />
                        <span className="pointer-events-none absolute right-2.5 top-2.5 font-mono text-xs font-bold text-slate-500">{item.wallet.moneda}</span>
                      </div>
                    </label>
                    <button type="button" disabled={pending || !Number.isFinite(item.sistema)} onClick={() => cambiar(id, 'saldoReal', String(item.sistema))}
                      className="min-h-11 shrink-0 rounded-lg border border-emerald-300 bg-white px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
                      Coincide
                    </button>
                  </div>
                  {item.contado != null && equivalente(item.contado, item.wallet.moneda, rates) && (
                    <p className="mt-1 font-mono text-xs text-slate-500">{equivalente(item.contado, item.wallet.moneda, rates)}</p>
                  )}
                  {item.hayDiferencia && (
                    <label className="mt-2 block text-xs font-bold text-amber-900">
                      Diferencia: {signo(item.diferencia)} {item.wallet.moneda}. ¿Por qué?
                      <input
                        aria-label={`Motivo de la diferencia de ${item.wallet.nombre}`}
                        className="mt-1 w-full rounded-lg border border-amber-300 bg-amber-50/50 p-2 text-sm font-normal text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                        placeholder="Ej.: comisión del banco no registrada" maxLength={300} value={conteo[id]?.motivo || ''} disabled={pending}
                        onChange={event => cambiar(id, 'motivo', event.target.value)}
                      />
                      {item.motivo.length > 0 && item.motivo.length < MIN_MOTIVO && <span className="mt-1 block font-medium text-amber-700">Escribe al menos {MIN_MOTIVO} caracteres.</span>}
                    </label>
                  )}
                </article>
              )
            })}
          </>
        )}

        {paso === 1 && (
          <>
            <p className="text-sm text-slate-600">Así queda {mesNombre}. Revisa que todo esté bien antes de cerrar.</p>
            {filas.map(item => (
              <article key={idDe(item.wallet)} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-xs">
                <p className="truncate text-sm font-bold text-slate-900">{item.wallet.nombre}</p>
                <dl className="mt-2 grid grid-cols-3 gap-2">
                  <div><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Empezó con</dt><dd className="font-mono font-semibold text-slate-800">{money(item.wallet.saldoApertura)}</dd></div>
                  <div><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Movimientos</dt><dd className="font-mono font-semibold text-slate-800">{item.wallet.movimientosMes == null ? '—' : signo(Number(item.wallet.movimientosMes))}</dd></div>
                  <div><dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cierra con</dt><dd className="font-mono font-bold text-slate-900">{money(item.contado)} {item.wallet.moneda}
                    {equivalente(item.contado, item.wallet.moneda, rates) && <span className="block text-[11px] font-medium text-slate-500">{equivalente(item.contado, item.wallet.moneda, rates)}</span>}</dd></div>
                </dl>
                {item.hayDiferencia && <p className="mt-2 font-semibold text-amber-800">Diferencia {signo(item.diferencia)} {item.wallet.moneda}: {item.motivo}</p>}
              </article>
            ))}
            <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
              <span>Al cerrar, los movimientos de {mesNombre} ya no se podrán crear, editar ni anular. Si fue un error, el jefe puede reabrirlo desde el historial de cierres.</span>
            </p>
          </>
        )}

        {paso === 2 && (
          <div className="space-y-3 text-center">
            <CheckCircle2 size={40} className="mx-auto text-emerald-600" />
            <p className="text-lg font-black text-slate-900">{mesNombre} cerrado</p>
            <p className="text-sm text-slate-600">
              El cierre quedó guardado en el historial de cierres.
              {mesSiguienteNombre ? ` Ahora abre ${mesSiguienteNombre}: cada cuenta empezará con el saldo con que cerró ${mesNombre}.` : ''}
            </p>
            <button type="button" onClick={descargarPdf} disabled={descargando}
              className="mx-auto inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-60">
              <FileText size={15} className="text-primary" />{descargando ? 'Generando…' : 'Descargar PDF del cierre'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
