# Plan de convergencia de roles: `administracion` → `jefe`

**Fecha:** 22/09/2026<br>
**Objetivo:** eliminar `administracion` como rol operativo y conservar `jefe` como único rol administrativo de la aplicación, sin perder usuarios, PINs, sesiones auditables ni datos de negocio.

## 1. Alcance y principio de seguridad

La conversión no recrea usuarios ni cambia sus identificadores. Para cada fila de `usuarios` con `rol = 'administracion'`, conserva `id`, `cuenta_id`, `nombre`, `pin_hash`, `pin_salt`, `color`, `activo`, comisiones, fechas y relaciones; solo cambia `rol` a `jefe`.

Las migraciones antiguas pueden seguir conteniendo el literal histórico para explicar su evolución y permitir reproducir la base desde cero. El código operativo, la matriz actual y la migración de convergencia no deben volver a autorizar `administracion`.

## 2. Fases de implementación

### F0 — inventario determinista y backup

Antes de una ejecución remota:

1. Exportar un backup lógico de Supabase y guardar el checksum fuera de `dist/` y fuera del repositorio.
2. Consultar `usuarios` agrupando por `cuenta_id`, `rol`, `activo`.
3. Contar conflictos de cupo: como `administracion` y `jefe` convergen al mismo rol, validar la regla vigente por cuenta antes de ejecutar.
4. Guardar un inventario de IDs, nombres, estados y hashes (nunca publicar `pin_hash` ni `pin_salt`).
5. Verificar que no existan sesiones cuyo `operator_id` apunte a una fila que no se pueda convertir.

**Arnés:** `scripts/test-db.mjs` debe ejecutar una matriz de preflight con filas administrativas, jefes, cuentas separadas e inactivos. El arnés no debe escribir en la base real.

### F1 — código y matriz

1. `server/lib/permissions.js` elimina `administracion` de `ROLES_VALIDOS`, `MATRIZ`, etiquetas y conjuntos derivados.
2. `ADMIN_ROLE` conserva compatibilidad de API, pero su valor canónico pasa a ser `jefe`.
3. Worker, handlers y frontend dejan de ofrecer, resolver o pintar `administracion` como rol operativo.
4. Los datos históricos de auditoría no se reescriben.

### F2 — migración SQL 245

La migración debe ser transaccional e idempotente:

1. Actualizar filas `usuarios` de `administracion` a `jefe`.
2. Reemplazar `roles_capacidad()` eliminando `administracion` de todas las capacidades.
3. Reemplazar `roles_operativos()` mediante la unión del espejo de capacidades.
4. Reemplazar `usuarios_rol_check` sin `administracion`.
5. Mantener las RLS y RPC que consultan `roles_capacidad()` sin duplicar listas.
6. Registrar en auditoría una entrada por cuenta o una entrada por usuario, sin incluir secretos.
7. No borrar filas ni alterar IDs, PINs, relaciones o históricos.

La migración falla antes de modificar datos si detecta una condición incompatible con las reglas actuales. La operación debe ejecutarse con backup previo y verificarse con conteos antes/después.

### F3 — sesiones y reautenticación

Los JWT existentes pueden contener `operator_rol: administracion`. La autorización vigente debe consultar la fila de `usuarios`, no confiar en ese texto. Tras la conversión:

- `operator_id` se conserva.
- El siguiente `/api/auth/me` devuelve el mismo operador con rol `jefe`.
- La sesión no se invalida innecesariamente.
- Si Supabase emite metadata antigua, el operador se fuerza a pasar nuevamente por el PIN solo si la fila ya no es válida, nunca por el literal del JWT.

### F4 — retiro de compatibilidad

Después de verificar producción:

- Quitar ramas de UI para mostrar `Administración`.
- Quitar fixtures operativos `administracion` y reemplazarlos por `jefe`.
- Mantener referencias en migraciones históricas y auditoría exclusivamente.
- Actualizar README, guía de roles y bitácora.

## 3. Guardarraíles

### Guardarraíles estáticos

- `check:project` compara `ROLES_VALIDOS`, migración 245 y el espejo SQL de capacidades.
- Falla si `administracion` aparece en código operativo fuera de migraciones históricas, auditoría o pruebas de compatibilidad histórica.
- Falla si `roles_capacidad()` 245 contiene `administracion`.
- Falla si `usuarios_rol_check` nuevo permite `administracion`.
- Falla si el Worker registra una ruta secreta o una autorización por nombre de rol antiguo.

### Guardarraíles de datos

- Conteo de filas antes = filas después.
- Conteo por `cuenta_id` antes de convertir = conteo por `cuenta_id` después.
- IDs antes = IDs después.
- Nombres, estados y presencia de PIN antes = después.
- `COUNT(rol='administracion') = 0` después.
- Toda fila convertida tiene `rol='jefe'`.
- No se permite aplicar la migración si la consulta de backup/inventario no fue registrada.

### Guardarraíles de autorización

- `jefe` puede acceder a todas las capacidades.
- `finanzas` sigue sin ver saldos ni nómina.
- `nomina` sigue sin ver Finanzas.
- Un rol antiguo no operativo sigue recibiendo 403.
- El operador convertido conserva el mismo PIN y entra con el mismo `operator_id`.

## 4. Rollback

Antes del commit SQL, `ROLLBACK` cancela toda la migración. Después de commit, el rollback lógico solo debe ejecutarse con el inventario de IDs guardado:

```sql
UPDATE public.usuarios
SET rol = 'administracion'
WHERE id = ANY(:ids_convertidos);
```

Ese rollback requiere restaurar también temporalmente el `CHECK` y `roles_capacidad()`. No se debe ejecutar un rollback masivo por nombre, cuenta o estado.

## 5. Tests deterministas

1. **Matriz JS:** `permissions.test.js` afirma que `jefe` es el único rol administrativo y que `administracion` no está en ningún conjunto operativo.
2. **Contrato SQL:** `sql-contract.test.js` valida la migración 245, la actualización del `CHECK`, el `UPDATE` acotado y la ausencia de `administracion` en `roles_capacidad()`.
3. **Preflight DB:** `scripts/test-db.mjs` valida conteos, aislamiento por tenant, duplicados y preservación de IDs/PINs con Postgres embebido.
4. **Login:** un operador convertido usa el mismo PIN, el mismo ID y recibe rol `jefe`.
5. **Gestión:** `jefe` puede listar/crear/renombrar/cambiar PIN/rol/estado; Finanzas y Nómina reciben 403.
6. **Frontend:** el picker y UsuariosPanel muestran `Jefe`, nunca `Administración`; no existe opción para crear el rol retirado.
7. **Paridad SQL/JS:** todas las capacidades y roles derivados coinciden exactamente.
8. **No regresión:** toda la suite completa, lint, build y `check:project` deben pasar.

## 6. Criterio de salida

La fase se considera terminada únicamente cuando:

- La migración 245 está en el repositorio y pasa el contrato SQL.
- No queda `administracion` en la matriz operativa actual.
- El preflight y la migración son idempotentes.
- Los tests deterministas prueban conversión, preservación, acceso y rechazo.
- La aplicación compila y arranca.
- La aplicación remota **no se toca automáticamente**: aplicar la migración en Supabase es un paso operativo separado, posterior a revisar el inventario y aprobarlo explícitamente.
