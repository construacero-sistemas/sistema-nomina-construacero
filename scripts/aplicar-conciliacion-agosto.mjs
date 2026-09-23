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
// Los DATOS OPERATIVOS REALES (UUID de cuentas/movimientos, importes, tasas y
// motivos) viven en scripts/conciliacion-agosto.datos.json, fuera del control
// de versiones (.gitignore): este script NO debe publicar datos del libro.
// Plantilla con la forma exacta en scripts/conciliacion-agosto.datos.example.json.
//
// Modos (reversible: crear es idempotente por llave y anular es idempotente):
//   node scripts/aplicar-conciliacion-agosto.mjs estado   # solo lectura
//   node scripts/aplicar-conciliacion-agosto.mjs piloto   # par 03:13 + invariantes
//   node scripts/aplicar-conciliacion-agosto.mjs resto    # 6 patas + 3 POS + invariantes
//
// Requiere APP_TOKEN (access token de la sesión del Jefe). BASE por defecto
// apunta al dev server local; el script aborta ante cualquier invariante roto.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE || 'http://localhost:5173'
const TOKEN = process.env.APP_TOKEN
const MODO = String(process.argv[2] || 'estado').toLowerCase()

if (!TOKEN) {
  console.error('Falta APP_TOKEN (access token de la sesión).')
  process.exit(1)
}

// Datos reales fuera del repo; aborta con instrucción si no existen.
const DATOS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'conciliacion-agosto.datos.json')
let DATOS
try {
  DATOS = JSON.parse(readFileSync(DATOS_PATH, 'utf8'))
} catch {
  console.error(`Falta ${DATOS_PATH}: copia scripts/conciliacion-agosto.datos.example.json y rellena los datos reales de la conciliación.`)
  process.exit(1)
}

const CUENTAS = DATOS.cuentas
const PATAS = DATOS.patas
const CORRECCION_USDT = DATOS.correccionUsdt
const POS = DATOS.pos
const MOTIVO_POS = DATOS.motivoPos

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
