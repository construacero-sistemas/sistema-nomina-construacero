# Reporte QA — Flujo mensual completo, de principio a fin (2026-10-19)

Encargo: pruebas deterministas de **todo el flujo del mes**, tal como lo vive el usuario, cazando errores, mejoras y simplificaciones. Base: PostgreSQL real embebido (PGlite) con las **50 migraciones aplicadas desde cero** — las reglas probadas son las del SQL de producción, no una simulación.

## 1. Qué se construyó

**`scripts/test-flujo-mes-deterministic.mjs`** (nuevo; `npm run test:flujo-mes`, encadenado también en `npm run test:deterministic`). **11 fases** que recorren dos ciclos mensuales completos como los viviría el usuario:

| Fase | Qué recorre |
|---|---|
| F1 | Consulta inicial: mes sin apertura, saldos del libro |
| F2 | Apertura por conteo físico: congela saldos y tasas, idempotencia, clave no reutilizable |
| F3 | Día a día: ventas y compras; `saldoCalculado = apertura + neto` cuadra |
| F4 | Guardarraíles: duplicado exacto/similar, fondos, clave de idempotencia de un solo uso |
| F5 | Anulación sin motivo (basta el usuario); CHECK de la 255 rechaza sin usuario ni motivo |
| F6 | Traspaso entre carteras (2 asientos) y cuenta nueva a mitad de mes |
| F7 | Cierre: faltante con motivo, motivo corto rechazado, auto-alta de cuenta (4.4), idempotencia |
| F8 | Mes cerrado inmutable (ni altas ni ediciones) |
| F9 | Mes 2: hereda el cierre, exige motivo ante diferencias, descubierto documentado |
| F10 | El saldo del período **financia** los gastos del mes; cuenta nueva vía `alta_cuenta`; el mes corriente no se cierra |
| F11 | Mes a mes: resumen operativo, saldos vivos y cierre heredado coherentes |

## 2. Errores hallados y corregidos

### E1 — `alta_cuenta` fechaba el inicio del período en «hoy» (corregido en la 254)
La rama `alta_cuenta` de `finanzas_periodo_mensual_operar` guardaba `fecha_inicio = current_date`, mientras la apertura y el alta automática del cierre usan `p_mes_inicio` (día 1). Consecuencia: un movimiento del mes fechado **antes** del alta quedaba fuera de `saldoCalculado` y del neto de cierre → el cierre habría pedido motivo por un «sobrante» que sí era dinero real registrado (descuadre fantasma). Reproducido en F10 (saldo 80 vs 100 reales). **Corregido**: `fecha_inicio = p_mes_inicio`, dejando las tres ramas con la misma regla. Verificado: F10 en verde y `test:db` 42/42 sin cambios.

### E2 — `finanzas_resumen` sin orden determinista (corregido en la migración 256)
Las versiones 221/223 traían `ORDER BY tipo, categoria`; la 232 (multimoneda) reemplazó la función **sin el ORDER BY** y las 233/239 heredaron la omisión. El agregado «mes a mes» podía volver en distinto orden entre corridas (rompía comparaciones y pintaba filas en orden variable). **Corregido** en `256_finanzas_resumen_orden.sql`: se transcribe el cuerpo vigente (el de la 239: desglose por moneda, filtro de traspasos, `tasa_registrada_en`) y solo se agrega `ORDER BY m.tipo, m.categoria`; firma, retorno y permisos intactos (service_role only, reafirmados). Fijado por la fase F11 del flujo del mes, que compara **sin ordenar en el cliente**.

## 3. Comportamientos verificados (no son bugs; hay que conocerlos)

1. **`aperturar` exige TODAS las cuentas activas exactamente una vez** (PT400 si falta una). El wizard de apertura ya manda todas, pero es un contrato que no estaba escrito en ninguna parte.
2. **Cuenta nueva a mitad de mes**: no admite movimientos hasta el alta (PT409 «Wallet must be opened»), pero la UI la da de alta sola — `FinanzasView.guardarCuenta` → `/api/finanzas/periodos-mensuales/alta-cuenta` congelando las tasas de apertura. Sin hueco de UX.
3. **`alta_cuenta` solo existe para el mes corriente** (PT409 en meses pasados); una cuenta que nació en un mes ya cerrado-para-siempre-vivo espera el **alta automática al cerrar** (regla 4.4), que la registra con su saldo calculado y motivo «Alta automática…».
4. **El resumen del mes excluye traspasos entre carteras y asientos anulados** (239, a propósito: son dinero interno o reversado). El libro directo sí los conserva. En el UI «mes a mes» los bloques «Por cuenta» mueven dinero que los totales Ingresos/Gastos no suman — correcto, pero conviene un pie que lo explique.
5. **El guard de saldo mira el saldo del período al fin del mes** (`least(fin de mes, hoy)`), no en la fecha del movimiento: un gasto que dejaría un día intermedio en negativo pasa si el mes cierra en positivo. Aproximación deliberada; documentada aquí para auditorías futuras.
6. **El descubierto cuadra**: apertura −150 + ingreso previo de 150 del mes = 0 (el conteo físico). `saldoApertura` puede ser negativo y el saldo vivo se recupera con los movimientos del mes.
7. **Ventana de cierre**: solo el mes anterior y tras su último día; el mes corriente jamás se cierra («Only the previous month may be closed»).
8. **Clave de idempotencia de un solo uso**: la segunda inserción con la misma clave revienta en el índice único (23505); el Worker la mapea a 409.

## 4. Mejoras y simplificaciones propuestas

- **M1 — Restaurar `ORDER BY` en `finanzas_resumen`** (error E2): **IMPLEMENTADA** en la migración 256. Lección del camino: un primer borrador se descartó porque había tomado el cuerpo de la 232 en vez del vigente (239) y reabría permisos a `authenticated`; la versión final respeta el cuerpo 239 al pie de la letra y solo agrega el `ORDER BY`.
- **M2 — Simplificar `scripts/prepare-staging.mjs`**: quedó obsoleto (exige 44 migraciones terminando en la 250; hoy hay 50 hasta la 255). El vigente es `seed-staging-fixtures.mjs` (`npm run prepare:staging`). Borrarlo o actualizarlo evita que alguien ejecute el viejo y confíe en un error de inventario.
- **M3 — Backdating vs conteo físico**: un movimiento fechado antes del conteo pero registrado después suma al saldo aunque el conteo ya lo incluyera (doble cómputo potencial). Es la misma aproximación de la apertura (`apertura = conteo − neto`); si se quiere endurecer, exigir `fecha ≥ fecha del conteo` en el alta/apertura.
- **M4 — Pie explicativo en «Por cuenta»** (ver §3.4): una línea «los traspasos entre carteras no cuentan como ingreso/gasto» evita la duda recurrente.

## 5. Estado en vivo (staging / producción)

- **Staging vivo y sano**: `npm run check:staging` OK y `npm run test:staging:smoke` completo en verde (Auth, nómina, guards, idempotencia) contra el proyecto aislado.
- **Bloqueo para desplegar**: el `SUPABASE_ACCESS_TOKEN` de `.env` está vencido o revocado — **401 en las cuatro llamadas de la Management API** (proyecto, lista, claves, migraciones). Sin ese token no se pueden aplicar las migraciones **251–255** (incluida la 254 corregida) a staging, ni tocar producción. **Paso para desbloquear**: crear un Personal Access Token nuevo en el dashboard de Supabase (Account → Access Tokens), reemplazarlo en `.env`, y ejecutar `npm run prepare:staging` — aplica en orden solo las pendientes y exige que el historial quede idéntico al inventario local.
- **Producción**: el repo no tiene tooling de despliegue hacia producción (los scripts solo apuntan al proyecto staging aislado, con verificación de identidad). Con el token vigente se puede aplicar el mismo patrón con el ref de producción, o pegar las migraciones 251–255 por el SQL editor del dashboard. Recomendación: staging primero, smoke, y solo entonces producción.

## 6. Cómo correrlo

- `npm run test:flujo-mes` — el flujo completo del mes (11 fases, ~30 s).
- `npm run test:deterministic` — ahora incluye nómina + finanzas + **flujo del mes**.
- `npm run test:db` — 42 comprobaciones de reglas SQL (50 migraciones).

## 7. Verificación de este trabajo

`test:flujo-mes` **11/11** · `test:db` **42/42** (50 migraciones) · suite vitest completa · `lint` · `check:project` — todo en verde en el mismo turno (cifras exactas en la bitácora 125). Sin comprobaciones fallidas ni omitidas. Única limitación: el despliegue a staging/producción por el token vencido (§5).
