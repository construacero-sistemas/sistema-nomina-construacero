# Edición de Categoría y Motivo de Movimientos (Exclusivo Jefe) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir al rol de `jefe` editar de forma rápida y segura la categoría y el concepto/motivo de un movimiento financiero activo sin alterar variables contables críticas (monto, moneda, tasas, fechas).

**Architecture:** Implementar un endpoint REST `POST /api/finanzas/movimientos/actualizar` protegido por la capacidad `administrarSistema` (exclusivo para jefe y soporte), un hook de mutación `useActualizarMovimiento` en React Query, y un modal desacoplado `MovimientoEditarModal.jsx` activable desde un botón de edición en `MovimientoTable.jsx` solo para usuarios autorizados.

**Tech Stack:** Cloudflare Worker / JavaScript ESM, Supabase PostgREST, React 19, Tailwind CSS, Lucide React, Vitest.

---

### Task 1: Backend Handler y Ruta para Actualización de Movimiento

**Files:**
- Create: `server/handlers/__tests__/finanzas.actualizar.test.js`
- Modify: `server/handlers/finanzas.js`
- Modify: `worker.js`

**Step 1: Escribir el test que falla (TDD)**
Crear `server/handlers/__tests__/finanzas.actualizar.test.js` validando:
- Permiso denegado (403) para rol `finanzas`.
- Permiso concedido para rol `jefe`.
- Validación de parámetros (id UUID, concepto 1-180 chars, categoría 1-80 chars).
- Rechazo si el movimiento está anulado (409).
- Actualización exitosa en Supabase REST y registro de auditoría.

**Step 2: Ejecutar el test para comprobar que falla**
Run: `npx vitest run server/handlers/__tests__/finanzas.actualizar.test.js`
Expected: FAIL con handler no encontrado o ruta no definida.

**Step 3: Implementar `handleActualizarFinanzasMovimiento` en `server/handlers/finanzas.js` y registrar la ruta en `worker.js`**
En `server/handlers/finanzas.js`:
- Exportar `handleActualizarFinanzasMovimiento(request, env)`.
- Validar operador y requerir capacidad `administrarSistema`.
- Leer body (`id`, `categoria`, `concepto`, `referencia`, `observaciones`).
- Verificar que el movimiento exista, pertenezca a la cuenta y su estado sea `'activo'`.
- Ejecutar PATCH a `${env.SUPABASE_URL}/rest/v1/finanzas_movimientos` actualizando únicamente los campos descriptivos.
- Llamar a `registrarAuditoria(...)`.
- Retornar `{ ok: true, movimiento: movementResponse(updatedRow) }`.

En `worker.js`:
- Importar `handleActualizarFinanzasMovimiento` y agregar `['POST /api/finanzas/movimientos/actualizar', handleActualizarFinanzasMovimiento]` a `routes`.

**Step 4: Ejecutar el test para comprobar que pasa**
Run: `npx vitest run server/handlers/__tests__/finanzas.actualizar.test.js`
Expected: PASS

---

### Task 2: Hook Frontend de Mutación (`useActualizarMovimiento`)

**Files:**
- Modify: `src/hooks/useFinanzas.js`

**Step 1: Agregar `useActualizarMovimiento` a `src/hooks/useFinanzas.js`**
```javascript
export function useActualizarMovimiento() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, categoria, concepto, referencia, observaciones }) =>
      apiPost('/api/finanzas/movimientos/actualizar', { id, categoria, concepto, referencia, observaciones }),
    onSuccess: () => {
      showToast.success('Movimiento actualizado')
      client.invalidateQueries({ queryKey: BASE_KEY })
    },
    onError: error => showToast.error(error.message || 'No se pudo actualizar el movimiento'),
  })
}
```

---

### Task 3: Componente `MovimientoEditarModal.jsx` y Pruebas Unitarias

**Files:**
- Create: `src/components/finanzas/MovimientoEditarModal.jsx`
- Create: `src/components/finanzas/__tests__/MovimientoEditarModal.test.jsx`

**Step 1: Escribir el test de interfaz para `MovimientoEditarModal`**
Crear `src/components/finanzas/__tests__/MovimientoEditarModal.test.jsx`:
- Verifica que el modal renderiza los valores iniciales de categoría y concepto.
- Permite cambiar la categoría y editar el texto del concepto.
- Valida que el botón "Guardar cambios" se deshabilite si el concepto está vacío.
- Llama a `onGuardar` con los valores modificados al hacer submit.

**Step 2: Ejecutar el test para comprobar que falla**
Run: `npx vitest run src/components/finanzas/__tests__/MovimientoEditarModal.test.jsx`
Expected: FAIL (archivo no existe).

**Step 3: Implementar `MovimientoEditarModal.jsx`**
Crear `src/components/finanzas/MovimientoEditarModal.jsx`:
- Usa `Modal` accesible del proyecto.
- Campos:
  - `CustomSelect` para seleccionar categoría (a partir de las categorías activas recibidas).
  - Input/Textarea de concepto (`maxLength={180}`).
  - Input opcional de referencia (`maxLength={160}`).
- Botones de acción con `min-h-11`, `touchAction: 'manipulation'` y estado de carga (`isPending`).
- Total de líneas contenido (< 120 líneas).

**Step 4: Ejecutar el test para comprobar que pasa**
Run: `npx vitest run src/components/finanzas/__tests__/MovimientoEditarModal.test.jsx`
Expected: PASS

---

### Task 4: Integración en `MovimientoTable.jsx` y `FinanzasView.jsx`

**Files:**
- Modify: `src/components/finanzas/MovimientoTable.jsx`
- Modify: `src/components/finanzas/FinanzasView.jsx`
- Modify: `src/components/finanzas/__tests__/FinanzasView.capacidades.test.jsx`

**Step 1: Actualizar `MovimientoTable.jsx`**
- Recibir prop `onEditar` en `MovimientoTable`.
- En `DesktopRow` y `MobileRow`:
  - Si `activo` y `onEditar` está definido:
    - Renderizar botón `Editar` (ícono `Pencil` de Lucide, estilos coherentes con `Anular`, touch target $\ge 44$px).
    - Al hacer clic, invocar `onEditar(item)`.

**Step 2: Conectar en `FinanzasView.jsx` con guardia de capacidad**
- Agregar estado: `const [movimientoEditar, setMovimientoEditar] = useState(null)`.
- Instanciar la mutación: `const actualizarMutation = useActualizarMovimiento()`.
- Determinar si puede editar: `const puedeEditar = tieneCapacidad(perfil, 'administrarSistema')`.
- Pasar `onEditar={puedeEditar ? setMovimientoEditar : undefined}` a `MovimientoTable`.
- Renderizar `<MovimientoEditarModal>` condicionalmente cuando `movimientoEditar` exista.
- Cuidar la longitud de `FinanzasView.jsx` para mantenerse estrictamente en $\le 585$ líneas (límite: 600).

**Step 3: Actualizar `FinanzasView.capacidades.test.jsx`**
- Verificar que el botón de editar aparece para el rol `jefe`.
- Verificar que el botón de editar NO aparece para el rol `finanzas`.

---

### Task 5: Verificación Integral del Proyecto y Guardrails

**Files:** Todos los modificados.

**Step 1: Ejecutar pruebas unitarias de finanzas**
Run: `npx vitest run src/components/finanzas/__tests__/ server/handlers/__tests__/finanzas.`
Expected: PASS (todos los tests pasan).

**Step 2: Ejecutar guardrails del proyecto**
Run: `npm run check:project`
Expected: PASS (0 fallos de longitud de archivos, 0 roles literales fuera de matriz).

**Step 3: Ejecutar suite de responsividad**
Run: `npm run test:responsive`
Expected: PASS (41/41 pruebas responsivas y móviles aprobadas).

**Step 4: Ejecutar linter**
Run: `npm run lint`
Expected: PASS (0 errores).

**Step 5: Ejecutar build de producción**
Run: `npm run build`
Expected: PASS (compilación sin errores).
