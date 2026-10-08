# Habilitar Edición de Movimientos para Rol Finanzas — Implementation Plan

> **For Claude / Agents:** REQUIRED SUB-SKILL: Use writing-plans and executing-plans to implement this plan task-by-task.

**Goal:** Habilitar la edición directa de categoría, concepto/motivo y referencia de movimientos financieros para el rol `finanzas` (además del rol `jefe`), gobernado por la capacidad canónica `operarFinanzas` y preservando la inmutabilidad de los importes contables.

**Architecture:**
- Backend: Migrar la compuerta de autorización en `handleActualizarFinanzasMovimiento` (`server/handlers/finanzas.js`) de `jefeContext` (`administrarSistema`) a `operarContext` (`operarFinanzas`).
- Frontend: Actualizar la condición de visibilidad en `FinanzasView.jsx` línea 53 a `tieneCapacidad(perfil, 'operarFinanzas')` para habilitar el botón de edición y el modal a usuarios con rol `finanzas`.
- Tests: Actualizar suites en Vitest (`finanzas.actualizar.test.js` y `FinanzasView.capacidades.test.jsx`) para certificar que el rol `finanzas` puede editar y que roles no financieros (como `nomina`) son bloqueados con 403.

**Tech Stack:** Cloudflare Workers, Node.js / ES Modules, React 19, Tailwind CSS, TanStack Query, Vitest.

---

### Task 1: Actualizar Autorización en el Backend

**Files:**
- Modify: `server/handlers/finanzas.js:352-358`
- Test: `server/handlers/__tests__/finanzas.actualizar.test.js:31-41`

**Step 1: Actualizar tests en `server/handlers/__tests__/finanzas.actualizar.test.js`**

Reemplazar el test antiguo (`deniega acceso con 403 a rol finanzas...`) por:
1. `deniega acceso con 403 a roles sin operarFinanzas (ej. nomina)`
2. `permite a rol finanzas actualizar categoría y concepto exitosamente` (con patchBody fusionado en mock response).

```javascript
  it('deniega acceso con 403 a roles sin operarFinanzas (ej. nomina)', async () => {
    operadorActual = OPERADORES.nomina
    const response = await H.handleActualizarFinanzasMovimiento(
      makeRequest({ id: IDS.linea, categoria: 'Servicios', concepto: 'Luz eléctrica' }),
      ENV,
    )
    const result = await readResponse(response)
    expect(result.status).toBe(403)
  })

  it('permite a rol finanzas actualizar categoría y concepto exitosamente', async () => {
    operadorActual = OPERADORES.finanzas
    let patchBody
    mock = installFetchMock([
      { match: `finanzas_movimientos?id=eq.${IDS.linea}`, method: 'GET', respond: [activeMovement] },
      {
        match: `finanzas_movimientos?id=eq.${IDS.linea}`,
        method: 'PATCH',
        respond: (url, init) => {
          patchBody = JSON.parse(init.body)
          return [{ ...activeMovement, ...patchBody }]
        },
      },
    ])
    const response = await H.handleActualizarFinanzasMovimiento(
      makeRequest({ id: IDS.linea, categoria: 'Servicios', concepto: 'Luz eléctrica corregida' }),
      ENV,
    )
    const result = await readResponse(response)
    expect(result.status).toBe(200)
    expect(result.body.ok).toBe(true)
    expect(patchBody.categoria).toBe('Servicios')
    expect(patchBody.concepto).toBe('Luz eléctrica corregida')
  })
```

**Step 2: Ejecutar test para verificar que falla antes de cambiar el backend**
```bash
npx vitest run server/handlers/__tests__/finanzas.actualizar.test.js
```
Resultado esperado: FALLA porque `finanzas` recibe 403 con `jefeContext`.

**Step 3: Modificar `handleActualizarFinanzasMovimiento` en `server/handlers/finanzas.js`**

Cambiar la compuerta de:
```javascript
// POST /api/finanzas/movimientos/actualizar
// Edición directa de categoría, concepto y referencia (exclusivo jefe).
export async function handleActualizarFinanzasMovimiento(request, env) {
  const context = await jefeContext(request, env)
```
a:
```javascript
// POST /api/finanzas/movimientos/actualizar
// Edición directa de categoría, concepto y referencia (operadores financieros: jefe y finanzas).
export async function handleActualizarFinanzasMovimiento(request, env) {
  const context = await operarContext(request, env)
```

**Step 4: Ejecutar test para verificar que pasa**
```bash
npx vitest run server/handlers/__tests__/finanzas.actualizar.test.js
```
Resultado esperado: PASS (todos los tests en verde).

---

### Task 2: Actualizar la Vista Frontend y sus Tests de Capacidades

**Files:**
- Modify: `src/components/finanzas/FinanzasView.jsx:53`
- Modify: `src/components/finanzas/__tests__/FinanzasView.capacidades.test.jsx:65,84`

**Step 1: Actualizar la compuerta en `FinanzasView.jsx` (línea 53)**

Cambiar únicamente:
```javascript
// De:
const puedeEditar = tieneCapacidad(perfil, 'administrarSistema')
// A:
const puedeEditar = tieneCapacidad(perfil, 'operarFinanzas')
```

**Step 2: Actualizar las expectativas en `FinanzasView.capacidades.test.jsx`**

Actualizar tanto la prueba de rol finanzas (línea 65) como la de transición jefe -> finanzas (línea 84) para esperar `(con edición)`:
- Línea 65: `expect(screen.getByText('Tabla de movimientos (con edición)')).toBeInTheDocument()`
- Línea 84: `expect(screen.getByText('Tabla de movimientos (con edición)')).toBeInTheDocument()`

**Step 3: Ejecutar pruebas del componente y de capacidades**
```bash
npx vitest run src/components/finanzas/__tests__/FinanzasView.capacidades.test.jsx src/components/finanzas/__tests__/MovimientoEditarModal.test.jsx
```
Resultado esperado: PASS.

---

### Task 3: Verificación Integral del Proyecto y Guardrails

**Files:**
- Todos los del repositorio.

**Step 1: Ejecutar verificación de guardrails**
```bash
npm run check:project
```
- Verificar límite de 600 líneas (especialmente `FinanzasView.jsx` y `server/handlers/finanzas.js`).
- Verificar que no hay roles hardcodeados fuera de `server/lib/permissions.js`.

**Step 2: Ejecutar linter**
```bash
npm run lint
```
Resultado esperado: 0 errores y 0 advertencias.

**Step 3: Ejecutar suite de pruebas completa**
```bash
npx vitest run
```
Resultado esperado: 118 suites pasadas, 1242 tests aprobados (1 test adicional por el nuevo de autorización de finanzas).

**Step 4: Compilar build de producción**
```bash
npm run build
```
Resultado esperado: Build generado exitosamente.
