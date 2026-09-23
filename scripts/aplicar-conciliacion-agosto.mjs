#!/usr/bin/env node
// scripts/aplicar-conciliacion-agosto.mjs
// Conciliación de agosto-2026, aprobada por el Jefe el 23/09/2026.
//
//  1) Anula las 3 Ventas POS del 29/08 (sistema POS no listo; dato de prueba).
//  2) Sustituye las 8 patas de traspaso del 30/08 por gemelas SELLADAS con
//     cuenta de custodia (el sello de tasa solo se otorga al insertar) y anula
//     las originales con motivo que referencia a su gemela.
//
// Toda escritura pasa por la API auditada (POST crear / POST anular).
// El alta normaliza dos campos —documentado y verificado—:
//   - cuenta_origen: null → nombre de la cuenta de custodia.
//   - categoria: el endpoint aplica title-case ("Entre Carteras"); sin efecto
//     funcional (es categoría interna, sin entrada en el registro) y al cerrar
//     las filas activas quedan uniformes.
//   - tasa_usd_ves en filas USD: := tasa_ves (la valoración USD usa el monto
//     directo, así que no altera importes).
//
// Modos (reversible: crear es idempotente por llave y anular es idempotente):
//   node scripts/aplicar-conciliacion-agosto.mjs estado   # solo lectura
//   node scripts/aplicar-conciliacion-agosto.mjs piloto   # par 03:13 + invariantes
//   node scripts/aplicar-conciliacion-agosto.mjs resto    # 6 patas + 3 POS + invariantes
//
// Requiere APP_TOKEN (access token de la sesión del Jefe). BASE por defecto
// apunta al dev server local; el script aborta ante cualquier invariante roto.

const BASE = process.env.BASE || 'http://localhost:5173'
const TOKEN = process.env.APP_TOKEN
const MODO = String(process.argv[2] || 'estado').toLowerCase()

if (!TOKEN) {
  console.error('Falta APP_TOKEN (access token de la sesión).')
  process.exit(1)
}

const CUENTAS = {
  cajabs: 'ed9d73d6-1f79-4735-a3a3-63880d6fc7fe', // Caja Efectivo Bs → Efectivo VES
  usdt: 'e6670b05-7004-4763-870d-db8d993df4f3', // Gaby3737 → USDT
  cash: '8b421d47-a14d-4ec4-81ef-70928ecf25e3', // Caja Efectivo $ → Efectivo USD
}

// Las 8 patas con sus valores exactos (auditoría Q8, libro real).
// Referencia = cartera propia de la pata; observaciones = dirección del par.
const PATAS = [
  { id: '69511780-85fb-4ff3-849b-f781f23bf6f8', cuenta: 'cajabs', fila: { fecha: '2026-08-30', tipo: 'egreso', categoria: 'Transferencia entre carteras', concepto: 'Traspaso a USDT ($)', monto: 350000, moneda: 'VES', tasaVes: 1, tasaUsdVes: 804.81, fuenteTasa: 'BCV', referencia: 'Efectivo Bs', observaciones: 'Traspaso interno entre carteras (Efectivo Bs → USDT)' } },
  { id: 'e2530431-7a8e-4459-94d4-fae9b0c4f291', cuenta: 'usdt', fila: { fecha: '2026-08-30', tipo: 'ingreso', categoria: 'Transferencia entre carteras', concepto: 'Traspaso recibido desde Efectivo Bs (Bs.)', monto: 373.72, moneda: 'USDT', tasaVes: 936.54, tasaUsdVes: 1, fuenteTasa: 'USDT', referencia: 'USDT', observaciones: 'Traspaso interno entre carteras (Efectivo Bs → USDT)' } },
  { id: 'b25ba5e0-6de5-4ede-9bc7-18441ed5ead9', cuenta: 'cajabs', fila: { fecha: '2026-08-30', tipo: 'egreso', categoria: 'Transferencia entre carteras', concepto: 'Traspaso a USDT ($)', monto: 300000, moneda: 'VES', tasaVes: 1, tasaUsdVes: 804.81, fuenteTasa: 'BCV', referencia: 'Efectivo Bs', observaciones: 'Traspaso interno entre carteras (Efectivo Bs → USDT)' } },
  { id: 'ea62050a-fdf6-4c8e-b68e-a706897db5aa', cuenta: 'usdt', fila: { fecha: '2026-08-30', tipo: 'ingreso', categoria: 'Transferencia entre carteras', concepto: 'Traspaso recibido desde Efectivo Bs (Bs.)', monto: 315.79, moneda: 'USDT', tasaVes: 950, tasaUsdVes: 1, fuenteTasa: 'USDT', referencia: 'USDT', observaciones: 'Traspaso interno entre carteras (Efectivo Bs → USDT)' } },
  { id: 'd71cbbe0-1868-45c0-8514-4003add85f65', cuenta: 'usdt', fila: { fecha: '2026-08-30', tipo: 'egreso', categoria: 'Transferencia entre carteras', concepto: 'Traspaso a Efectivo Bs (Bs.)', monto: 600, moneda: 'USDT', tasaVes: 935.125, tasaUsdVes: 1, fuenteTasa: 'USDT', referencia: 'USDT', observaciones: 'Traspaso interno entre carteras (USDT → Efectivo Bs)' } },
  { id: '19a4868c-0730-4a20-9183-4c69b676bfd2', cuenta: 'cajabs', fila: { fecha: '2026-08-30', tipo: 'ingreso', categoria: 'Transferencia entre carteras', concepto: 'Traspaso recibido desde USDT ($)', monto: 561075, moneda: 'VES', tasaVes: 1, tasaUsdVes: 804.81, fuenteTasa: 'BCV', referencia: 'Efectivo Bs', observaciones: 'Traspaso interno entre carteras (USDT → Efectivo Bs)' } },
  { id: '7cb78326-d247-40a9-a972-03cdb3ef1d98', cuenta: 'cash', fila: { fecha: '2026-08-30', tipo: 'egreso', categoria: 'Transferencia entre carteras', concepto: 'Traspaso a Efectivo Bs (Bs.)', monto: 250, moneda: 'USD', tasaVes: 900, tasaUsdVes: 1, fuenteTasa: 'BCV', referencia: 'Efectivo $', observaciones: 'Traspaso interno entre carteras (Efectivo $ → Efectivo Bs)' } },
  { id: 'bf5a3425-fec9-4d6a-927d-7dc173fef054', cuenta: 'cajabs', fila: { fecha: '2026-08-30', tipo: 'ingreso', categoria: 'Transferencia entre carteras', concepto: 'Traspaso recibido desde Efectivo $ ($)', monto: 225000, moneda: 'VES', tasaVes: 1, tasaUsdVes: 804.81, fuenteTasa: 'BCV', referencia: 'Efectivo Bs', observaciones: 'Traspaso interno entre carteras (Efectivo $ → Efectivo Bs)' } },
]

// Corrección de paridad USDT (23/09/2026, tras verificación): las gemelas USDT
// heredaron tasa_usd_ves=1 de las originales (convención errónea de traspasos)
// y la fórmula de valoración (monto_ves/tasa_usd_ves) las inflaba en USD. La
// convención del sistema (POS + fase de tasas) es tasa_usd_ves = tasa_ves para
// USDT (paridad 1 USDT = 1 USD). Se sustituyen por gemelas v2 con esa paridad.
const CORRECCION_USDT = [
  { id: '1b9903fa-5986-4264-958e-6d07d1d7b514', cuenta: 'usdt', fila: { fecha: '2026-08-30', tipo: 'ingreso', categoria: 'Transferencia entre carteras', concepto: 'Traspaso recibido desde Efectivo Bs (Bs.)', monto: 373.72, moneda: 'USDT', tasaVes: 936.54, tasaUsdVes: 936.54, fuenteTasa: 'USDT', referencia: 'USDT', observaciones: 'Traspaso interno entre carteras (Efectivo Bs → USDT)' } },
  { id: '172f9cb6-a21a-42bb-9932-1dd7a7a8a045', cuenta: 'usdt', fila: { fecha: '2026-08-30', tipo: 'ingreso', categoria: 'Transferencia entre carteras', concepto: 'Traspaso recibido desde Efectivo Bs (Bs.)', monto: 315.79, moneda: 'USDT', tasaVes: 950, tasaUsdVes: 950, fuenteTasa: 'USDT', referencia: 'USDT', observaciones: 'Traspaso interno entre carteras (Efectivo Bs → USDT)' } },
  { id: '4b5b328a-a79c-441c-b652-fb05b21c9eec', cuenta: 'usdt', fila: { fecha: '2026-08-30', tipo: 'egreso', categoria: 'Transferencia entre carteras', concepto: 'Traspaso a Efectivo Bs (Bs.)', monto: 600, moneda: 'USDT', tasaVes: 935.125, tasaUsdVes: 935.125, fuenteTasa: 'USDT', referencia: 'USDT', observaciones: 'Traspaso interno entre carteras (USDT → Efectivo Bs)' } },
]

// Las 3 Ventas POS del 29/08: se anulan (sistema POS no listo).
const POS = [
  { id: 'ba81a653-3259-4699-a413-edcda3ec14f4', concepto: 'Ventas POS en Efectivo $ - 2026-08-29' },
  { id: '37ad220f-f01b-462b-9506-6269512d096a', concepto: 'Ventas POS en Pago Móvil - 2026-08-29' },
  { id: '55c02737-9db6-4d5c-a19e-69fc814d398c', concepto: 'Ventas POS en Punto de Venta - 2026-08-29' },
]

const MOTIVO_POS = 'Sistema POS no listo: dato de prueba del POS; anulado por decisión del Jefe (auditoría ago-2026).'

let fallos = 0
function ok(msg) { console.log('  ✓ ' + msg) }
function fallo(msg) { fallos += 1; console.log('  ✗ ' + msg) }

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { crudo: text } }
  return { status: res.status, data }
}

async function leerAgosto() {
  const { status, data } = await api('/api/finanzas/movimientos?desde=2026-08-01&hasta=2026-08-31&limit=100&mostrarAnulados=true')
  if (status !== 200) throw new Error(`Lectura de agosto falló: ${status} ${JSON.stringify(data).slice(0, 200)}`)
  return data.movimientos || []
}

function porId(filas) {
  return new Map(filas.map(fila => [fila.id, fila]))
}

async function sustituir(pata) {
  const gemelaBody = {
    ...pata.fila,
    observaciones: `${pata.fila.observaciones} · Sustitución sellada de ${pata.id} (conciliación ago-2026)`,
    cuentaCustodiaId: CUENTAS[pata.cuenta],
    idempotencyKey: `sust-agosto-${pata.id.slice(0, 8)}-20260923`,
  }
  const creada = await api('/api/finanzas/movimientos/crear', { method: 'POST', body: gemelaBody })
  if (creada.status !== 201 && creada.status !== 200) {
    fallo(`crear gemela de ${pata.id.slice(0, 8)}: ${creada.status} ${JSON.stringify(creada.data).slice(0, 160)}`)
    return null
  }
  const mov = creada.data.movimiento || {}
  if (!mov.tasa_registrada_en) fallo(`gemela ${String(mov.id).slice(0, 8)} sin sello de tasa`)
  else ok(`gemela ${String(mov.id).slice(0, 8)} creada y sellada → cuenta ${pata.cuenta}`)

  const motivo = `Sustitución sellada por conciliación (ago-2026). Gemela: ${mov.id}`
  const anulada = await api('/api/finanzas/movimientos/anular', {
    method: 'POST',
    body: { id: pata.id, motivo, idempotencyKey: `anulasust-agosto-${pata.id.slice(0, 8)}-20260923` },
  })
  if (anulada.status !== 200) {
    fallo(`anular original ${pata.id.slice(0, 8)}: ${anulada.status} ${JSON.stringify(anulada.data).slice(0, 160)}`)
    return null
  }
  ok(`original ${pata.id.slice(0, 8)} anulada con motivo (revertible)`)
  return mov.id
}

async function anularPos(venta) {
  const res = await api('/api/finanzas/movimientos/anular', {
    method: 'POST',
    body: { id: venta.id, motivo: MOTIVO_POS, idempotencyKey: `anula-pos-${venta.id.slice(0, 8)}-20260923` },
  })
  if (res.status !== 200) fallo(`anular POS ${venta.id.slice(0, 8)}: ${res.status} ${JSON.stringify(res.data).slice(0, 160)}`)
  else ok(`POS ${venta.id.slice(0, 8)} (${venta.concepto}) anulada`)
}

// Invariantes por sustitución: la gemela es idéntica salvo las dos
// normalizaciones documentadas, queda asignada y sellada; la original queda
// anulada con el motivo que la enlaza.
function verificarPares(filas, pares) {
  const idx = porId(filas)
  for (const { pata, gemelaId } of pares) {
    const original = idx.get(pata.id)
    const gemela = idx.get(gemelaId)
    if (!original || !gemela) { fallo(`faltan filas para ${pata.id.slice(0, 8)}`); continue }
    if (original.estado !== 'anulado') fallo(`original ${pata.id.slice(0, 8)} no quedó anulada`)
    else if (!String(original.motivo_anulacion || '').includes(gemelaId)) fallo(`motivo de ${pata.id.slice(0, 8)} no referencia a su gemela`)
    else ok(`original ${pata.id.slice(0, 8)} anulada y enlazada`)

    const iguales = ['fecha', 'tipo', 'concepto', 'moneda', 'referencia']
      .every(campo => String(gemela[campo] ?? '').trim() === String(pata.fila[campo] ?? '').trim())
      && String(gemela.categoria ?? '').trim().toLowerCase() === String(pata.fila.categoria ?? '').trim().toLowerCase()
      && Number(gemela.monto) === Number(pata.fila.monto)
    if (!iguales) fallo(`gemela ${String(gemelaId).slice(0, 8)} difiere de la original en importe/fecha/concepto`)
    else ok(`gemela ${String(gemelaId).slice(0, 8)} idéntica en importe, fecha, moneda y concepto (categoría normalizada)`)

    if (gemela.cuenta_custodia_id !== CUENTAS[pata.cuenta]) fallo(`gemela ${String(gemelaId).slice(0, 8)} en cuenta inesperada`)
    else ok(`gemela ${String(gemelaId).slice(0, 8)} en cuenta ${pata.cuenta}`)
    if (!gemela.tasa_registrada_en) fallo(`gemela ${String(gemelaId).slice(0, 8)} sin sello`)
  }
}

async function estadoSaldos() {
  const { status, data } = await api('/api/finanzas/saldos')
  if (status !== 200) { fallo(`saldos: ${status}`); return }
  const cuentas = data.cuentas || data.saldos || []
  console.log(`  conciliacionPendiente=${data.conciliacionPendiente ?? '(sin dato)'}`)
  for (const cuenta of (Array.isArray(cuentas) ? cuentas : [])) {
    console.log(`  - ${cuenta.nombre || cuenta.cuenta}: valoracionCompleta=${cuenta.valoracionCompleta} conciliacion=${cuenta.conciliacion ?? ''}`)
  }
}

async function main() {
  console.log(`\n== Conciliación agosto-2026 · modo: ${MODO} ==`)
  const antes = porId(await leerAgosto())

  if (MODO === 'estado') {
    for (const pata of PATAS) {
      const fila = antes.get(pata.id)
      console.log(`  pata ${pata.id.slice(0, 8)} estado=${fila?.estado} cuenta=${fila?.cuenta_custodia_id || 'SIN_CUENTA'} → ${pata.cuenta}`)
    }
    for (const venta of POS) {
      const fila = antes.get(venta.id)
      console.log(`  POS  ${venta.id.slice(0, 8)} estado=${fila?.estado} (${venta.concepto})`)
    }
    await estadoSaldos()
    return
  }

  const lote = MODO === 'piloto' ? PATAS.slice(0, 2) : MODO === 'correccion' ? CORRECCION_USDT : PATAS.slice(2)
  const pares = []
  for (const pata of lote) {
    const previa = antes.get(pata.id)
    if (previa?.estado === 'anulado') {
      ok(`pata ${pata.id.slice(0, 8)} ya estaba anulada (re-ejecución)`)
      continue
    }
    if (MODO !== 'correccion' && previa?.cuenta_custodia_id) {
      fallo(`pata ${pata.id.slice(0, 8)} ya tiene cuenta: aborta revisión manual`)
      continue
    }
    if (MODO === 'correccion' && previa && !previa.cuenta_custodia_id) {
      fallo(`gemela v1 ${pata.id.slice(0, 8)} sin cuenta: aborta revisión manual`)
      continue
    }
    const gemelaId = await sustituir(pata)
    if (gemelaId) pares.push({ pata, gemelaId })
  }

  if (MODO === 'resto') {
    for (const venta of POS) {
      if (antes.get(venta.id)?.estado === 'anulado') { ok(`POS ${venta.id.slice(0, 8)} ya anulada`); continue }
      await anularPos(venta)
    }
  }

  console.log('\n-- Verificación de invariantes --')
  const despues = await leerAgosto()
  verificarPares(despues, pares)

  if (MODO === 'resto') {
    const idx = porId(despues)
    for (const venta of POS) {
      const fila = idx.get(venta.id)
      if (fila?.estado === 'anulado') ok(`POS ${venta.id.slice(0, 8)} confirmada anulada`)
      else fallo(`POS ${venta.id.slice(0, 8)} sigue activa`)
    }
  }

  console.log('\n-- Saldos del libro --')
  await estadoSaldos()

  console.log(fallos === 0 ? '\nRESULTADO: todos los invariantes cumplidos.' : `\nRESULTADO: ${fallos} invariante(s) roto(s).`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(error => {
  console.error('Error:', error.message)
  process.exit(1)
})
