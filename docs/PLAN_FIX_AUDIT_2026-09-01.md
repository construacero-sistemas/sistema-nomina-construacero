# PLAN_FIX_AUDIT_2026-09-01

Plan completo de corrección derivado de la auditoría integral del 2026-09-01. Cada fase incluye: alcance, harness (infraestructura de prueba), guardrail (regla permanente que impide regresión) y tests respectivos. Al terminar cada fase: `npm run verify` + actualizar `docs/BITACORA_PROYECTO.md`.

Estado base verificado: lint 0 errores · 394/394 tests · scanner responsive 24/24 (47 componentes) · build OK.

---

## FASE 1 — Violaciones de reglas AGENT.md (P1)

### 1.1 Eliminar `confirm()` nativo en CuentasCustodiaGrid
- **Problema:** `src/components/finanzas/CuentasCustodiaGrid.jsx:241` usa `confirm()` nativo (bloquea el hilo, sin estilo, viola regla de modales de AGENT.md).
- **Fix:** reemplazar por el patrón existente `Modal` + estado `cuentaAEliminar` + botones Cancelar/Confirmar (mismo patrón que `AnularDialog` en FinanzasView). El botón de confirmación queda `disabled` 500 ms para evitar taps accidentales en móvil.
- **Guardrail:** nueva sección 9 en `scripts/test-responsiveness-deterministic.mjs`: escanear todos los JSX de `src/` y `compat/` y fallar si aparece `confirm(`, `alert(` o `prompt(` fuera de comentarios.
- **Tests:**
  - `src/components/finanzas/__tests__/CuentasCustodiaGrid.test.jsx`: (a) click en "Eliminar" abre modal, no `window.confirm`; (b) confirmar llama `onEliminarCuenta` con la cuenta correcta; (c) cancelar no llama nada; (d) spy sobre `window.confirm` garantiza 0 invocaciones.
  - Test determinista: `Cero diálogos nativos en la UI` (scanner).

### 1.2 Sustituir glifo ⚠️ por icono Lucide
- **Problema:** `src/NominaApp.jsx:319` renderiza `⚠️` como texto (la regla de iconos prohibe Unicode gráfico).
- **Fix:** `<AlertTriangle size={10} className="text-amber-300" />` (import ya existe en el archivo).
- **Guardrail:** scanner sección 9: lista negra de glifos (`⚠️ ✨ 🏢 📍 🏦 📱 💵 🌐 📋 💳`) bloqueada en JSX de `src/` y `compat/`.
- **Tests:** test determinista `Cero glifos Unicode gráficos en la UI`; verificación visual en 390x844 (header con tasa stale).

### 1.3 Touch targets ≥ 44 px
- **Problema:** botones/inputs con `h-9`/`h-10` y controles `py-0.5 text-[10px]` (MovimientoForm: botones de tasa; FinanzasView: fila de filtros; CuentaFormModal; HolidayModals; RateSelector; TabAsistencia; DatePicker) quedan bajo 44 px.
- **Fix:** pase global: botones interactivos → `h-11` mínimo; controles pequeños → padding que garantice ≥ 44 px de caja táctil (wrapper `p-1.5` alrededor de iconos pequeños). Inputs de texto → `h-11`.
- **Guardrail:** scanner sección 10: detectar `h-9`/`h-10` en `<button`/`<input` (heurística misma línea o siguiente) y fallar; `h-10` permitido solo en elementos no interactivos.
- **Tests:** test determinista `Touch targets ≥ 44px en botones e inputs`; test de componente `MovimientoForm: botones de tasa tienen h-11 o padding táctil`.

**Criterio de salida Fase 1:** `npm run verify` verde + 2 tests deterministas nuevos en el scanner + suite de componente de CuentasCustodiaGrid.

---

## FASE 2 — Fiabilidad y observabilidad (P2)

### 2.1 Sincronización contable silenciosa → trazable
- **Problema:** `server/handlers/nomina.lineas.js` (`handlePagarLineas`, `handleRevertirPagoLinea`) envuelven la escritura en Finanzas con `try { … } catch {}` vacío; un fallo produce descuadre nómina↔finanzas invisible.
- **Fix:** en el catch, `registrarAuditoria(..., { categoria: 'FINANZAS', accion: 'SYNC_NOMINA_FALLIDA', meta: { periodoIds, ids, error: String(err) } })`. No bloquear la respuesta (el pago ya ocurrió), pero dejar rastro consultable.
- **Guardrail:** regla en AGENT.md: "todo catch vacío en server/ debe registrar auditoría o re-lanzar". Test de lint custom lo verifica.
- **Tests:** `server/handlers/__tests__/nomina.pago-sync.test.js`: (a) POST a `finanzas_movimientos` responde 500 → el pago sigue 200 pero existe auditoría `SYNC_NOMINA_FALLIDA`; (b) flujo feliz → sin entrada de fallo; (c) revertir pago con fallo al anular movimiento → auditoría registrada.

### 2.2 Frontend: console.* → errorLogger
- **Problema:** 3 `console.error` directos (`ComisionPagoModal.jsx:133`, `PeriodoDetalleModal.jsx:50,63`).
- **Fix:** enrutar por `compat/utils/errorLogger.js` (`logClientError`).
- **Guardrail:** scanner: fallar si aparece `console.log` en `src/` (permitir `console.error/warn` solo dentro de `errorLogger.js`).
- **Tests:** test determinista `Sin console.log directo en src/`.

### 2.3 CustomSelect: eliminar suppressions set-state-in-effect
- **Problema:** `compat/components/ui/CustomSelect.jsx:143,146` — `lastLabel` se sincroniza en `useEffect` con `eslint-disable`.
- **Fix:** patrón "adjust state during render" (documentado por React): guardar `{ value, label }` en estado, ajustar durante el render cuando cambian las entradas, sin useEffect ni refs en render.
- **Tests:** `compat/components/ui/__tests__/CustomSelect.test.jsx`: (a) label persiste tras refetch que quita momentáneamente la opción; (b) label se limpia al vaciar value; (c) sin warnings de hooks.

### 2.4 Anular idempotente (finanzas) — cobertura e2e
- **Tests:** `server/handlers/__tests__/finanzas.anular.test.js`: (a) anular activo → 200 + estado anulado + auditoría; (b) anular dos veces el mismo id → segunda respuesta `idempotente: true` sin segunda escritura; (c) motivo < 3 chars → 400; (d) id de otra cuenta → 404 (tenant); (e) rol no-admin → 403.

**Criterio de salida Fase 2:** suite server > 400 tests, 0 eslint-disable en CustomSelect, catch con auditoría probado.

---

## FASE 3 — Performance de carga

### 3.1 Code-splitting de vistas
- **Problema:** chunk `index` 559 kB (gzip 147 kB): `NominaView` y `FinanzasView` van estáticas en `NominaApp.jsx`.
- **Fix:** `const NominaView = lazy(() => import('./views/NominaView.jsx'))` + `<Suspense fallback={<Loading/>}>` alrededor de `<Outlet/>` en `Shell`. Igual para `FinanzasView`.
- **Guardrail:** registrar tamaños de chunk en bitácora; si `index` supera 400 kB post-split, investigar.
- **Tests:** `scripts/test-bundle-size.mjs`: parsear salida de `vite build` y fallar si `index-*.js` > 400 kB (gzip > 110 kB). Añadir a `npm run verify`.

### 3.2 PDF bajo demanda
- **Problema:** chunk `pdf` 588 kB se carga aunque el usuario nunca exporte.
- **Fix:** dividir cada servicio en `.impl.js` (implementación jsPDF interna) + wrapper delgado que hace `await import('./…impl.js')`; los consumidores ya usan `await import()` en los modales, así que el chunk solo carga al exportar.
- **Guardrail:** `npm run build` sin chunk `pdf` referenciado desde el HTML inicial.
- **Tests:** build determinista verifica que el chunk `pdf` no se referencie desde el HTML inicial.

**Criterio de salida Fase 3:** build verde, `index` < 400 kB, chunk pdf ausente del HTML inicial.

---

## FASE 4 — Tests de frontend (harness nuevo)

### 4.1 Harness de componentes
- **Infra:** añadir `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`. Ampliar `vitest.config.js` con `environmentMatchGlobs` para JSX y `setupFiles` con jest-dom.
- **Guardrail:** CI falla si `include` de vitest deja de contener los globs de frontend.

### 4.2 Tests prioritarios (orden de valor)
1. `MovimientoForm.test.jsx` — validación completa + payload correcto.
2. `AnularDialog.test.jsx` — deshabilitado con motivo < 3 chars; confirmar llama `onConfirm(motivo.trim())`.
3. `CustomSelect.test.jsx` — (ver 2.3).
4. `CuentasCustodiaGrid.test.jsx` — (ver 1.1).
5. `MovimientoTable.test.jsx` — paginación, `onAnular`, fila anulada.
- **Guardrail:** mínimo 5 archivos de test de componente en CI.

---

## FASE 5 — E2E de lógica crítica

### 5.1 Ciclo de vida completo nómina + asiento financiero
- **Test:** `server/handlers/__tests__/nomina.ciclo-finanzas.test.js` con `installFetchMock`: crear → calcular → cerrar → pagar (assert movimiento con `idempotency_key` determinista) → revertir (assert movimiento anulado + periodo `cerrado`).
- **Guardrail:** contrato nómina↔finanzas; cualquier cambio en la sync contable debe actualizarlo.

### 5.2 Períodos: invariantes
- **Test:** `nomina.periodos-guardas.test.js`: solapamiento; > 31 días; cerrar sin líneas; reabrir pagado; eliminar con pagados.

### 5.3 Marcaje idempotente
- **Test:** `nomina.marcaje-idempotencia.test.js`: dos POST con misma `idempotency_key` → una fila.

---

## FASE 6 — Documentación

1. **Consolidar:** `docs/ESTADO_ACTUAL.md` + `docs/PLAN_UNICO.md`; archivar los 5 originales en `docs/archive/`.
2. **README:** actualizar "Estado de entrega".
3. **AGENT.md:** añadir reglas nuevas (catch con auditoría, sin diálogos nativos, touch targets ≥ 44 px).
4. **Bitácora:** entrada por cada fase.
- **Guardrail:** `scripts/check-project.mjs` ampliado: fallar si faltan `docs/ESTADO_ACTUAL.md` o `docs/BITACORA_PROYECTO.md`.

---

## Orden de ejecución

| Fase | Contenido | Esfuerzo | Riesgo |
|---|---|---|---|
| 1 | confirm(), ⚠️, touch targets | 1 sesión | bajo |
| 2 | catch auditable, errorLogger, CustomSelect, anular e2e | 1 sesión | bajo |
| 3 | lazy views, pdf dinámico | ½ sesión | medio |
| 4 | harness frontend + 5 suites | 1 sesión | medio |
| 5 | ciclo nómina↔finanzas e2e, guardas, marcaje | 1 sesión | bajo |
| 6 | consolidación docs | ½ sesión | bajo |

Regla transversal: ninguna fase toca migraciones de Supabase ni el contrato de Personal.
