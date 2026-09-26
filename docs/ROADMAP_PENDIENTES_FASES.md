# Roadmap de pendientes por fases — Nómina y Finanzas Construacero Carabobo

**Corte:** 2026-09-21
**Alcance:** todo lo que falta para pasar de "esquema y código listos" a "operación real verificada", ordenado por fases con sus entregables, guardarraíles y pruebas deterministas.
**Regla de avance:** ninguna fase se cierra sin (1) sus tests deterministas en verde dentro de `npm run verify`, (2) sus guardarraíles activos y (3) la entrada correspondiente en `docs/BITACORA_PROYECTO.md`.

> Contexto: el código de interfaz y el servidor ya declaran el modelo de roles múltiples
> (`server/lib/permissions.js`, `src/config/accesoModulos.js`, migración `242`), pero la
> base de datos y varias compuertas antiguas de la interfaz todavía exigen
> `administracion`. Ese desajuste es el primer bloqueo real.

## Mapa de fases

| Fase | Resultado | Estado | Tipo |
|---|---|---|---|
| **F0** | Paridad de roles fin a fin (SQL + sesión + UI) | ✅ Cerrada | Código |
| **F1** | Guardarraíl de paridad y pruebas deterministas por rol | ✅ Cerrada | Código |
| **F2** | Barrera de acceso (PIN o alternativa aprobada) | ✅ Cerrada | Seguridad |
| **F3** | Tasas BCV/Euro/USDT y reglas fiscales | ⏳ Externo | Negocio |
| **F4** | Sincronización Personal → Nómina | ⏳ Externo | Integración |
| **F5** | Conciliación contable con datos reales | ⏳ Externo | Negocio |
| **F6** | Aceptación física, accesibilidad y concurrencia | ⏳ Pendiente | QA |
| **F7** | Publicación, secretos y presupuesto de egress | ⏳ Pendiente | Deploy |
| **F8** | Robustez de datos y deuda técnica | ⏳ Pendiente | Mantenimiento |

---

## F0 — Paridad de roles fin a fin  ⛔ Bloqueante

**Objetivo:** que `jefe`, `finanzas` y `nomina` funcionen de verdad, con la misma autorización en interfaz, servidor y base de datos. Hoy la migración `242` solo amplió el `CHECK`; el resto del SQL sigue exigiendo `administracion`.

**✅ Cerrada el 2026-09-21.** Las tres piezas están en su sitio, **y el mismo día se aplicaron al Supabase enlazado** (`wlxcclidnwketrghqaxs`) las migraciones 231–244 con respaldo previo (`backups/pre-migracion-243-*`) y paridad verificada contra la base real: el espejo `roles_capacidad()` coincide capacidad por capacidad con la matriz JS, los guardianes de actor consultan el espejo y el `CHECK` ampliado reemplazó al de rol único. Detalle completo en la bitácora.

- **A — SQL.** `243_roles_operativos_autorizacion.sql` crea el espejo SQL de la matriz
  (`roles_capacidad` / `roles_operativos`), reescribe `get_rol_actual()` para devolver el rol real
  y `listar_usuarios_login()` para listar todos los perfiles operativos, y expresa las RLS de
  nómina, finanzas, custodia y purga por capacidad. `244_roles_operativos_operaciones.sql` alinea
  los guardianes de actor de `finanzas_operar` (por tipo: `operarFinanzas` en traspasos,
  `administrarNomina` en pagos) y `finanzas_asignar_custodia`. Medición tras aplicarlas:
  **0 privilegios de más y 0 brechas**, con los 90 puntos de la matriz reflejados.
- **B — Sesión e interfaz.** Todas las compuertas derivan de `server/lib/permissions.js`;
  `src/config/accesoModulos.js` la reexporta.
- **C — Guardarraíles.** `check-project.mjs` falla ante un rol literal fuera de la matriz, ante un
  espejo SQL que no coincida con `rolesConCapacidad()` y ante un `CHECK` de roles (242) distinto
  de `ROLES_VALIDOS`; `test:db` mide las 90 superficies y `npm run sql-contract` fija el contrato
  de las migraciones nuevas.

### Entregables

**A. Migración `243_roles_operativos_autorizacion.sql`**
- `public.get_rol_actual()` (hoy en `222`) debe devolver el **rol real** del operador activo de la cuenta, no `'administracion'` o `NULL`. Sin esto, todas las RLS con `get_rol_actual() IN (...)` niegan a los roles nuevos (incluido `jefe`, que ya figura en varias políticas pero nunca coincide).
- `public.listar_usuarios_login()` (hoy en `222`) filtra `u.rol = 'administracion'`; debe listar los operadores activos de la cuenta para permitir la selección de usuario de `jefe/finanzas/nomina`.
- Ensanchar las RLS que hoy son `= 'administracion'`:
  - `221_finanzas_movimientos.sql:65,75` → roles con `verFinanzas`/`operarFinanzas` (`jefe`, `administracion`, `desarrollador`, `finanzas`).
  - `228_cuentas_custodia.sql:45` → roles con `verSaldos` (`jefe`, `administracion`, `desarrollador`).
- Ensanchar los guardias de actor de los RPC:
  - `finanzas_operar` (redefinido en `241:70`) → aceptar roles con `operarFinanzas`.
  - `finanzas_asignar_custodia` (`240:8`) → aceptar roles con `operarFinanzas`/`verSaldos` según la matriz.
- Añadir `nomina` a las políticas de nómina donde la matriz da `administrarNomina` (`212`, `215`, `216`, `217`, `218`, `227`) y revisar los `= 'logistica'` para no dejar accesos residuales.

**B. Compuertas de sesión e interfaz (deben derivar de la matriz, no de un rol fijo)**
- `compat/store/useAuthStore.js:177` → hoy rechaza todo perfil con `rol !== 'administracion'`; es **el bloqueo de login** de los roles nuevos. Debe aceptar perfiles con módulo asignado (`accesoUI`), manteniendo la verificación de cuenta/activo.
- `src/hooks/useNomina.js:19-21` (`ADMIN_ROLE`, `ROLES_VER`, `ROLES_ADMIN`) → derivar de `verNomina`/`administrarNomina`.
- `src/hooks/useFinanzas.js:11-14` → derivar de `verFinanzas`.
- `src/hooks/useCuentasCustodia.js:23` → derivar de `verSaldos`/`operarFinanzas`.
- `src/views/NominaView.jsx:22` y `src/components/nomina/MarcajeLogisticaPanel.jsx:19` (`esAdmin`) → usar `accesoUI(rol).nomina`.
- `compat/hooks/useClientes.js:269` → la lista de operadores de login no debe filtrar solo `administracion`.
- `compat/components/auth/LoginPinModal.jsx:99` → estilos por rol deben reconocer `jefe/finanzas/nomina`.

**C. Guardarraíles a actualizar en el mismo cambio**
- `scripts/check-project.mjs` **hoy obliga** a los marcadores del modelo viejo (`useNomina.js` con `const ADMIN_ROLE = 'administracion'`, `NominaView`/`MarcajeLogisticaPanel` con `perfil?.rol === 'administracion'`, y prohíbe que `useNomina.js` mencione `'jefe'`/`'desarrollador'`). Hay que reemplazarlos por aserciones del modelo de capacidades.
- Añadir `243_roles_operativos_autorizacion.sql` a `expectedMigrations`.
- Nuevo guardarraíl: prohibir `rol === 'administracion'` (o listas de rol) como **autorización** fuera de `server/lib/permissions.js` y `src/config/accesoModulos.js`.

### Tests deterministas
- `scripts/test-db.mjs` (PGlite, Postgres embebido): ampliar con una **matriz de roles** que, desde base vacía, compruebe por rol:
  - `listar_usuarios_login()` devuelve al operador;
  - `get_rol_actual()` devuelve el rol esperado;
  - RLS de `finanzas_movimientos`/`cuentas_custodia` permite y deniega lo correcto;
  - `finanzas_operar` y `finanzas_asignar_custodia` aceptan `operarFinanzas` y rechazan el resto (`PT403`);
  - `nomina` no ve Finanzas y `finanzas` no ve saldos (defensa en profundidad).
- Vitest: casos para `useAuthStore` (login por rol), `useNomina`/`useFinanzas`/`useCuentasCustodia` (queries habilitadas por capacidad) y `accesoModulos`.
- `npm test`, `npm run test:db`, `npm run check:project`, `npm run lint`, `npm run build` en verde.

### Criterio de aceptación
Con la migración `243` aplicada, un operador `finanzas` inicia sesión, opera movimientos y **no** ve saldos; un operador `nomina` opera nómina y no ve Finanzas; un `jefe` ve ambos; `administracion` conserva todo. Sin rutas ni SQL que mencionen un rol único como condición de autorización.

### Dependencias
Ninguna externa. Es la única fase puramente de código y debe ir primero.

---

## F1 — Guardarraíl de paridad y pruebas por rol

**Objetivo:** que el desajuste F0 no pueda repetirse silenciosamente.

**✅ Cerrada el 2026-09-21.** Medición real: 9 roles × 10 superficies = **90** comprobaciones, con
**0 privilegios de más y 0 brechas**. Al existir las migraciones de alineación, la suite promueve
la paridad a fallo duro automáticamente.

### Entregables
- ✅ Guardarraíl que cruza tres fuentes: `ROLES_VALIDOS` de `server/lib/permissions.js`, el `CHECK usuarios_rol_check` de la migración `242` y el espejo SQL `roles_capacidad` de la 243 (comparado capacidad por capacidad con `rolesConCapacidad()`). Si divergen, `check:project` falla.
- ✅ Guardarraíl que detecta una autorización por rol único literal en las migraciones de roles.
- ✅ Suite determinista que recorre cada capacidad de la matriz y verifica la compuerta real, en `test-db.mjs` (SQL) y `compuertas-rol.test.jsx` (interfaz).

### Tests deterministas
- Matriz capacidad × rol con un caso por celda (permitido/denegado) reproducible sin red.
- El guardarraíl debe fallar a propósito cuando se inyecta una divergencia temporal (prueba negativa del guardarraíl).

### Criterio de aceptación
`npm run verify` falla si se reintroduce un rol único, si una capacidad nueva no tiene compuerta o si las tres fuentes de roles dejan de coincidir.

### Dependencias
F0.

---

## F2 — Barrera de acceso (PIN o alternativa)

**Objetivo:** cerrar el riesgo abierto del acceso por selección directa de usuario. El riesgo original: `handleSelectOperator` auditaba `LOGIN_SIN_PIN` y cualquiera con la cuenta y el dispositivo podía elegir un operador.

**✅ Cerrada el 2026-09-21.** Decisión aprobada: **PIN por operador**, con la ruta sin PIN eliminada. Evaluación de alternativas: se descartaron el código corto (mismo riesgo de reenvío sin segundo factor), la confirmación del dispositivo (no autentica a la persona, solo al aparato) y el SSO (no disponible para este despliegue); el PIN con PBKDF2 ya existe en el esquema y su coste de migración es cero.

- ✅ **No existe ruta sin PIN.** `handleSelectOperator` y `POST /api/auth/select-operator` están eliminados; el evento `LOGIN_SIN_PIN` no puede volver. La puerta es `POST /api/auth/switch-operator` (PIN validado en el Worker con PBKDF2, rate-limit por IP y auditoría de intento fallido y de éxito).
- ✅ **El operador activo vive en la sesión, no en el navegador.** `GET /api/auth/me` resuelve el operador desde `app_metadata.operator_id`; con varios operadores y sin elección responde `OPERADOR_REQUERIDO` con la lista pública, sin cargar perfil. Una cuenta mono-operador sigue entrando sin PIN adicional.
- ✅ **Barrera montada en la interfaz.** `compat/modules/auth/OperatorPicker.jsx` (selección + `LoginPinModal`, antes huérfano) se renderiza desde `LoginPage` con `authStatus: 'seleccion-pendiente'`; el store `seleccionarOperador` es el único canal y devuelve booleano (un objeto truthy habría ocultado el PIN incorrecto al modal).
- ✅ **Sin secretos en la respuesta.** `pin_hash`/`pin_salt` nunca salen del Worker; el esquema PBKDF2 no cambió, así que no hubo rotación de hashes.

### Guardarraíles
- ✅ `check-project.mjs`: la ruta de PIN debe conservar su validación de `operator_id` + `pin`; `LOGIN_SIN_PIN`, `handleSelectOperator` y `select-operator` están prohibidos; `/api/auth/me` debe responder `OPERADOR_REQUERIDO`.
- ✅ `check-project.mjs` prohíbe cualquier validación de credencial en `src/`/`compat/` (señales `verifyPinPBKDF2`, `pin_hash`, `pin_salt` fuera de pruebas). Los tres guardarraíles se verificaron con pruebas negativas.

### Tests deterministas
- ✅ `server/handlers/__tests__/auth-operators.test.js` (11): PIN válido/inválido, formato inválido, operador inexistente, rol heredado rechazado antes del PIN, auditoría de fallo y de éxito, y resolución de perfil (mono-operador, multi sin elección, operador elegido, metadata heredada, sin sesión).
- ✅ `compat/store/__tests__/seleccion-operador.test.jsx` (8): `OPERADOR_REQUERIDO` deja la selección pendiente sin restaurar caché, un 403 normal sigue siendo `denied`, y el envío del PIN recarga el perfil, falla sin cargar perfil, no duplica en el mismo tick, ignora tokens de otra cuenta y tolera fallos de red.
- ✅ `compat/modules/auth/__tests__/OperatorPicker.test.jsx` (4) y `compat/components/auth/__tests__/LoginPinModal.test.jsx` (4): autoenvío único, PIN rechazado que limpia dígitos y permite reintentar, y ausencia total de validación por red en el navegador.

### Criterio de aceptación
Ningún operador puede ser seleccionado sin PIN validado en el Worker; cada intento queda auditado; no hay secretos en la respuesta. **Cumplido.**

### Dependencias
Decisión del negocio — **aprobada el 2026-09-21**.

**Ampliación 22/09/2026 (auditoría → plan → fixeo):** PIN por rol (finanzas/nomina: 4 dígitos, resto: 6, única fuente `longitudPin`), rol `administracion` oculto del selector (`ROLES_CREABLES`), modal de PIN replicando el Dark Premium del POS de referencia, y cierre de los huecos que la auditoría descubrió: `X-Operator-Id` ya no decide el operador, no hay auto-selección sin PIN (ni con un único operador), toda sesión nueva exige PIN (limpieza en `login()`) y existe **Cambiar de usuario** en el menú de sesión. Guardarraíles y arnés en `docs/PLAN_FIX_USUARIOS_PIN.md`.

---

## F3 — Tasas BCV/Euro/USDT y reglas fiscales

**Objetivo:** conectar las fuentes reales y cargar las reglas legales aprobadas, sin hardcodear nada.

### Entregables
- Adaptador de tasas (`server/handlers/rates.js`) contra el proveedor aprobado; cada resultado se guarda como **snapshot** (moneda, valor, fuente, fecha, aprobación).
- Tasa manual con fuente, observación y aprobación.
- Reglas fiscales con fecha de vigencia, versión y fuente, que nacen **inactivas** hasta aprobación explícita.

### Guardarraíles
- `check-project.mjs` ya verifica `GET /api/rates` y `handleGetRates`; añadir que no haya URLs ni tasas incrustadas en el código.
- Prohibir que el cálculo use la tasa "actual": solo el snapshot del período.

### Tests deterministas
- Casos de liquidación con snapshot congelado (BCV, Euro, USDT, manual) que no cambian aunque la tasa externa cambie.
- Casos de regla inactiva que no se aplica y de regla aprobada que sí.
- Simulación con proveedor simulado (sin red real).

### Criterio de aceptación
Una liquidación reproduce exactamente la tasa y la regla vigentes en su período, con su fuente y aprobación, sin depender del estado externo actual.

### Dependencias
Proveedor y reglas aprobados por el negocio (documento de pendientes en `PLAN_IMPLEMENTACION.md`).

---

## F4 — Sincronización Personal → Nómina

**Objetivo:** proceso real y con responsable para el contrato mínimo de empleados (`id_externo`, `nombre`, `documento` opcional, `activo`, `cuenta_id`), unidireccional POS → Nómina.

### Entregables
- Proceso de sincronización operativo y su responsable de reconciliación.
- Nómina solo lee identidad mínima; nunca crea ni edita fichas de Personal.

### Guardarraíles
- `check-project.mjs` ya exige el contrato `/api/nomina/empleados` y la proyección mínima.
- Prohibir escrituras de Nómina hacia las fichas de Personal.

### Tests deterministas
- Empleado nuevo sincronizado aparece; empleado inactivo no aparece; reintentos no duplican; tenant filtrado server-side.

### Criterio de aceptación
La lista de empleados de Nómina refleja Personal sin duplicados ni escrituras inversas.

### Dependencias
F0 (roles) y decisión del negocio.

---

## F5 — Conciliación contable con datos reales

**Objetivo:** validar con contabilidad sueldo fijo, horas extras, feriados, bonos, anticipos, préstamos, retenciones y el ciclo completo de un período real.

### Entregables
- Un período completo de prueba conciliado (abrir → asistencia → calcular → cerrar → pagar → revertir → reabrir controlado).
- Respaldo y restauración verificados.
- Solo entonces habilitar `nomina_v2_enabled` para esa cuenta.

### Guardarraíles
- El candado de Nómina se define solo en `src/config/modulos.js` (`check-project.mjs` ya lo vigila).
- La bandera de rollout no es autorización y permanece apagada hasta la conciliación.

### Tests deterministas
- Los 127 casos financieros y 27 de nómina existentes deben seguir verdes; añadir los casos conciliados con datos del negocio (anonimizados).

### Criterio de aceptación
Ningún descuadre entre líneas pagadas, asientos financieros y saldos de custodia; reabrir un período con recibos pagados sigue bloqueado.

### Dependencias
F3, F4 y datos reales del negocio.

---

## F6 — Aceptación física, accesibilidad y concurrencia

**Objetivo:** cerrar lo que la suite determinista no puede certificar.

### Entregables
- Prueba manual en Safari iOS, Chrome Android y escritorio 1366 px, con teclado, lector de pantalla, error de red y doble clic (`docs/ACEPTACION_MANUAL_E2E.md`, `docs/ACEPTACION_IPHONE_FISICO.md`).
- Prueba de concurrencia PostgreSQL multiconexión (el motor embebido de `test-db.mjs` es de una sola conexión y no la cubre).

### Guardarraíles
- `npm run test:responsive` (34 comprobaciones estáticas) y `test:bundle-size` siguen vigentes.
- Reglas de `AGENT.md`: sin scroll horizontal, touch targets ≥ 44 px, sin diálogos nativos.

### Tests deterministas
- Ampliar `test-responsiveness-deterministic.mjs` con los casos nuevos; mantener el guardarraíl de secciones 9 y 10.

### Criterio de aceptación
3–5 personas del equipo completan las tareas de aceptación sin ayuda, midiendo tiempo, errores y preguntas.

### Dependencias
F0–F5 con datos de prueba realistas.

---

## F7 — Publicación, secretos y presupuesto de egress

**Objetivo:** desplegar la revisión autorizada y operar dentro del plan Free.

### Entregables
- Publicación en GitHub/Vercel con autorización explícita (hoy el deployment es histórico).
- Rotación de los secretos que hayan salido del gestor seguro.
- Revisión diaria de `Usage`: objetivo interno 100 MB/día y 3 GB/mes.

### Guardarraíles
- CI (`.github/workflows/ci.yml`): guardarraíl, lint, suite y build en push/PR.
- `.env.example` sin secretos; service role solo en `.dev.vars`/Worker.
- Prohibición de `select=*` y de `limit=1000` en `server/`.

### Tests deterministas
- `npm run verify` completo sobre el mismo snapshot a publicar.
- Verificación de que el build no incluye jspdf/html2canvas en la carga inicial.

### Criterio de aceptación
Producción sana con el mismo código verificado; sin secretos en el repositorio; egress dentro del presupuesto.

### Dependencias
F0–F6 y autorización de despliegue.

---

## F8 — Robustez de datos y deuda técnica

**Objetivo:** mantener la calidad sin frenar las fases anteriores.

### Entregables
- Mantener el límite de 600 líneas por fuente (`check-project.mjs`) y `npm run verify` en cada cambio no trivial.
- Migraciones futuras siempre separadas del Supabase del POS y aplicadas con CLI tras respaldo.
- Documentar cada regla nueva en `AGENT.md` y `docs/BITACORA_PROYECTO.md` en el mismo cambio.

### Guardarraíles
- Guardarraíl de tamaño, scanner de estructura/secretos e integridad por tenant (migración `220`).
- `git diff --check` sin errores.

### Tests deterministas
- Suite completa (`npm test`, `test:db`, `test:deterministic`, `test:responsive`, `test:qa`, `test:bundle-size`).

### Criterio de aceptación
Ninguna fuente supera el límite; ninguna regla queda sin bitácora; el árbol no acumula migraciones sin aplicar.

### Dependencias
Transversal a todas las fases.

---

## Pendientes de la auditoría de capacidades UI ↔ servidor (25/09/2026)

Plan completo: `docs/PLAN_ALINEACION_CAPACIDADES_UI.md`. Origen: el rol `nomina` recibía 403 en acciones que la pantalla le ofrecía (períodos, ajuste de línea, pagar/revertir nómina, importar comisiones POS, carga masiva de horario, eliminar asistencia), y `authFetch` convertía ese 403 en cierre de sesión.

| Fase | Alcance | Dependencia |
|---|---|---|
| A1 | ✅ Gates por acción en Nómina: `puedeGestionarNomina` (`gestionarUsuarios`) y `puedePagarNomina` (`operarFinanzas`); `esAdmin` queda para lectura y marcaje | ✅ |
| A2 | ✅ Contrato escrito: rol `nomina` en todas las rutas de escritura de `nomina.permisos.test.js` + guardarraíl de paridad UI ↔ servidor en `check:project` | A1 |
| A3 | ✅ Un 403 de capacidad no cierra la sesión (marca de motivo en `requireCapacidad` que `authFetch` distingue de la revocación de rol) | ✅ |

Cerrado el 25/09/2026 (bitácora #120): las tres fases se implementaron y verificaron (`lint`, 103 archivos / 1093 pruebas, `test:qa` 22/22, `test:responsive` 41/41, `test:bundle-size` PASS, `build`, `check:project`) con recorrido en vivo del operador `nomina`.

Decisiones abiertas: ¿el rol `nomina` administra personal? ¿paga nómina? La interfaz ya refleja lo que el servidor exige hoy (solo jefe/desarrollador); abrirlo es cambiar la matriz, no la UI.

---

## Pendientes de control de asistencia (25/09/2026)

Origen: el sábado aparecía en rojo para todo el personal, cuando solo una parte viene, y el panel «Marcaje real de hoy» no tenía forma de marcar que alguien no vino (ni de corregirlo después).

| Ítem | Alcance | Estado |
|---|---|---|
| B1 | Días laborables por empleado y con horas por día, guardados en `nomina_horarios` como horario permanente; sin filas propias se asume Lun–Sáb y el domingo nunca es laborable (se paga como feriado) | ✅ |
| B2 | Estado «Día libre» en Asistencia, en la vista diaria y en el reloj real: no suma pendientes ni pide ausencia; quien viene igual se puede marcar | ✅ |
| B3 | Botón «Marcar ausente» y su reversa («Deshacer ausencia») en el reloj real, solo en día laborable y solo sobre ausencias manuales | ✅ |
| B4 | Carga masiva que se niega (409 con el conteo) a escribir el día libre de alguno de los seleccionados | ✅ |

Cerrado el 25/09/2026 (bitácora #121) con `lint`, 104 archivos / 1103 pruebas, `test:qa` 22/22, `test:responsive` 41/41, los dos scripts determinísticos, `test:bundle-size` PASS, `build` y `check:project`.

Decisiones abiertas: ¿la ausencia justificada debe poder registrar un motivo o un documento? ¿El personal con «sin control de asistencia» (cobro por comisión) debe seguir apareciendo en el reloj real? Queda por probar en vivo el ciclo Marcar ausente → Deshacer ausencia y falta aplicar la migración 246.

---

## Pendientes de la auditoría del flujo de Nómina (26/09/2026)

Plan maestro completo: **`docs/PLAN_FIXEO_FLUJO_NOMINA.md`** (13 hallazgos en 4 fases, con
evidencia, fix, guardarraíl y tests). Origen: auditoría del flujo completo (vistas → hooks →
handlers → motor de cálculo → SQL) con simulación del motor y una prueba de componente temporal.

| Fase | Alcance | Estado |
|---|---|---|
| 1 | **F-1** contrato horas/ausencia/jornada abierta (crítico: una jornada sin salida se paga como día completo con 0 h, y el resultado cambia según el campo que el handler no pide) · **F-2** el guardarraíl de egress no protege en Windows y `nominaHorarios.js` lo viola · **F-3** una sola fuente de verdad para los días de la semana (el salario semanal puede pagarse a 5/6) | ✅ |
| 2 | **F-4** «Registrados» incluye días libres · **F-5** el sábado laborable se pinta como libre · **F-6** el reloj real y la vista diaria ignoran los feriados · **F-8** las horas por día configuradas no son el valor por defecto de los modales | ✅ |
| 3 | **F-7** guardar la semana laboral sin pérdida (hoy borra y luego inserta) + índice único en `nomina_horarios` (migración 247, con limpieza previa) | ✅ |
| 4 | **F-9** vigencia `fecha_desde` · **F-10** aviso de ausencia en día no laborable en el módulo Manual · **F-11** truncado silencioso de asistencia a 500 filas · **F-12** copy del monto fijo de feriado · **F-13** fecha operativa del grid móvil | ✅ |

Ninguno de estos hallazgos lo detectaba la suite al momento de la auditoría (`check:project`,
`lint`, 104 archivos / 1103 pruebas, los dos determinísticos y el build estaban en verde): el más
grave vivía en el borde entre la consulta de liquidación y el motor de cálculo, donde no había
pruebas.

Cerrado el 26/09/2026 (bitácora #122) con `lint` limpio, **111 archivos / 1158 pruebas**,
`test:qa` 23/23, `test:responsive` 41/41, `test:nomina-deterministic` 28/28,
`test:finanzas-deterministic` 125 aserciones, `test:bundle-size` PASS, `build` OK y
`check:project` OK (41 migraciones). Queda pendiente aplicar las migraciones **246** y **247** y el
recorrido en vivo del reloj real y del cálculo con jornadas abiertas.

**No auditado todavía**: importación y pago de comisiones POS (`nomina.comisiones.js`,
`ImportarComisionesPosModal`) y el motor financiero/RPC más allá de su idempotencia. Merece su
propia pasada antes de tocar esa parte.

Decisiones adoptadas (26/09/2026), las cuatro con la recomendación del plan: una jornada abierta
**bloquea** el cálculo con 409 y confirmación explícita; la ausencia en feriado no laborable **se
bloquea** como el día libre; el divisor del salario semanal **se deriva** de los días marcados; los
días libres **siguen sin pagarse** (el modelo paga por día registrado).

## Orden de ejecución recomendado

```text
F0 (SQL + sesión/UI + guardarraíles)   ← empezar aquí, sin dependencias externas
 └─ F1 (paridad y pruebas por rol)
     ├─ F2 (barrera de acceso)        ← requiere decisión de negocio
     ├─ F3 (tasas y legal)            ← requiere proveedor/aprobación
     │   └─ F5 (conciliación real)    ← requiere F4
     └─ F4 (sincronización Personal)  ← requiere proceso del negocio
F6 (QA física) ← tras F0–F5
F7 (deploy)    ← tras F6 y autorización
F8 (deuda)     ← transversal
```

## Definición de "pendiente cerrado"

Un pendiente se considera cerrado cuando: el cambio está implementado, sus guardarraíles están activos, sus pruebas deterministas pasan dentro de `npm run verify`, la bitácora está actualizada y —si depende del negocio— existe el dato o la aprobación por escrito.
