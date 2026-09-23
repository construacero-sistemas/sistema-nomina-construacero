# Manifiesto de release — roles, PIN y convergencia a Jefe

**Estado:** propuesta de corte; NO es una rama, commit, paquete desplegable ni migración aplicada.<br>
**Fecha de inventario:** 22/09/2026<br>
**Destino remoto:** ninguno aprobado. No crear staging ni tocar Supabase/Vercel.<br>
**Checkout:** `main`, compartido y con modificaciones concurrentes/anteriores sin separar.

## Decisión de seguridad

No es seguro producir hoy un release bundle con `git add`, `stash`, `checkout`, `reset`, `worktree` o copias selectivas: el árbol tiene **58 archivos rastreados modificados** y **29 grupos de archivos no rastreados**, varios de ellos pertenecen a cambios pedidos previamente pero están mezclados con los cambios de roles/PIN. No está claro qué modificaciones son de esta tarea y cuáles pertenecen a otras iteraciones/personas.

Por eso este manifiesto identifica el contenido candidato y las fronteras reales, pero **no altera ni stagea el checkout**. Los archivos listados como “hunk mixto” requieren extracción/revisión manual con su autor antes de incorporarse a una rama de release.

## Objetivo mínimo de producto

- La matriz de capacidades tiene una fuente única y `jefe` es el rol administrativo operativo.
- La selección de operador siempre exige PIN validado en servidor.
- Finanzas y Nómina usan PIN de cuatro dígitos; Jefe usa seis.
- `administracion` se convierte a `jefe` conservando IDs y credenciales.
- Usuarios con rol restringido no reciben capacidades administrativas.
- El inicio/cambio de operador y el panel siguen funcionando.

No incluye rediseñar login, desplegar producción, crear usuarios en producción, ni modificar datos remotos.

## Candidatos por grupo

### A. Código de autorización y backend — incluir solo tras separar hunks

| Archivo | Motivo | Frontera |
|---|---|---|
| `server/lib/permissions.js` | Matriz, roles válidos, capacidades, PIN por rol y etiquetas | Casi entero corresponde; revisar si `ADMIN_ROLE` legacy debe conservarse temporalmente |
| `src/config/accesoModulos.js` (nuevo) | Reexporta la matriz al frontend | Archivo completo candidato |
| `compat/api/lib/auth.js` | Rechaza operador de cabecera y resuelve rol desde sesión/DB | **Hunk mixto:** cambio de autorización junto con modificación de TTL/cachés; separar esas decisiones |
| `server/handlers/auth-operators.js` | PIN PBKDF2, operador disponible, selección/cambio, perfil y longitudes por rol | **Hunk mixto:** API/Auth incluye refactor de listado y retiro de ruta sin PIN; retener solo el comportamiento aprobado y verificar contrato |
| `worker.js` | Rutas nuevas de gestión y eliminación de ruta sin PIN | **Hunk mixto:** separar routes de operador/roles de routes de nuevos endpoints de gestión |
| `server/handlers/nomina.shared.js` | Capacidades de roles en handlers | Revisar cada hunk; algunos son del portón de Nómina, no solo PIN |
| handlers de finanzas/nomina listados abajo | Alineación de capacidades | Ver sección “exclusiones/dependencias SQL”; no incluir todos automáticamente |

### B. UI de login/PIN/selector — depende de decisión de producto

| Archivo | Motivo | Frontera |
|---|---|---|
| `compat/modules/auth/OperatorPicker.jsx` (nuevo) | Picker y flujo al modal PIN | Archivo nuevo, pero contiene presentación visual estilo 3D/Netflix pedida en una iteración previa; separar funcionalidad de rediseño si la release debe ser mínima |
| `compat/components/auth/LoginPinModal.jsx` | PIN de largo por rol y UX | **Hunk mixto grande:** reescritura completa Dark Premium, watchdog, mensajes y captura; no es un cambio mínimo de longitud PIN |
| `compat/modules/auth/LoginPage.jsx` | Integra picker, login y bootstrap primer usuario | **Hunk mixto:** agrega pantalla de bootstrap y cambios visuales de login además de selección PIN |
| `compat/store/useAuthStore.js` | Estado de sesión, PIN, cambio de operador, bootstrap | **Hunk mixto crítico:** añade state machine, secuenciación/cancelación de requests, cambio de operador y bootstrap; requiere revisión específica antes de incluir |
| `compat/modules/auth/UserCard.jsx`, `compat/components/auth/LoginAvatar.jsx` | Mostrar roles/colores | Mezcla presentación y semántica de rol; paleta/3D no es requisito técnico de migración |
| `compat/components/auth/PinInput.jsx`, `DarkBackground.jsx`, `compat/components/ui/3d-card.jsx` | Componentes nuevos usados por login/PIN | `PinInput` puede ser funcional; `DarkBackground` y 3D son UI opcional. Dividir o declarar explícitamente el alcance visual |
| `compat/styles/login.css`, `animations.css` | Estilo picker/login | Hunk de presentación separado de autorización; no incluir si se limita release a funcionalidad |
| `compat/hooks/useClientes.js` | Lista de operadores | Cambio pequeño, pero validar si esa ruta sigue activa frente al endpoint del Worker |

### C. Gestión de usuarios/bootstrap — funcionalidad previa, no necesaria para convertir el rol

Archivos candidatos ajenos al corte mínimo de conversión, aunque útiles para administrar cuentas:

- `server/handlers/gestionar-operadores.js` (nuevo, CRUD, bootstrap y renombrar).
- `src/hooks/useGestionOperadores.js` (nuevo).
- `src/components/sistema/UsuariosPanel.jsx` y sus pruebas (nuevos).
- Rutas de `/api/gestion/operadores/*` en `worker.js`.
- `compat/components/auth/PinInput.jsx` y parte de `LoginPage.jsx` por bootstrap.

**Recomendación:** separarlos como release propia de “gestión de usuarios” salvo que el equipo confirme que crear/restablecer usuarios es requisito del mismo corte de PIN. Mantener bootstrap separado por ser una ruta privilegiada autorizada solo por identidad de cuenta.

### D. Migraciones SQL — no se deben seleccionar por número sin comprobar el historial

| Migración | Propósito | Decisión |
|---|---|---|
| `241_nomina_pago_tasa_congelada.sql` | Snapshot/procedencia de tasa en una RPC financiera | No es por sí misma parte de convertir roles, pero 244 reemplaza una función derivada de esa cadena; verificar el estado remoto antes de excluirla |
| `242_roles_operativos_nomina_finanzas.sql` | Amplía CHECK y retira el trigger histórico | Dependencia del modelo de roles múltiples |
| `243_roles_operativos_autorizacion.sql` | Espejo SQL de capacidades, RLS, perfil y login | Dependencia obligatoria para autorización SQL |
| `244_roles_operativos_operaciones.sql` | Reemplaza funciones financieras con guardián por capacidad | **No es una migración pequeña de permisos:** incluye cuerpos completos de RPC financiera; alto riesgo de llevar cambios ajenos o sobrescribir definición remota divergente |
| `245_converge_administracion_to_jefe.sql` | UPDATE de datos, CHECK final y espejo sin `administracion` | No aplicar hasta probar 242–244, inventario por cuenta y backup restaurado |

**No está autorizado aplicar 241–245 en ningún Supabase con este manifiesto.** El orden y el historial remoto deben reconciliarse primero. Los antecedentes documentales indican que el proyecto remoto ya tuvo historial fuera de banda; el estado actual no fue consultado en esta tarea.

#### Dependencia no resuelta de la 244

La 244 redefine `finanzas_operar` completo (función extensa) para cambiar el guardián del actor. Antes de aislarla hay que comparar su cuerpo con la función actualmente aplicada y revisar dependencias en 238–241. Si el cuerpo remoto ya diverge, el `CREATE OR REPLACE` puede sustituir comportamiento financiero legítimo. El test PGlite desde migraciones del repo no demuestra esa paridad remota.

### E. Guardarraíles y pruebas — candidatos relevantes

- `scripts/check-project.mjs`: **hunk grande (163 líneas insertadas)** que agrega verificación de matriz, PIN y contratos, pero también reglas de proyecto/F2 más amplias. Separar las reglas asociadas a la release de las de autenticación/UI no incluidas.
- `scripts/test-db.mjs`: matriz SQL por capacidad × rol; útil, pero ejecuta historia de migraciones del repo, no conexión remota.
- `server/lib/__tests__/permissions.test.js` (nuevo).
- `server/lib/__tests__/sql-contract.test.js` (modificado).
- `server/handlers/__tests__/auth-operators.test.js` (modificado).
- `compat/store/__tests__/seleccion-operador.test.jsx` (nuevo).
- `compat/modules/auth/__tests__/OperatorPicker.test.jsx` y `LoginPinModal.test.jsx` (nuevos).
- Tests de gestión (`bootstrap-operador.test.js`, `gestionar-operadores.test.js`, `UsuariosPanel.test.jsx`) pertenecen al grupo C y no deben colarse en el release mínimo salvo decisión explícita.
- Fixtures restantes de handlers se actualizaron a jefe; deben revisarse para confirmar que representan el estado nuevo y no borrar cobertura de compatibilidad histórica.

### F. Documentación

- Incluir solo la entrada vigente de release en bitácora tras aprobar el alcance.
- `docs/ROADMAP_RELEASE_FASES.md` es un plan de salida, no evidencia de ejecución.
- Excluir inicialmente `docs/ROADMAP_PENDIENTES_FASES.md`, `docs/PLAN_FIX_USUARIOS_PIN.md`, `docs/PLAN_ELIMINAR_ADMINISTRACION.md`, guía y humo E2E si sus estados históricos no se actualizan en el mismo corte.
- **Excluir:** `scripts/transcribir_audio.py` (sin relación identificada; dueño/propósito desconocido).

## Fuera del release de roles/PIN

Estos cambios aparecen en el checkout y deben ir en otra entrega, salvo decisión informada:

- UI de `src/components/finanzas/ResumenPeriodoKpis.jsx` y su test.
- Nómina: `LiquidacionModal.jsx`, `MarcajeLogisticaPanel.jsx`, `PeriodoDetalleModal.jsx`, PDFs y pruebas de tasa.
- Finanzas: hooks y handlers que cambian otras reglas/operaciones, especialmente `server/lib/financialOperations.js`, `server/handlers/finanzas*`, `cuentasCustodia.js`.
- `supabase/migrations/232_finanzas_resumen_multimoneda.sql`.
- `src/components/layout/MobileDrawerContent.jsx` (excepto el hunk preciso de cambiar operador, que debe separarse si entra).
- Cambios de estilo 3D/Netflix si el alcance del release se reduce a rol/PIN funcional.
- `scripts/transcribir_audio.py`.

## Bloqueos para convertir este manifiesto en una release ejecutable

1. **Identidad/propiedad de hunks:** no está claro qué cambios del checkout son de esta entrega. No moverlos ni separarlos destructivamente sin revisión del dueño.
2. **Dependencia de frontend:** `src/NominaApp.jsx` mezcla cambio de operador con gran refactor de shell/drawer. Extraer el hunk correcto y verificar rutas/candados.
3. **Dependencia de RPC:** migración 244 redefine función financiera completa; requiere diff contra definición real o rediseño para reducir el cambio.
4. **Orden de publicación:** el backend nuevo y los usuarios `administracion` antiguos pueden quedar incompatibles según se publique código o SQL primero. Definir deploy compatible o ventana de corte.
5. **Entorno real:** no hay staging Supabase/Vercel aprobado; producción no se usará como banco de pruebas.
6. **Contrato Auth:** falta prueba de que el PUT de `app_metadata` preserve claves de metadatos no relacionadas y que un token/JWT nuevo llegue a RLS tras cambiar operador.
7. **PIN histórico:** usuarios finanzas/nómina con PIN previo de seis dígitos requieren decisión de migración/reset; no hay que convertir hashes de forma irreversible.

## Gates para la release candidata

### Local

1. Definir una lista de archivos/hunks aprobada por el dueño de los cambios.
2. Ejecutar todo sobre ese snapshot: `npm run verify`.
3. Revisar funciones SQL completas de 244 y contratos de grants/RLS.
4. Probar login, error PIN, reintento, cambio de operador, logout y bootstrap (si se incluye).
5. `git diff --check`; comprobar todos los archivos no rastreados y ausencia de secretos.

### Remoto — pendiente de staging

No se ejecutará hasta que exista un proyecto de prueba separado y su destino esté confirmado:

- restaurar un backup de staging o cargar fixtures sintéticos;
- aplicar la secuencia de migraciones aprobada en ese entorno;
- comprobar IDs, presencia de PIN, roles y auditoría antes/después;
- ejecutar Auth → `app_metadata` → token/JWT → RLS;
- probar los tres roles y los 403 esperados;
- probar Vercel Preview conectado exclusivamente al proyecto de staging.

## Continuación local — 22/09/2026

El primer `npm run verify` expuso 20 fallos del harness determinista de Nómina: las fixtures de `scripts/test-nomina-deterministic.mjs` y `scripts/test-finanzas-deterministic.mjs` autenticaban como `administracion`, rol retirado de la matriz operativa. Se alinearon las seis etiquetas de fixture a `jefe`; no se debilitó autorización.

Después se ejecutó de nuevo la cadena completa sobre el mismo checkout:

- `check:project`: PASS (39 migraciones, 338 archivos)
- `test:qa`: 22/22
- `test:responsive`: 34/34
- lint: PASS
- deterministas: Nómina 27/27; Finanzas 127/127
- Vitest: 90 suites, 999 aprobadas, 1 `todo` preexistente
- `test:db`: 32 comprobaciones, 80 superficies, 0 privilegios extra, 0 brechas
- build: PASS
- bundle: PASS (202,2 KiB gzip JS inicial; 218,4 KiB con CSS)

Este resultado solo certifica el snapshot local. No ejercita Supabase Auth real, JWT/RLS remotos, Vercel Preview ni PostgreSQL multiconexión.

## Estado/resultado de esta pasada

- Se inspeccionó el checkout y se identificaron archivos rastreados, no rastreados, agrupación funcional y dependencias SQL.
- Este manifiesto registra una propuesta de corte para evitar mezclar cambios de UI, Finanzas, Nómina y scripts sin relación.
- Solo se editaron las fixtures de los dos scripts deterministas para representar al nuevo rol administrativo `jefe`; no se stageó, movió ni descartó ningún cambio.
- No se creó staging; no se accedió a Supabase/Vercel ni se aplicó ninguna migración.

**Conclusión al redactar el manifiesto:** el gate local estaba verde, pero todavía no existía una release aislada. La 245 no estaba aplicada.

## Actualización posterior — autorización de commit local

El usuario autorizó explícitamente incluir todos los cambios presentes en el checkout en un único commit local. Se ejecutó `npm run verify` sobre el snapshot final de código: guardarraíles, responsive, lint, deterministas, 96 suites Vitest (1.020 aprobadas y 1 `todo`), PGlite (32 comprobaciones, 80 superficies) y build/bundle en verde. La verificación visual local también confirmó que Finanzas no muestra la pestaña Tesorería ni los KPIs/saldos, mientras Jefe conserva ambas superficies.

Esta autorización no convierte el conjunto en una release desplegable: la migración 245 sigue sin aplicar y permanecen pendientes staging, backup restaurable, paridad con Supabase remoto, smoke real de los tres roles y Vercel Preview. El commit es local únicamente; no implica push ni deploy.
