// scripts/test-responsiveness-deterministic.mjs
// Suite de Pruebas Deterministas de Responsividad y Mobile-First para Construacero C.A.
// Ejecutable directamente mediante: node scripts/test-responsiveness-deterministic.mjs

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

let totalTests = 0
let passedTests = 0
let failedTests = 0
const failures = []

function test(name, fn) {
  totalTests++
  try {
    fn()
    passedTests++
    console.log(`  ✔ [PASS] ${name}`)
  } catch (err) {
    failedTests++
    failures.push({ name, error: err.message })
    console.log(`  ✖ [FAIL] ${name}`)
    console.log(`     └─ Error: ${err.message}`)
  }
}

async function read(path) {
  return readFile(join(root, path), 'utf8')
}

async function walk(directory, output = []) {
  const absolute = join(root, directory)
  let entries
  try {
    entries = await readdir(absolute, { withFileTypes: true })
  } catch {
    return output
  }

  for (const entry of entries) {
    const relativePath = join(directory, entry.name)
    if (['node_modules', 'dist', 'coverage', '.git', '.wrangler'].includes(entry.name)) continue
    if (entry.isDirectory()) await walk(relativePath, output)
    else output.push(relativePath.replace(/\\/g, '/'))
  }
  return output
}

async function run() {
  console.log('\n=================================================================')
  console.log('   SUITE DETERMINISTA DE RESPONSIVIDAD Y MOBILE (IPHONE/WEB)     ')
  console.log('=================================================================\n')

  const allFiles = await walk('src')
  const compatFiles = await walk('compat')
  const jsxFiles = [...allFiles, ...compatFiles].filter(f => f.endsWith('.jsx'))

  // ─── 1. REGLA: CERO SCROLL HORIZONTAL EN PESTAÑAS Y CONTENEDORES ────────────
  console.log('━━━ 1. CERO SCROLL HORIZONTAL INVOLUNTARIO (FLEX-WRAP EN PESTAÑAS) ━━━')

  const nominaView = await read('src/views/NominaView.jsx')
  const sistemaView = await read('src/views/SistemaView.jsx')
  const holidayManager = await read('src/components/nomina/HolidayManager.jsx')
  const nominaApp = await read('src/NominaApp.jsx')
  const modal = await read('compat/components/ui/Modal.jsx')

  test('NominaView: Pestañas principales usan flex-wrap y no fuerzan scroll horizontal', () => {
    if (nominaView.includes('overflow-x-auto') && !nominaView.includes('flex-wrap')) {
      throw new Error('NominaView tiene pestañas con overflow-x-auto sin flex-wrap')
    }
    if (!nominaView.includes('flex-wrap')) {
      throw new Error('NominaView debe usar flex-wrap en sus pestañas principales')
    }
  })

  const tabConfiguracion = await read('src/components/nomina/TabConfiguracion.jsx')

  test('TabConfiguracion (Sistema): Pestañas de configuración usan flex-wrap', () => {
    if (!tabConfiguracion.includes('flex-wrap')) {
      throw new Error('TabConfiguracion debe usar flex-wrap en su barra de pestañas')
    }
  })

  test('HolidayManager: Botones de filtro de feriados usan flex-wrap', () => {
    if (!holidayManager.includes('flex-wrap')) {
      throw new Error('HolidayManager debe usar flex-wrap en los filtros de feriados')
    }
  })

  test('Main Shell: Contenedor principal tiene overflow-x-hidden para prevenir scroll lateral', () => {
    if (!nominaApp.includes('overflow-x-hidden')) {
      throw new Error('NominaApp main debe declarar overflow-x-hidden')
    }
  })

  // ─── 2. REGLA: SAFE-AREAS DE IOS (NOTCH, DYNAMIC ISLAND, HOME BAR) ──────────
  console.log('\n━━━ 2. PROTECCIÓN DE SAFE-AREAS DE IOS (IPHONE / SAFARI) ━━━')

  test('NominaApp: Barra de navegación inferior móvil respeta env(safe-area-inset-bottom)', () => {
    if (!nominaApp.includes('env(safe-area-inset-bottom)')) {
      throw new Error('NominaApp debe incluir env(safe-area-inset-bottom) en navegación táctil y drawer')
    }
  })

  test('NominaApp: Contenedor principal protege con padding inferior amplio para que el nav móvil nunca obstaculice botones o contenido', () => {
    if (!nominaApp.includes('pb-36') && !nominaApp.includes('pb-32') && !nominaApp.includes('pb-28') && !nominaApp.includes('paddingBottom')) {
      throw new Error('NominaApp main debe declarar padding inferior amplio (pb-36 o paddingBottom con safe-area) para no tapar contenido')
    }
  })

  test('NominaApp: Drawer lateral móvil respeta safe-area en el footer', () => {
    if (!nominaApp.includes('env(safe-area-inset-bottom)')) {
      throw new Error('El drawer móvil debe proteger su botón de logout con safe-area')
    }
  })

  test('Modal Base: Modales respetan safe-area-inset-bottom para no tapar acciones en iPhone', () => {
    if (!modal.includes('env(safe-area-inset-bottom)')) {
      throw new Error('Modal.jsx debe incluir pb-[env(safe-area-inset-bottom)]')
    }
  })

  // ─── 3. REGLA: UNIDADES DINÁMICAS DE VIEWPORT (100DVH) ──────────────────────
  console.log('\n━━━ 3. VIEWPORT DINÁMICO (100DVH CONTRA SALTO DE BARRA SAFARI) ━━━')

  test('NominaApp: Layout raíz utiliza h-[100dvh] para evitar desbordes por barra de navegación Safari', () => {
    if (!nominaApp.includes('100dvh')) {
      throw new Error('NominaApp raíz debe declarar h-[100dvh]')
    }
  })

  test('Modal Base: Modal calcula altura máxima con max-h-[calc(100dvh-2rem)] o 100dvh', () => {
    if (!modal.includes('100dvh')) {
      throw new Error('Modal.jsx debe usar 100dvh en su restricción de alto máximo')
    }
  })

  // ─── 4. REGLA: ERGONOMÍA TÁCTIL Y TOUCH TARGETS (≥ 44PX) ────────────────────
  console.log('\n━━━ 4. ERGONOMÍA Y ÁREAS TÁCTILES MÍNIMAS (TOUCH TARGETS ≥ 44PX) ━━━')

  test('NominaApp: Barra inferior móvil tiene altura mínima ≥ 4rem (64px) para pulsar con el pulgar', () => {
    if (!nominaApp.includes('min-h-[4rem]') && !nominaApp.includes('h-16')) {
      throw new Error('La barra inferior táctil debe tener min-h-[4rem] (64px)')
    }
  })

  test('NominaApp: Botones táctiles tienen touchAction: manipulation para prevenir retardo de 300ms en iOS', () => {
    if (!nominaApp.includes('touchAction: \'manipulation\'')) {
      throw new Error('NominaApp debe incluir touchAction: manipulation en enlaces y botones táctiles')
    }
  })

  test('HolidayManager: Botones de navegación de mes tienen tamaño accesible', () => {
    if (!holidayManager.includes('p-2 rounded-xl')) {
      throw new Error('Los botones de mes deben tener p-2 para fácil pulsación')
    }
  })

  // ─── 5. REGLA: CALENDARIO LABORAL RESPONSIVO Y CELDAS PROPORCIONALES ────────
  console.log('\n━━━ 5. CALENDARIO LABORAL RESPONSIVO (PROPORCIÓN Y TEXTO MÓVIL) ━━━')

  test('HolidayManager: Celdas de días son aspect-square en móvil y expandidas en desktop', () => {
    if (!holidayManager.includes('aspect-square sm:aspect-auto')) {
      throw new Error('HolidayManager debe usar aspect-square sm:aspect-auto para evitar celdas alargadas en móvil')
    }
  })

  test('HolidayManager: Oculta nombres largos de feriados en cuadrícula móvil para evitar cortes de texto (Domi)', () => {
    if (!holidayManager.includes('hidden sm:block')) {
      throw new Error('HolidayManager debe ocultar el texto descriptivo en cuadrícula móvil (hidden sm:block)')
    }
  })

  test('HolidayManager: Muestra indicador de punto (dot) visible en móvil', () => {
    if (!holidayManager.includes('flex sm:hidden justify-center items-center')) {
      throw new Error('HolidayManager debe incluir un indicador de punto en móvil')
    }
  })

  // ─── 6. REGLA: CONTENCIÓN Y ENCAPSULACIÓN DE TABLAS FINANCIERAS ─────────────
  console.log('\n━━━ 6. ENCAPSULACIÓN SEGURA DE TABLAS Y TARJETAS DE DATOS ━━━')

  const tabEmpleados = await read('src/components/nomina/TabEmpleados.jsx')
  const tabPeriodos = await read('src/components/nomina/TabPeriodos.jsx')
  const tabAsistencia = await read('src/components/nomina/TabAsistencia.jsx')
  const periodoDetalle = await read('src/components/nomina/PeriodoDetalleModal.jsx')
  const movimientoTable = await read('src/components/finanzas/MovimientoTable.jsx')

  test('TabEmpleados: Tarjetas de empleados se adaptan responsivamente en cuadrícula (grid-cols-1 sm:grid-cols-2)', () => {
    if (!tabEmpleados.includes('grid-cols-1') || !tabEmpleados.includes('sm:grid-cols-2')) {
      throw new Error('TabEmpleados debe usar cuadrícula responsiva (grid-cols-1 sm:grid-cols-2)')
    }
  })

  test('TabPeriodos: Tarjetas de períodos se adaptan responsivamente en cuadrícula (grid-cols-1 sm:grid-cols-3)', () => {
    if (!tabPeriodos.includes('grid-cols-1') || !tabPeriodos.includes('sm:grid-cols-3')) {
      throw new Error('TabPeriodos debe usar cuadrícula responsiva (grid-cols-1 sm:grid-cols-3)')
    }
  })

  const hasHScroll = src => src.includes('overflow-x-auto') || src.includes('HorizontalScroll')

  test('TabAsistencia: Matriz de asistencia envuelta en contenedor scrollable horizontal exclusivo', () => {
    if (!hasHScroll(tabAsistencia)) {
      throw new Error('TabAsistencia debe encapsular su matriz en overflow-x-auto (o HorizontalScroll)')
    }
  })

  test('PeriodoDetalleModal: Tabla financiera de recibos envuelta en contenedor scrollable horizontal exclusivo', () => {
    if (!hasHScroll(periodoDetalle)) {
      throw new Error('PeriodoDetalleModal debe encapsular su tabla en overflow-x-auto (o HorizontalScroll)')
    }
  })

  test('MovimientoTable (Finanzas): Tabla de movimientos financieros protegida con scroll horizontal', () => {
    if (!hasHScroll(movimientoTable)) {
      throw new Error('MovimientoTable debe encapsular su tabla en overflow-x-auto (o HorizontalScroll)')
    }
  })

  // ─── 7. REGLA: MODALES RESPONSIVOS Y CONTENCIÓN DE VIEWPORT ─────────────────
  console.log('\n━━━ 7. MODALES Y DIÁLOGOS RESPONSIVOS CON CONTENCIÓN DE PANTALLA ━━━')

  test('Modal Base: Restringe ancho máximo al 100vw menos margen seguro (max-w-[calc(100vw-1.5rem)])', () => {
    if (!modal.includes('max-w-[calc(100vw-1.5rem)]')) {
      throw new Error('Modal.jsx debe restringir ancho con max-w-[calc(100vw-1.5rem)]')
    }
  })

  test('Modal Base: Permite scroll vertical interno independiente sin romper la pantalla (overflow-y-auto)', () => {
    if (!modal.includes('overflow-y-auto')) {
      throw new Error('Modal.jsx body debe tener overflow-y-auto')
    }
  })

  test('Modal Base: En móvil se despliega como bottom sheet (items-end + rounded-t-3xl)', () => {
    if (!modal.includes('items-end')) {
      throw new Error('Modal.jsx debe alinearse abajo en móvil (items-end) para actuar como hoja inferior')
    }
    if (!modal.includes('rounded-t-3xl')) {
      throw new Error('Modal.jsx debe usar rounded-t-3xl en móvil (esquinas superiores redondeadas de bottom sheet)')
    }
  })

  test('Modal Base: Bottom sheet móvil tiene tirador (grabber) y gesto de arrastre para cerrar', () => {
    if (!modal.includes('cursor-grab')) {
      throw new Error('Modal.jsx debe incluir un tirador (grabber con cursor-grab) en el bottom sheet móvil')
    }
    if (!modal.includes('onTouchStart') || !modal.includes('translateY')) {
      throw new Error('Modal.jsx debe tener gesto de arrastre (onTouchStart + translateY) para cerrar')
    }
  })

  // ─── 8. REGLA: SCANNER AUTOMÁTICO EN TODOS LOS ARCHIVOS JSX (39 COMPONENTES) ─
  console.log('\n━━━ 8. SCANNER DETERMINISTA DE INTEGRIDAD RESPONSIVA (39 COMPONENTES) ━━━')

  let forbiddenFixedPixelWidths = 0
  let componentsChecked = 0

  for (const file of jsxFiles) {
    const content = await read(file)
    componentsChecked++

    // Buscar anchos fijos peligrosos sin breakpoints (ej. w-[800px], w-[1200px] fuera de contenedores decorativos pointer-events-none)
    const matches = content.match(/\bw-\[(\d+)px\]/g) || []
    for (const m of matches) {
      const px = parseInt(m.replace(/\D/g, ''), 10)
      if (px > 450 && !content.includes('pointer-events-none') && !content.includes('max-w-full') && !content.includes('overflow-x-auto') && !content.includes('HorizontalScroll')) {
        forbiddenFixedPixelWidths++
        console.warn(`     ⚠️  Alerta en ${file}: ${m} sin contención explícita`)
      }
    }
  }

  test(`Scanner de ${componentsChecked} componentes JSX: 0 desbordes de ancho fijo rígido (>450px sin contención)`, () => {
    if (forbiddenFixedPixelWidths > 0) {
      throw new Error(`Se encontraron ${forbiddenFixedPixelWidths} anchos fijos no responsivos`)
    }
  })

  // ─── 9. REGLA: SIN DIÁLOGOS NATIVOS NI GLIFOS UNICODE EN LA UI ──────────────
  console.log('\n━━━ 9. SIN DIÁLOGOS NATIVOS NI GLIFOS UNICODE GRÁFICOS ━━━')

  let nativeDialogHits = []
  let glyphHits = []
  const GLYPH_BLACKLIST = ['⚠️', '✨', '🏢', '📍', '🏦', '📱', '💵', '🌐', '📋', '💳', '🎭', '👷', '⚔️']

  for (const file of jsxFiles) {
    const content = await read(file)
    // Strip line comments to avoid false positives from commented-out code
    const code = content.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
    if (/(?<![.\w])(confirm|alert|prompt)\s*\(/.test(code)) nativeDialogHits.push(file)
    for (const glyph of GLYPH_BLACKLIST) {
      if (code.includes(glyph)) { glyphHits.push(`${file}: ${glyph}`); break }
    }
  }

  test(`Scanner de ${componentsChecked} componentes JSX: 0 diálogos nativos (confirm/alert/prompt)`, () => {
    if (nativeDialogHits.length > 0) {
      throw new Error(`Diálogos nativos en: ${nativeDialogHits.join(', ')}`)
    }
  })

  test(`Scanner de ${componentsChecked} componentes JSX: 0 glifos Unicode gráficos (usar lucide-react)`, () => {
    if (glyphHits.length > 0) {
      throw new Error(`Glifos prohibidos en: ${glyphHits.join(', ')}`)
    }
  })

  // ─── 10. REGLA: TOUCH TARGETS ≥ 44PX EN CONTROLES INTERACTIVOS ─────────────
  console.log('\n━━━ 10. TOUCH TARGETS ≥ 44PX EN BOTONES E INPUTS ━━━')

  let undersizedControls = []
  for (const file of jsxFiles) {
    const content = await read(file)
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Detect a button/input opening tag on this line, then look at this line + next for h-9/h-10
      const isOpeningTag = /<(button|input)\b/.test(line)
      if (!isOpeningTag) continue
      const context = line + (lines[i + 1] || '')
      if (/\bh-(9|10)\b/.test(context)) {
        undersizedControls.push(`${file}:${i + 1}`)
      }
    }
  }

  test(`Scanner de ${componentsChecked} componentes JSX: 0 botones/inputs con altura < 44px (h-9/h-10)`, () => {
    if (undersizedControls.length > 0) {
      throw new Error(`Controles por debajo de 44px en: ${undersizedControls.slice(0, 10).join(', ')}${undersizedControls.length > 10 ? ` (+${undersizedControls.length - 10} más)` : ''}`)
    }
  })

  // ─── 11. REGLA: CELDAS FLEX/GRID CON IMPORTES EN BS SIN CONTENCIÓN ────────
  console.log('\n━━━ 11. CELDAS FLEX/GRID CON IMPORTES EN BS SIN MIN-W-0 (DESBORDE DE MONTO) ━━━')

  const MONEY_FORMATTER = /\b(?:formatMoney|formatNumber|formatBs|formatUsd|fmtBs|fmt)\s*\(/
  let moneyGridHits = []

  // Detecta grids multi-columna en móvil (grid-cols-2/3/4 sin fallback a grid-cols-1)
  // que renderizan importes con un formateador de dinero y no contienen ninguna
  // contención (min-w-0 / truncate / break-words). Sin contención, un monto largo
  // en Bs. puede forzar desborde horizontal en pantallas estrechas.
  for (const file of jsxFiles) {
    const content = await read(file)
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!/className="[^"]*\bgrid\b[^"]*\bgrid-cols-[2-4]\b/.test(line)) continue
      if (/\bgrid-cols-1\b/.test(line)) continue
      const window = lines.slice(i, i + 12).join('\n')
      if (!MONEY_FORMATTER.test(window)) continue
      if (/\bmin-w-0\b|\btruncate\b|\bbreak-words\b/.test(window)) continue
      moneyGridHits.push(`${file}:${i + 1}`)
    }
  }

  test(`Scanner de ${componentsChecked} componentes JSX: 0 grids multi-columna con importes en Bs sin contención (min-w-0/truncate/break-words)`, () => {
    if (moneyGridHits.length > 0) {
      throw new Error(`Grillas multi-columna de importes sin contención en: ${moneyGridHits.join(', ')}`)
    }
  })

  // ─── 12. REGLA: GUARDARRAÍLES Y ERGONOMÍA EN ZONA DE SINCRONIZACIÓN POS ───────
  console.log('\n━━━ 12. GUARDARRAÍLES EN ZONA DE SINCRONIZACIÓN POS (FINANZAS) ━━━')

  const posModalContent = await read('src/components/finanzas/SyncPosModal.jsx')
  const posItemContent = await read('src/components/finanzas/SyncPosMetodoItem.jsx')
  const posDespachosContent = await read('src/components/finanzas/SyncPosDespachosList.jsx')

  test('SyncPos: Todos los botones interactivos declaran touchAction manipulation y touch targets >= 44px (min-h-11)', () => {
    const files = [
      { name: 'SyncPosModal', content: posModalContent },
      { name: 'SyncPosMetodoItem', content: posItemContent },
      { name: 'SyncPosDespachosList', content: posDespachosContent },
    ]
    for (const { name, content } of files) {
      if (!content.includes('min-h-11')) {
        throw new Error(`${name} debe usar min-h-11 para cumplir touch targets >= 44px`)
      }
      if (!content.includes('manipulation')) {
        throw new Error(`${name} debe usar touchAction: manipulation en sus botones interactivos`)
      }
    }
  })

  test('SyncPosMetodoItem: Inputs numéricos usan text-[16px] sm:text-sm para prevenir auto-zoom en iOS Safari', () => {
    if (!posItemContent.includes('text-[16px] sm:text-sm')) {
      throw new Error('SyncPosMetodoItem debe usar text-[16px] sm:text-sm en inputs para prevenir auto-zoom en iOS Safari')
    }
    if (!posItemContent.includes('onKeyDown')) {
      throw new Error('SyncPosMetodoItem debe sanitizar caracteres no numéricos o negativos en onKeyDown')
    }
  })

  test('SyncPosDespachosList: Paginación estricta <= 10 filas por página (FILAS_POR_PAGINA = 6) y controles accesibles', () => {
    if (!posDespachosContent.includes('FILAS_POR_PAGINA = 6') && !posDespachosContent.includes('PAGE_SIZE = 6')) {
      throw new Error('SyncPosDespachosList debe tener FILAS_POR_PAGINA fijado a <= 10 filas (actualmente 6)')
    }
  })

  test('SyncPosModal: Desactiva confirmación si hay descuadre matemático o montos pendientes', () => {
    if (!posModalContent.includes('totalDinamico.tieneDescuadre')) {
      throw new Error('SyncPosModal debe validar totalDinamico.tieneDescuadre antes de permitir confirmación')
    }
  })

  // ─── RESUMEN FINAL ─────────────────────────────────────────────────────────
  console.log('\n=================================================================')
  console.log('                     RESUMEN DE RESPONSIVIDAD                    ')
  console.log('=================================================================')
  console.log(`  Total de Pruebas Ejecutadas: ${totalTests}`)
  console.log(`  Pruebas Exitosas:            ${passedTests}`)
  console.log(`  Pruebas Fallidas:            ${failedTests}`)

  if (failedTests > 0) {
    console.log('\n[✖] SE DETECTARON FALLOS DE RESPONSIVIDAD:')
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.name} -> ${f.error}`))
    process.exit(1)
  } else {
    console.log('\n[✔] TODAS LAS REGLAS DE RESPONSIVIDAD Y IPHONE SE CUMPLEN DETERMINISTAMENTE.\n')
    process.exit(0)
  }
}

run().catch(err => {
  console.error('Error fatal en suite determinista:', err)
  process.exit(1)
})
