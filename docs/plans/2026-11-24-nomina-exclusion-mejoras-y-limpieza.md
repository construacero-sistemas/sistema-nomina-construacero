# Plan de Mejoras y Limpieza de Nómina por Exclusión

> **Para el ejecutor:** implementar tarea por tarea con TDD (prueba primero, falla esperada, cambio mínimo, verificación en verde). No tocar rutas fuera del repo ni duplicar lógica del dominio (`server/lib/`).

**Objetivo:** Alinear el 100 % de la interfaz de Nómina (Empleados, Asistencia móvil, Períodos y Cierre) con el modelo de asistencia presente por defecto (Opción A), eliminar código muerto heredado del reloj/recibos y añadir controles operativos útiles para gestión por exclusión.

**Arquitectura:** Reutilizar las funciones puras existentes de dominio (`esDiaPresentePresunto`, `diasHabilesPresuntos`, `construirRegistroExcepcion`, `horarioEfectivoDelDia`) compartidas entre Worker y UI, reduciendo vistas duplicadas en móvil y evitando consultas adicionales a Supabase donde `lineas` o `registros` ya están en caché.

**Stack:** React 19, TanStack Query, Vitest + Testing Library, Cloudflare Workers REST handlers (`server/handlers/`), Tailwind CSS, `scripts/check-project.mjs` y `scripts/test-responsiveness-deterministic.mjs`.

---

## Fase 1 — Coherencia y limpieza urgente (sin migraciones SQL)

### Tarea 1: Avance semanal por exclusión en la pestaña *Empleados*

**Archivos:**
- Modificar: `src/utils/resumenFichaEmpleado.js` (`avanceSemanaPorEmpleado`)
- Modificar: `src/components/nomina/TabEmpleados.jsx` (`avancePorEmpleado`, líneas 70–77 y tarjeta lines 459–472)
- Pruebas: `src/utils/__tests__/resumenFichaEmpleado.test.js` y nueva aserción en `TabEmpleados.test.jsx`

**Qué cambia:**
1. Ampliar la firma de `avanceSemanaPorEmpleado(registros = [], opciones)` (retrocompatible si el segundo argumento es `Map` o `{ empleados, desde, hasta, hoy, feriados }`):
   - Cuando recibe la lista de `empleados` y el rango `{ desde, hasta, hoy, feriados }`, recorre cada día `f` desde `desde` hasta `min(hasta, hoy)`:
     - Si hay registro en `registros`, suma `faltas` (si `es_ausencia && !esFaltaJustificada`), `justificadas` o `trabajados` / `descansoTrabajados` según calendario.
     - Si **no** hay registro y `esDiaPresentePresunto({ empleado, fecha: f, feriado })` es `true`, suma `trabajados += 1`.
   - También expone si el empleado ingresó durante esa semana (`ingresoEnSemana: boolean`) para mostrar un badge claro en la tarjeta de *Empleados* (`Ingresa el dd mmm`) y evitar dudas sobre por qué cuenta menos días.
2. En `TabEmpleados.jsx`:
   - Pasar `{ desde: semanaActual.desde, hasta: min(semanaActual.hasta, hoyIso), hoy: hoyIso, feriados, empleados: configs }` junto a `asistenciaSemana.registros` (usando `useFeriados(semanaActual.desde, semanaActual.hasta)` o caché compartida).
   - Actualizar textos de tarjeta: `"Esta semana (hasta hoy): X de Y días"`.

**Verificación:**
```powershell
npx vitest run src/utils/__tests__/resumenFichaEmpleado.test.js src/components/nomina/__tests__/TabEmpleados.test.jsx
```

---

### Tarea 2: Simplificar sub-vistas móviles de *Asistencia* (de 3 a 2 pestañas)

**Archivos:**
- Modificar: `src/components/nomina/TabAsistencia.jsx` (líneas 63, 175–194, 242–315)
- Pruebas: `src/components/nomina/__tests__/TabAsistencia.test.jsx`

**Qué cambia:**
1. Eliminar la pestaña duplicada **`Manual nómina`** en móvil (`selectorModoMovil`), dejando solo **2 botones** (`grid-cols-2`):
   - **`Hoy`** (`id: 'hoy'`, por defecto cuando `esAdmin`): muestra directamente `MarcajeLogisticaPanel` (asistencia presente por defecto de hoy, chips de `+0.5h`..`+4h`, ausencias, descansos trabajados y banner de cierre).
   - **`Semana`** (`id: 'semana'`): muestra la navegación semanal (`Semana XX-YYYY · anterior / siguiente`), KPIs y la grilla/lista de 7 días para editar excepciones de días pasados o ver toda la semana (y si el usuario toca un día en teléfono desde `Semana`, abre directamente `AsistenciaModal` sin paso intermedio duplicado, o conserva `AsistenciaDiariaMovil` bajo la vista `Semana` con selector de fecha integrado).
2. Reemplazar el parámetro inicial `useState(esAdmin ? 'reloj' : 'semana')` por `'hoy'` / `'semana'` sin referencias a `'reloj'`.

**Verificación:**
```powershell
npx vitest run src/components/nomina/__tests__/TabAsistencia.test.jsx
npm run test:responsive
```

---

### Tarea 3: Retirar alertas heredadas del reloj y limpiar componentes/hooks huérfanos

**Archivos:**
- Modificar: `src/components/nomina/TabAsistencia.jsx` (quitar `salidasPendientes` / `jornadasAbiertasDe` banner amarillo de *"reloj real"* en líneas 137 y 229–239)
- Revisar/limpiar mensajes en: `src/components/nomina/CerrarPeriodoModal.jsx` (línea 246), `src/components/nomina/TabPeriodos.jsx` (líneas 151 y 273) para hablar de *"registros"* o *"planilla"* en vez de *"recibos"* o *"reloj"*.
- Eliminar componentes huérfanos que ya no se importan en producción ni son requeridos por la UI de exclusión:
  - `src/components/nomina/AsistenciaMasivaModal.jsx` (+ `__tests__/AsistenciaMasivaModal.test.jsx`)
  - `src/components/nomina/CorreccionMarcajeModal.jsx`
  - `src/components/nomina/RecibosEmpleadoModal.jsx` (+ `__tests__/RecibosEmpleadoModal.test.jsx`)
  - `src/components/nomina/PagarNominaModal.jsx`
  - `src/components/nomina/marcaje/AnularEntradaModal.jsx`
  - Verificar con `check-project.mjs` qué pruebas o contratos referencian `useNominaMarcaje.js` / `nominaReciboPDF.js` antes de retirar cualquier export heredado del backend (`handlePagarLineas` y endpoints históricos se mantienen en el servidor por seguridad contable/regresión E2E salvo indicación contraria).

**Verificación:**
```powershell
npm run check:project; if ($?) { npm run lint }; if ($?) { npm run test:responsive }
```

---

## Fase 2 — Transparencia al cerrar y cero fricción en Períodos

### Tarea 4: Desglose de novedades por persona dentro de `CerrarPeriodoModal`

**Archivos:**
- Modificar: `src/components/nomina/CerrarPeriodoModal.jsx`
- Pruebas: `src/components/nomina/__tests__/CerrarPeriodoModal.test.jsx`

**Qué cambia:**
1. Sin hacer llamadas extra al backend (usando el array `lineas` ya cargado en `CerrarPeriodoModal`), construir `novedadesPorPersona` filtrando las líneas donde:
   - `Number(l.horas_extra) > 0` → etiqueta `+${l.horas_extra} h extra`
   - `Number(l.dias_ausencia) > 0` → etiqueta `${l.dias_ausencia} falta(s)`
   - `Number(l.dias_sabado) + Number(l.dias_feriado) > 0` → etiqueta `${n} esp./desc.`
   - `Number(l.deducciones_usd) > 0` o `Number(l.bonos_usd) > 0` → etiqueta `ajuste manual`
2. Renderizar un bloque compacto *"Novedades de la semana"* entre las tarjetas KPI y el selector de tasa:
   - Si no hubo excepciones: texto breve en verde *"Semana sin excepciones (asistencia completa de todo el personal)"*.
   - Si hubo novedades: lista compacta escaneable con nombre capitalizado (`min-w-0 truncate`) y badges de color por trabajador para auditar en 5 segundos antes de confirmar la tasa.

**Verificación:**
```powershell
npx vitest run src/components/nomina/__tests__/CerrarPeriodoModal.test.jsx
```

---

### Tarea 5: Reducir fricción del botón «Calcular nómina» en *Períodos*

**Archivos:**
- Modificar: `src/components/nomina/TabPeriodos.jsx`
- Opcional backend: `server/handlers/nomina.periodos.js` (`handleGetPeriodos` o disparo discreto en cliente)
- Pruebas: `src/components/nomina/__tests__/TabPeriodos.test.jsx`

**Qué cambia:**
1. Hoy el usuario ve un botón grande `Calcular nómina` en períodos abiertos nuevos aunque tanto al entrar a `Hoja semanal` (`useAutoCalculoPeriodo`) como al cerrar (`CerrarPeriodoModal`) el cálculo ya corre automáticamente.
2. Mantener **uno de dos enfoques limpios**:
   - **Enfoque A (solo UI, riesgo cero):** En `TabPeriodos.jsx`, para períodos `abierto` con `total_empleados === 0` mostrar en la tarjeta `"Cálculo listo para revisar"` con botón principal **`Ver hoja semanal`** (que dispara `useAutoCalculoPeriodo` al abrir) y dejar `Recalcular` como acción discreta secundaria junto al menú `Más acciones`.
   - Confirmar en `TabPeriodos.test.jsx` que los permisos (`puedeGestionarNomina`) siguen protegiendo `Recalcular` y `Revisar y cerrar período`.

**Verificación:**
```powershell
npx vitest run src/components/nomina/__tests__/TabPeriodos.test.jsx
```

---

## Fase 3 — Capacidades operativas opcionales (según necesidad operativa)

### Tarea 6 (Opcional): Horas extras en grupo para un mismo día

**Archivos:**
- Crear/extender: `server/handlers/nomina.excepciones.js` (`handleRegistrarHorasExtraMasivo`), `server/handlers/nomina.js`, `worker.js`
- Crear/modificar: `src/hooks/useNominaMarcaje.js`, `src/components/nomina/MarcajeLogisticaPanel.jsx`, modal compacto `HorasExtraGrupoModal.jsx`
- Pruebas: `server/handlers/__tests__/nomina.excepciones.test.js`, `nomina.permisos.test.js`, `MarcajeLogisticaPanel.test.jsx`

**Qué cambia:**
1. Endpoint `POST /api/nomina/marcaje/horas-extra-masivo` protegido con `requireCapacidad(operador, 'administrarNomina')` y `tenantGuard`, aceptando `{ empleadoIds, fecha, horasExtra, nota }` (`0.5..16`), saltando o reportando empleados ausentes o sin control de asistencia sin corromper otros registros.
2. Botón `"Extras en grupo"` en la cabecera de `MarcajeLogisticaPanel` para aplicar rápidamente las mismas horas extras a varios empleados seleccionados (ej. descarga o inventario nocturno).

---

### Tarea 7 (Opcional): Permiso parcial / media jornada en día laborable

**Archivos:**
- Evaluar alcance en DB/cálculo: `server/lib/nominaUtils.js`, `server/handlers/nomina.asistencia.js`, `src/components/nomina/AsistenciaModal.jsx`
- Pruebas: `server/lib/__tests__/nominaUtils.test.js`, `src/components/nomina/__tests__/AsistenciaModal.test.jsx`

**Qué cambia:**
1. Solo si en la operación real se descuenta por horas (y no alcanza con un descuento manual en USD desde `HojaSemanal` → botón `+`): añadir una tercera opción `Medio día / permiso parcial` en `AsistenciaModal.jsx` que registre horas reales trabajadas `< horasJornada` (ej. `4 h` sobre `8 h`), y ajustar `calcularLineaNomina` para prorratear el día trabajado en proporción a `horas_normales / horasJornada` cuando corresponda.
2. *Recomendación técnica:* implementar las Fases 1 y 2 primero, y confirmar con el usuario si necesita la Fase 3 antes de alterar la regla de prorrateo por horas del motor.

---

## Criterio de cierre obligatorio del plan

Al completar cada fase, ejecutar en `C:\Users\luigg\Desktop\sistemas personalizados\construacero\nomina y staging\nomina-construacero`:
1. Actualizar `docs/BITACORA_PROYECTO.md` al inicio del archivo con las reglas y archivos modificados.
2. Correr la batería completa sin atajos:
```powershell
Set-Location 'C:\Users\luigg\Desktop\sistemas personalizados\construacero\nomina y staging\nomina-construacero'
npm run verify
```
3. Confirmar código de salida `0` en todas las compuertas (`check:project`, `test:qa`, `test:responsive`, `lint`, `test:deterministic`, `npm test`, `test:db`, `build`, `test:bundle-size`).
