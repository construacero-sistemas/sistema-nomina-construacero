# PLAN_ALINEACION_CAPACIDADES_UI

Plan derivado de la auditoría de capacidades del 2026-09-25 (80 rutas del Worker cruzadas con
los gates del front y verificadas en vivo con el operador `nomina`). Objetivo: **que la
interfaz no ofrezca ninguna acción que el servidor vaya a rechazar**, y que si alguna se
escapa, el 403 no expulse al usuario de la aplicación.

Cada fase lleva alcance, fix, guardrail y tests. Al cerrar cada fase: `npm run verify` +
actualizar `docs/BITACORA_PROYECTO.md`.

Estado base: `npm test` 102 archivos / 1068 pruebas · `test:qa` 22/22 · `test:responsive`
41/41 · `lint` limpio · `check:project` OK · `build` OK.

## Estado de ejecución (25/09/2026)

**Las tres fases están implementadas y verificadas** (entrada #120 de `docs/BITACORA_PROYECTO.md`):

- Fase 1 ✅ — `puedeGestionarNomina` y `puedePagarNomina` en `NominaView`; gates por acción en
  `TabPeriodos`, `PeriodoDetalleModal`, `TabAsistencia`, `AsistenciaDiariaMovil`, `AsistenciaModal`
  y rename en `TabEmpleados`.
- Fase 2 ✅ — 17 pruebas del rol `nomina` en las 17 rutas de escritura (403 con marca y sin tocar la
  base) y guardarraíl de paridad por archivo en `check:project` (verificado rompiéndolo a propósito).
- Fase 3 ✅ — `CODIGO_CAPACIDAD_INSUFICIENTE` emitido por `requireCapacidad` y respetado por
  `authFetch`; las 32 compuertas `ROLES_*` de los handlers de nómina pasaron a la compuerta central.

Verificación del cierre: `lint` · 103 archivos / 1093 pruebas · `test:qa` 22/22 · `test:responsive`
41/41 · `test:bundle-size` PASS · `build` OK · `check:project` OK, más el recorrido en vivo con el
operador `nomina` (sin un solo botón condenado a 403). Quedan abiertas las tres decisiones de negocio
de la última sección.

---

## Contexto: la causa raíz

`src/views/NominaView.jsx` calcula `esAdmin = tieneCapacidad(perfil, 'administrarNomina')` y lo
usa como si fuera la capacidad de **cada acción**. Pero `administrarNomina` es la capacidad del
**módulo**: la tienen jefe, desarrollador y `nomina`. De las 80 rutas del Worker, **31 exigen
`gestionarUsuarios`** (solo jefe/desarrollador) y **7 exigen `operarFinanzas`** (jefe/desarrollador/
finanzas), de las cuales 2 son de nómina (`lineas/pagar`, `lineas/revertir-pago`). Por eso el rol
`nomina` ve botones cuyo endpoint le responde 403.

Agravante verificado: `compat/services/authFetch.js` trata **cualquier 403** como revocación de
rol (`denyAccess()`), borra el perfil y muestra «No pudimos abrir tu cuenta». Reproducido en vivo:
`POST /api/nomina/config-empleado/actualizar → 403` al usar un botón mal gateado.

## Matriz de referencia

| Capacidad | jefe / desarrollador | finanzas | nomina |
|---|---|---|---|
| `verNomina` / `administrarNomina` (`ROLES_VER` / `ROLES_NOMINA`) | ✓ | ✗ | ✓ |
| `gestionarUsuarios` (`ROLES_ADMIN`) | ✓ | ✗ | ✗ |
| `operarFinanzas` | ✓ | ✓ | ✗ |
| `verSaldos` / `administrarSistema` | ✓ | ✗ | ✗ |

## Hallazgos a corregir

| # | Acción en pantalla | Endpoint | Capacidad exigida | Estado |
|---|---|---|---|---|
| A-1 | Crear / Calcular / Cerrar / Reabrir / Eliminar período | `nomina/periodos/*` | `gestionarUsuarios` | **hecho** |
| A-2 | Ajustar línea (bonos y deducciones) | `nomina/lineas/ajustar` | `gestionarUsuarios` | **hecho** |
| A-3 | Pagar nómina / Revertir pago | `nomina/lineas/pagar`, `lineas/revertir-pago` | `operarFinanzas` | **hecho** |
| A-4 | Importar Comisiones POS | `nomina/aplicar-comisiones-pos` | `gestionarUsuarios` | **hecho** |
| A-5 | Aplicar horario a N pendientes (carga masiva) | `nomina/asistencia/registrar-masivo` | `gestionarUsuarios` | **hecho** |
| A-6 | Eliminar un registro de asistencia | `nomina/asistencia/eliminar` | `gestionarUsuarios` | **hecho** |
| A-7 | Alta / edición / baja / reactivación / eliminación / interruptor de asistencia | `nomina/config-empleado/*` | `gestionarUsuarios` | **hecho** (2026-09-25) |

Sin hallazgos (verificado, no tocar): marcaje real (`administrarNomina` a ambos lados), registro
individual de asistencia (`verNomina`), y todo lo que vive en **Sistema** (feriados, horarios
generales, conceptos, reglas legales, tasas, retención) o detrás de `verSaldos` (tesorería,
cuentas de custodia), donde UI y servidor ya coinciden. En **Finanzas** los conjuntos de roles
coinciden (`verFinanzas` + `operarFinanzas`), y el modal de Sync POS que exigiría
`gestionarUsuarios` no lo abre ningún componente.

---

## FASE 1 — Alineación de gates en Nómina (P1)

### 1.1 Dos llaves explícitas en `NominaView`
- **Fix:** además de `esAdmin` (lectura y marcaje), calcular
  `puedeGestionarNomina = tieneCapacidad(perfil, 'gestionarUsuarios')` (nómina, períodos,
  catálogos, masivo, eliminaciones) y  `puedePagarNomina = tieneCapacidad(perfil, 'operarFinanzas')`
  (pagar y revertir líneas). `puedeGestionarPersonal` (A-7) queda como alias de la misma
  capacidad: unificar en `puedeGestionarNomina` para no arrastrar dos nombres.
- **Archivos:** `src/views/NominaView.jsx`, y el rename del prop en `TabEmpleados.jsx`.
- **Atención:** el guardarraíl añadido el 2026-09-25 en `scripts/check-project.mjs` exige el
  literal `puedeGestionarPersonal` en `NominaView.jsx` y `TabEmpleados.jsx`; al unificar el nombre
  hay que actualizar ese marcador en el mismo cambio, o `check:project` falla.
- **Guardrail:** `scripts/check-project.mjs` — `NominaView.jsx` debe contener
  `tieneCapacidad(perfil, 'gestionarUsuarios')` y `tieneCapacidad(perfil, 'operarFinanzas')`, y
  debe pasar ambas props a `TabEmpleados`, `TabPeriodos` y `TabAsistencia`.

### 1.2 `TabPeriodos` + `PeriodoFormModal` (A-1)
- **Fix:** sustituir `esAdmin` por `puedeGestionarNomina` en los puntos de escritura:
  `TabPeriodos.jsx:74` (acción de cabecera), `:100-101` (empty state), `:156` (eliminar),
  `:228` (calcular) y `:239` (cerrar para pago). `:268` («Pagar Recibos», abre el pago) va con
  `puedePagarNomina`. El paso a `PeriodoDetalleModal` (`:109`, `:120`) recibe ambas props. La
  lectura (`GET /nomina/periodos`, `GET /nomina/lineas`) se queda con `esAdmin`.
- **Nota:** `useReabrirPeriodo` tiene endpoint (`periodos/reabrir`) pero **hoy no tiene botón**; si
  se agrega, va con `puedeGestionarNomina`.
- **Criterio:** con el rol `nomina`, ninguna acción de escritura de la pestaña Períodos se
  renderiza; con jefe, todas siguen ahí.

### 1.3 `PeriodoDetalleModal` (A-2, A-3, A-4)
- **Fix (etiqueta → capacidad):** «Importar Comisiones POS» (`:135`) → `puedeGestionarNomina`;
  «Pagar Recibos Pendientes (N)» (`:157`) → `puedePagarNomina`; «Ajustar Bonos y Deducciones»
  (`:273`) → `puedeGestionarNomina`; «Pagar» por recibo (`:283`) y «Revertir Pago» (`:292`) →
  `puedePagarNomina`. `PagarNominaModal` solo se abre con `puedePagarNomina`.
- **Se queda con `esAdmin`:** la lista de recibos, los totales y las descargas (`exportarPlanilla`,
  `exportarRecibo`) — son lectura.
- **Nota de negocio:** el servidor documenta que pagar nómina exige `operarFinanzas` («nómina paga,
  finanzas registra el egreso»), así que hoy **solo jefe/desarrollador paga**. Si se quiere que el
  rol `nomina` pague, el cambio es en la matriz (`capacidadesNomina.operarFinanzas = true`), no en
  la UI; con esto la interfaz ya queda correcta en ambos escenarios.

### 1.4 `TabAsistencia` + `AsistenciaDiariaMovil` + `AsistenciaModal` (A-5, A-6)
- **Fix:** `AsistenciaDiariaMovil.jsx:130` (botón «Aplicar a N pendientes») y la invocación de
  `AsistenciaMasivaModal` en `TabAsistencia.jsx:233/420` → `puedeGestionarNomina`.
  `AsistenciaModal.jsx:18` (`puedeEditar`) mantiene `esAdmin` para edición manual y alta de
  registro (`verNomina` en el servidor), pero el botón Eliminar (`:329`) pasa a
  `puedeGestionarNomina`. `MarcajeLogisticaPanel` no se toca: ya usa `administrarNomina`, que es
  lo que exige el marcaje real.
- **Criterio:** el rol `nomina` conserva registrar asistencia y marcar entrada/salida (sus tareas
  reales) y pierde las cuatro acciones que el servidor le rechaza.

**Salida de Fase 1:** flujo completo recorrido en el preview con el operador `nomina` sin un solo
botón condenado a 403; `npm test` verde; bitácora actualizada.

---

## FASE 2 — Escribir el contrato en las pruebas (P1)

### 2.1 Cobertura del rol `nomina` en escrituras
- **Problema:** `server/handlers/__tests__/nomina.permisos.test.js` prueba (a) que los roles **sin**
  módulo reciben 403 en todas las rutas y (b) que jefe/desarrollador/**nomina** pasan la puerta,
  pero **solo en `handleGetEmpleados` (lectura)**. Nada afirma qué pasa con el rol `nomina` en las
  escrituras: el hueco exacto por el que se colaron A-1…A-6.
- **Tests:** nuevos casos en ese archivo, con la tabla `ACCIONES_ADMIN_NOMINA` (períodos, líneas,
  masivo, eliminar asistencia, aplicar comisiones) → `nomina` responde **403 sin tocar la base**
  (`mock.calls` vacío), y jefe/desarrollador **no** 403. Y los de `operarFinanzas`
  (`handlePagarLineas`, `handleRevertirPagoLinea`) → `nomina` 403, `finanzas` 403 por módulo.
- **Criterio:** si alguien relaja una compuerta del servidor sin cambiar la UI, el test falla.

### 2.2 Guardarraíl de paridad UI ↔ servidor
- **Guardrail:** en `scripts/check-project.mjs`, un mapa `acción → capacidad exigida` (las 6 de la
  tabla de hallazgos) que verifique que cada acción se gatea en el JSX con la capacidad correcta
  (`puedeGestionarNomina` / `puedePagarNomina`) y que no reaparece `esAdmin` en esas líneas.
- **Criterio:** `check:project` falla si un gate vuelve a la capacidad del módulo.

**Salida de Fase 2:** el contrato queda escrito y automatizado en los dos lados.

---

## FASE 3 — Un 403 de capacidad no debe cerrar la sesión (P2)

- **Problema:** `compat/services/authFetch.js` llama a `denyAccess()` ante cualquier 401/403. Un
  permiso insuficiente para una acción no significa rol revocado, pero el usuario termina en
  «No pudimos abrir tu cuenta» con el perfil borrado.
- **Fix propuesto:** que el servidor marque el motivo. `requireCapacidad`
  (`server/lib/permissions.js`) añade al 403 un código legible (campo `code: 'CAPACIDAD_INSUFICIENTE'`
  en el cuerpo, o cabecera `X-Denied-By: capability`); `authFetch` solo invoca `denyAccess()` cuando
  el 403 **no** trae esa marca. Los 403 de `validateOperator` (rol revocado, operador inactivo) siguen
  cerrando sesión como hoy.
- **Guardrail:** `check-project` exige que `requireCapacidad` emita la marca y que `authFetch` la
  consulte antes de `denyAccess`.
- **Tests:** `compat/services/__tests__/authFetch.test.jsx`: (a) 403 de capacidad → no se limpia el
  perfil y el error llega a la UI; (b) 403 de rol revocado → sí se limpia; (c) 401 → refresca token
  y, si no hay sesión, expira.
- **Criterio:** un clic sin permiso muestra el mensaje y deja la sesión intacta.

---

## Decisiones pendientes (solo el negocio)

1. **¿Quién administra personal?** Hoy: solo jefe/desarrollador (servidor). La UI ya lo refleja.
   Si el rol `nomina` debe dar de alta y configurar empleados, se abre en la matriz
   (`capacidadesNomina.gestionarUsuarios = true`) y la UI se actualiza sola.
2. **¿Quién paga la nómina?** Hoy: solo jefe/desarrollador (`operarFinanzas`). Alternativa: abrir
   `operarFinanzas` al rol `nomina`, lo que también le daría acceso a operar en Finanzas.
3. **¿Se relaja el cierre de sesión por 403?** Fase 3 lo propone; si el negocio prefiere que un 403
   siga forzando revalidación de rol (finanzas semanal), se documenta y se cierra la fase sin cambios.

## Orden de ejecución y verificación

1. Fase 1 (gates) → verificación en vivo con el operador `nomina` en móvil y escritorio.
2. Fase 2 (contrato) → `npm test`, `check:project`.
3. Fase 3 (sesión) → `compat` tests.
4. Cierre: `npm run verify`, `test:qa`, `test:responsive`, `test:bundle-size`, `build`, bitácora.

**No tocar en este plan:** los cambios heredados sin commitear de Asistencia/Empleados, ni la
matriz de capacidades (`server/lib/permissions.js`) salvo que se decida lo contrario en las
decisiones pendientes.
