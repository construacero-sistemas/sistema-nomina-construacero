# Roadmap de salida por fases — roles, PIN y despliegue seguro

**Proyecto:** Nómina y Finanzas Construacero Carabobo<br>
**Corte:** 22/09/2026<br>
**Objetivo:** llevar el cambio `administracion → jefe`, la matriz de capacidades y la barrera PIN desde el estado local validado hasta una publicación controlada, sin perder datos ni dejar cuentas bloqueadas.

> Este documento sustituye la ambigüedad entre “código local listo” y “producción lista”. Una fase solo se considera cerrada cuando cumple sus criterios de salida y existe evidencia registrable en `docs/BITACORA_PROYECTO.md`.

---

## 0. Estado real al inicio

### Implementado localmente

- `server/lib/permissions.js` contiene la matriz única de capacidades.
- `src/config/accesoModulos.js` reexporta la matriz para el frontend.
- Las migraciones locales `242`, `243`, `244` y `245` existen.
- `245_converge_administracion_to_jefe.sql` convierte filas conservando identidad y credenciales, aborta ante exceso de jefes activos y registra auditoría.
- El Worker exige PIN para seleccionar operador; se eliminó la ruta sin PIN.
- Finanzas y Nómina derivan sus compuertas de capacidades.
- El panel de usuarios oculta `administracion` como opción vigente.
- Finanzas y Nómina usan PIN de 4 dígitos; `jefe` usa 6.
- Existe bootstrap para crear el primer `jefe` cuando una cuenta no tiene operadores activos.

### Evidencia local disponible

- Suite completa: 90 suites, 999 pruebas aprobadas y 1 `todo` preexistente.
- `npm run test:db`: 32 comprobaciones, 80 superficies capacidad × rol, 0 privilegios extra y 0 brechas reportadas.
- `npm run check:project`: OK.
- `npm run lint`: OK.
- `npm run build`: OK.

### Lo que todavía NO está certificado

- Backup restaurable de producción para este cambio.
- Inventario remoto actualizado de usuarios `administracion` y `jefe`.
- Paridad remota definitiva de migraciones, funciones, RLS y triggers.
- Aplicación remota de la migración 245.
- JWT/App Metadata/RLS reales después de seleccionar y cambiar operador.
- Preview de Vercel con el bundle actual.
- Smoke E2E real por `jefe`, `finanzas` y `nomina`.
- Safari/iPhone/PWA, concurrencia PostgreSQL y rollback ensayado.

**Estado global:** `NO-GO` para merge amplio y `NO-GO` para producción hasta cerrar R0–R6.

---

## Mapa de fases

| Fase | Nombre | Estado actual | Resultado |
|---|---|---|---|
| **R0** | Congelación, alcance y separación del cambio | 🔴 Bloqueante | Diff revisable y sin trabajo ajeno mezclado |
| **R1** | Cierre local de roles, PIN y contratos | 🟡 Implementado; falta certificar snapshot final | Código y pruebas locales reproducibles |
| **R2** | Preflight remoto, backup y staging | 🔴 No iniciada | Inventario y restauración comprobados |
| **R3** | Aplicación SQL y convergencia de datos | 🔴 No iniciada | 242→243→244→245 aplicadas y verificadas |
| **R4** | Compatibilidad de sesión y humo por rol | 🔴 No iniciada en entorno real | JWT, PIN, RLS y capacidades comprobados |
| **R5** | Preview/runtime de Vercel | 🔴 No iniciada | Frontend/API reales equivalentes al local |
| **R6** | QA físico, accesibilidad y concurrencia | 🔴 No iniciada | Aceptación humana y comportamiento bajo carga/concurrencia |
| **R7** | Rollout productivo controlado | ⛔ Bloqueada por R0–R6 | Publicación gradual con observabilidad |
| **R8** | Observación, rollback y retiro de compatibilidad | ⏳ Posterior al rollout | Estabilidad confirmada y deuda histórica reducida |
| **B1–B3** | Tasas, Personal y conciliación contable | ⏳ Negocio externo | Funcionalidad de negocio aprobada antes de habilitarla |

---

# R0 — Congelación, alcance y separación del cambio

**Prioridad:** P0<br>
**Objetivo:** evitar fusionar un checkout con cambios de varias fases sin revisión.

## Trabajo

1. Crear una rama exclusiva para esta entrega.
2. Separar el cambio en grupos revisables:
   - matriz/permisos y guardarraíles;
   - migraciones SQL 242–245;
   - autenticación/PIN/sesión;
   - panel de usuarios/bootstrap;
   - pruebas y documentación.
3. Revisar también los archivos no rastreados: `git diff` no los muestra.
4. Excluir del merge archivos no relacionados, prototipos, scripts personales y cambios de UI ajenos.
5. Confirmar que el POS de referencia y su Supabase no forman parte del alcance.
6. Registrar el commit base, el commit candidato y la lista exacta de archivos de la release.

## Arneses y guardarraíles

- `git status --short` y `git diff --check`.
- Revisión de diff por grupo, no solo de la estadística global.
- `npm run check:project` sobre el snapshot candidato.
- Revisión de secretos en `.env`, `.dev.vars`, Vercel y archivos nuevos.

## Criterio de salida

- No hay archivos ajenos al objetivo en el conjunto de merge.
- Cada archivo nuevo tiene propietario, propósito y prueba.
- La lista de migraciones que se aplicará está cerrada.
- Se puede explicar cómo revertir cada grupo.

**Bloqueador de salida:** si el cambio sigue mezclado con 50+ archivos de fases distintas, no hacer merge.

---

# R1 — Cierre local de roles, PIN y contratos

**Prioridad:** P0<br>
**Objetivo:** congelar el comportamiento local antes de tocar Supabase o Vercel.

## Trabajo

1. Confirmar que `jefe` es el único rol administrativo vigente.
2. Mantener `administracion` únicamente en migraciones históricas, auditoría y contratos de evolución.
3. Confirmar que ningún frontend o handler autoriza por listas duplicadas.
4. Confirmar que la matriz JS y el espejo SQL de 245 coinciden.
5. Confirmar que toda sesión nueva exige PIN, incluso con un único operador.
6. Confirmar que `finanzas` y `nomina` usan cuatro dígitos y `jefe` seis.
7. Confirmar que el bootstrap solo crea `jefe` y no permite recuperar una cuenta con un rol sin capacidad de gestión.

## Arneses

- `server/lib/__tests__/permissions.test.js`.
- `server/lib/__tests__/sql-contract.test.js`.
- `server/handlers/__tests__/auth-operators.test.js`.
- `server/handlers/__tests__/bootstrap-operador.test.js`.
- `server/handlers/__tests__/gestionar-operadores.test.js`.
- `compat/store/__tests__/seleccion-operador.test.jsx`.
- `compat/modules/auth/__tests__/OperatorPicker.test.jsx`.
- `compat/components/auth/__tests__/LoginPinModal.test.jsx`.
- `scripts/test-db.mjs`.

## Guardarraíles

- `npm run check:project` debe rechazar roles literales fuera de la matriz.
- Debe fallar si reaparecen `LOGIN_SIN_PIN`, `handleSelectOperator` o `/api/auth/select-operator`.
- Debe fallar si el frontend valida `pin_hash`/`pin_salt`.
- Debe fallar si el espejo SQL se separa de `rolesConCapacidad()`.

## Criterio de salida

```text
npm run check:project
npm run test:qa
npm run test:responsive
npm run lint
npm run test:deterministic
npm test
npm run test:db
npm run build
npm run test:bundle-size
```

Todo debe pasar en el mismo snapshot que se pretende fusionar. No se debe confundir con ejecuciones parciales de comandos anteriores.

---

# R2 — Preflight remoto, backup y staging

**Prioridad:** P0<br>
**Objetivo:** conocer la base real y poder restaurarla antes de aplicar cualquier SQL.

**Regla:** esta fase es solo lectura hasta que el informe sea aprobado.

## Inventario remoto

Consultar y guardar de forma segura:

- historial de `supabase_migrations.schema_migrations`;
- cantidad de usuarios por `cuenta_id`, rol y estado;
- IDs, nombres, colores, estados y presencia de PIN de las filas `administracion`/`jefe`;
- conflictos del límite de dos jefes activos;
- operadores activos cuyo `operator_id` aparezca en sesiones/metadatos;
- constraints, triggers y políticas actuales;
- definiciones de `roles_capacidad`, `roles_operativos`, `get_rol_actual`, `listar_usuarios_login`, `finanzas_operar` y `finanzas_asignar_custodia`.

No guardar ni publicar `pin_hash` ni `pin_salt` en informes.

## Consultas de preflight mínimas

```sql
SELECT cuenta_id, rol, activo, count(*) AS total
FROM public.usuarios
GROUP BY cuenta_id, rol, activo
ORDER BY cuenta_id, rol, activo;

SELECT cuenta_id,
  count(*) FILTER (WHERE activo AND rol = 'administracion') AS administracion_activos,
  count(*) FILTER (WHERE activo AND rol = 'jefe') AS jefe_activos
FROM public.usuarios
GROUP BY cuenta_id
HAVING count(*) FILTER (WHERE activo AND rol IN ('administracion', 'jefe')) > 2;

SELECT id, cuenta_id, nombre, rol, activo, color,
       (pin_hash IS NOT NULL AND pin_salt IS NOT NULL) AS tiene_pin
FROM public.usuarios
WHERE rol IN ('administracion', 'jefe')
ORDER BY cuenta_id, nombre;
```

## Backup y restauración

1. Crear backup lógico completo.
2. Crear copia específica de `usuarios` y `auditoria`.
3. Crear checksum y guardar ambas copias fuera del repositorio.
4. Restaurar el backup en una base temporal.
5. Verificar que el backup se puede consultar.
6. No continuar si la restauración no es reproducible.

## Guardarraíles

- No usar `--force` ni reparar el historial de migraciones sin comparar el esquema real.
- No aplicar 245 sola.
- No modificar filas si el inventario no fue guardado y revisado.
- No proceder si el proyecto Supabase es compartido con el POS o con otro consumidor que dependa de `administracion`.

## Criterio de salida

Existe un informe aprobado con:

- historial remoto reconciliado;
- cero conflictos no decididos;
- backup restaurable;
- esquema de staging confirmado;
- ventana de mantenimiento y responsables definidos.

---

# R3 — Aplicación SQL y convergencia de datos

**Prioridad:** P0<br>
**Objetivo:** aplicar la autorización final y convertir los datos sin recrear usuarios.

## Orden obligatorio

```text
242_roles_operativos_nomina_finanzas.sql
243_roles_operativos_autorizacion.sql
244_roles_operativos_operaciones.sql
245_converge_administracion_to_jefe.sql
```

Si alguno de los efectos ya existe en remoto, se debe probar equivalencia por definición y migraciones antes de omitirlo. No se debe confiar solo en el número de versión.

## Propiedades que deben conservarse

Para cada usuario convertido:

- mismo `id`;
- mismo `cuenta_id`;
- mismo `nombre`;
- mismo `pin_hash` y `pin_salt`;
- mismo `color`;
- mismo `activo`;
- mismas comisiones, fechas y relaciones;
- nuevo `rol = 'jefe'`;
- auditoría `ROL_CONVERGENCIA_ADMINISTRACION_A_JEFE`.

## Guardarraíles antes y después

Antes:

- conteo por cuenta y rol;
- lista de IDs a convertir;
- conteo de jefes activos combinado;
- existencia de constraints/triggers esperados.

Después:

```sql
SELECT count(*) FROM public.usuarios WHERE rol = 'administracion';
-- Debe ser 0.

SELECT rol, count(*)
FROM public.usuarios
GROUP BY rol
ORDER BY rol;

SELECT count(*)
FROM public.auditoria
WHERE accion = 'ROL_CONVERGENCIA_ADMINISTRACION_A_JEFE';
```

Además, repetir las consultas de funciones, RLS y grants del preflight.

## Rollback

- Antes del commit SQL: `ROLLBACK`.
- Después del commit: usar exclusivamente la lista de IDs del inventario y restaurar constraints/funciones en una ventana controlada.
- Si hay incertidumbre de esquema o datos: restaurar el backup completo, no ejecutar un `UPDATE` masivo por nombre o cuenta.
- Mantener disponible el deployment anterior hasta terminar R4.

## Criterio de salida

- 242–245 aplicadas en el orden acordado.
- `administracion = 0` en usuarios operativos.
- IDs, PINs, estados y relaciones coinciden antes/después.
- El espejo SQL coincide con la matriz JS.
- Las cuentas sin conflicto continúan teniendo al menos un `jefe` activo donde el negocio lo exige.

---

# R4 — Compatibilidad de sesión y humo real por rol

**Prioridad:** P0<br>
**Objetivo:** comprobar Supabase Auth, `app_metadata`, JWT, Worker y RLS reales, no solo mocks.

## Flujo de acceso

Para cada rol (`jefe`, `finanzas`, `nomina`):

1. login con correo y contraseña;
2. picker de operador;
3. PIN correcto;
4. `/api/auth/me` devuelve el mismo ID y rol esperado;
5. recarga de página;
6. cambiar de operador;
7. cerrar selección;
8. volver a elegir y validar PIN;
9. PIN incorrecto no cambia metadata ni entra;
10. usuario inactivo no puede entrar.

## Matriz mínima

| Caso | `jefe` | `finanzas` | `nomina` |
|---|---:|---:|---:|
| ver Nómina | ✅ | ❌ | ✅ |
| pagar/revertir Nómina | ✅ | ❌ | ✅ |
| ver/operar Finanzas | ✅ | ✅ | ❌ |
| ver saldos/custodia | ✅ | ❌ | ❌ |
| gestionar usuarios | ✅ | ❌ | ❌ |
| cambiar de operador | ✅ | ❌ | ❌ |

## Comprobaciones críticas

- `setOperatorMetadata()` no elimina otros campos de `app_metadata`.
- Un JWT emitido antes del cambio no concede acceso indebido.
- Tras cambiar operador, Postgres ve el operador correcto en `auth.jwt()`.
- `X-Operator-Id` discrepante produce 401 y nunca selecciona otro usuario.
- La antigua ruta `/api/auth/select-operator` no concede acceso.
- Los 403 de capacidades son esperados y no deben convertirse en 200 por compatibilidad.
- Una cuenta sin operadores activos puede crear el primer `jefe` desde la pantalla de error y luego debe pasar por PIN.

## Evidencia

Guardar para cada caso: hora, rol, endpoint, status, ID de operador, resultado y captura cuando corresponda. Nunca guardar PIN ni tokens.

## Criterio de salida

El plan de humo `docs/PLAN_HUMO_E2E_ROLES.md` está completo sin fallos de seguridad y con evidencia reproducible. Cualquier 200 inesperado en una protección es bloqueo inmediato.

---

# R5 — Preview y equivalencia del runtime Vercel

**Prioridad:** P1<br>
**Objetivo:** probar la ruta que realmente sirve producción: Vercel → `api/index.js` → `worker.js` → Supabase.

## Infraestructura

En un Preview aislado comprobar:

- `/api/ping` devuelve 200;
- ruta inexistente devuelve 404;
- 401 sin sesión;
- 403 por capacidad;
- `OPTIONS` y CORS solo para dominios autorizados;
- headers de seguridad presentes;
- `/api/auth/me`, `/api/auth/operators`, `switch-operator` y `clear-operator` funcionan;
- `/api/gestion/operadores/*` funciona;
- recarga directa de `/finanzas`, `/nomina` y `/sistema` funciona;
- variables apuntan al Supabase correcto y no al POS.

## PWA y caché

- `sw.js` se actualiza en una instalación existente.
- Una pestaña abierta durante el deploy no usa un bundle incompatible con la API.
- Una PWA instalada vuelve a pedir PIN conforme al contrato vigente.
- Las respuestas de auth y API llevan `no-store` donde corresponde.

## Guardarraíles

- Mantener el deployment anterior disponible.
- No retirar Wrangler/Worker durante esta fase.
- Añadir la evidencia de Preview a la bitácora.
- No usar la cuenta real para pruebas destructivas: usar tenant de staging.

## Criterio de salida

El smoke E2E corre sobre Preview, con variables de staging, y no se observan diferencias relevantes respecto a la ejecución local.

---

# R6 — QA físico, accesibilidad y concurrencia

**Prioridad:** P1<br>
**Objetivo:** cubrir lo que Vitest y PGlite no pueden certificar.

## Superficies

- Chrome escritorio 1366 px.
- Chrome Android.
- Safari iPhone físico.
- PWA instalada.
- Teclado completo.
- Lector de pantalla básico.
- Offline, timeout y reintento.
- Doble clic en PIN y mutaciones.
- Rotación de pantalla con modal abierto.
- Cambio de viewport con modal abierto.

## Concurrencia

Probar con PostgreSQL real y dos conexiones:

- dos cambios de operador simultáneos;
- dos creaciones con el mismo nombre;
- reactivación concurrente que excedería el cupo;
- dos aplicaciones de la misma idempotency key;
- migración mientras el panel intenta mutar un usuario.

## Criterio de salida

- No hay acceso cruzado entre tenants.
- No hay doble escritura de operaciones idempotentes.
- Los límites de usuarios activos se respetan bajo concurrencia.
- Modales y PIN son usables con teclado y lector de pantalla.
- No hay bloqueo ni recorte crítico en móvil.

---

# R7 — Rollout productivo controlado

**Prioridad:** P0<br>
**Objetivo:** publicar sin convertir un fallo de sesión o esquema en pérdida de acceso.

## Preparación

1. Congelar mutaciones de usuarios durante la ventana.
2. Confirmar backup y rollback.
3. Confirmar que `ENABLE_DEV_MASTER_PIN` es `false` o está ausente.
4. Confirmar que `DEV_MASTER_PIN_4` y `DEV_MASTER_PIN_6` no existen en producción.
5. Publicar primero a Preview y promover solo con R4/R5 verdes.
6. Mantener la versión anterior disponible.
7. Preparar responsables de decisión, canal de incidentes y hora de corte.

## Orden de corte

1. Snapshot final de datos e inventario.
2. Aplicar SQL aprobado.
3. Validar conteos y funciones.
4. Publicar backend/API.
5. Publicar frontend.
6. Invalidar/actualizar Service Worker según procedimiento.
7. Ejecutar smoke de `jefe`, `finanzas` y `nomina`.
8. Reabrir mutaciones.

## Abortadores inmediatos

- cualquier usuario convertido no puede entrar con su PIN anterior;
- aparece `SIN_OPERADORES` inesperado;
- un rol restringido recibe 200 o datos;
- un rol permitido recibe 403 inesperado;
- `app_metadata` pierde campos ajenos;
- diferencias de tenant;
- migración toma locks fuera de la ventana;
- error de Vercel/API superior al umbral acordado.

## Criterio de salida

- Smoke crítico en verde.
- Sin pérdida de identidad ni PINs.
- Sin brechas de autorización.
- Logs y métricas activos.
- Aprobación explícita del responsable del negocio.

---

# R8 — Observación, rollback y retiro de compatibilidad

**Prioridad:** P1<br>
**Objetivo:** estabilizar después del corte y retirar compatibilidad solo cuando haya evidencia.

## Observación 0–2 horas

Monitorizar:

- 401, 403, 409, 429 y 5xx por endpoint;
- `SIN_OPERADORES`;
- `OPERADOR_REQUERIDO`;
- fallos de `switch-operator`;
- errores RLS/PT403;
- fallos de Vercel y Supabase;
- tiempo de respuesta y locks;
- auditorías de login y convergencia.

## Observación 24–48 horas

- revisar cuentas que no hayan podido entrar;
- revisar intentos de PIN y rate limit;
- revisar egress y uso de Supabase;
- revisar operaciones financieras idempotentes;
- confirmar que el POS permanece intacto.

## Rollback

- API/frontend: volver al deployment anterior si la compatibilidad lo permite.
- Datos: restaurar backup si hay corrupción o divergencia, no hacer rollback improvisado por nombre.
- Roles: usar inventario de IDs convertido, constraints y funciones versionadas.
- Seguridad: si se detecta bypass, revocar sesiones/secretos y congelar mutaciones.

## Retiro posterior

Solo después de estabilidad demostrada:

- retirar compatibilidad de `administracion` del código operativo;
- actualizar guías que aún describan Administración como rol activo;
- mantener auditoría y migraciones históricas intactas;
- decidir si se retira el PIN maestro del código;
- simplificar el camino local Vercel y reducir dependencia de Wrangler según `docs/PLAN_MIGRACION_VERCEL_FUNCTIONS.md`.

---

# B1 — Tasas y reglas fiscales

**Dependencia:** negocio externo; no bloquear el rollout técnico si no se habilita Nómina fiscal.

- aprobar fuentes BCV/Euro/USDT, frecuencia, timeout y fallback;
- guardar snapshots con fuente, fecha, valor y aprobación;
- activar reglas legales por versión y vigencia;
- prohibir que una liquidación dependa de la tasa actual;
- probar tasas congeladas y reglas inactivas/aprobadas.

**Salida:** una liquidación reproducible con snapshot y regla legal aprobada.

# B2 — Sincronización Personal → Nómina

**Dependencia:** contrato con el POS.

- definir `id_externo`, nombre, documento, activo y tenant;
- sincronización unidireccional y reintentable;
- impedir escrituras inversas desde Nómina hacia Personal;
- probar altas, bajas, duplicados, reintentos y aislamiento de tenant.

**Salida:** Nómina refleja Personal sin duplicar ni mutar la fuente.

# B3 — Conciliación contable real

**Dependencia:** B1, B2 y aprobación de Contabilidad.

- ejecutar un período real anonimizado de punta a punta;
- conciliar bruto, neto, horas, bonos, retenciones, asientos y saldos;
- probar pago, reversión y reapertura controlada;
- verificar backup/restauración;
- mantener el flag de rollout apagado hasta la aprobación.

**Salida:** período conciliado y firmado por el responsable contable.

---

## Orden de ejecución

```text
R0  separar y congelar el cambio
 ↓
R1  cerrar localmente permisos, PIN y contratos
 ↓
R2  inventario remoto + backup restaurable + staging
 ↓
R3  aplicar 242 → 243 → 244 → 245
 ↓
R4  probar Auth/JWT/RLS y humo por rol
 ↓
R5  validar Preview Vercel y PWA
 ↓
R6  QA físico + accesibilidad + concurrencia
 ↓
R7  rollout productivo controlado
 ↓
R8  observación, rollback preparado y retiro gradual

B1/B2 → se pueden ejecutar en paralelo cuando el negocio entregue contratos
B3     → requiere B1 + B2 + aprobación contable
```

## Definición de listo para merge

- R0 cerrado.
- R1 ejecutado sobre el snapshot exacto del merge.
- No quedan secretos ni archivos ajenos.
- Las migraciones tienen contrato, orden y rollback revisados.
- `npm run verify` completo en verde o cualquier excepción está documentada y aprobada.

## Definición de listo para producción

- R0–R6 cerrados.
- Backup restaurable y staging probado.
- Preflight remoto aprobado.
- `administracion = 0` en usuarios operativos después de la convergencia.
- Login/PIN/RLS verificados con Supabase real.
- Preview Vercel y PWA verificados.
- Rollback y responsables preparados.
- Aprobación explícita del negocio.

## Regla de seguridad final

No aplicar migraciones remotas, no usar `--force`, no reparar historial de Supabase y no desplegar a producción mientras exista una cuenta cuyo resultado de conversión, acceso con PIN, propietario del proyecto o backup restaurable sea desconocido.
