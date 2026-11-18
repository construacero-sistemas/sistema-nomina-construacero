# PLAN_MARCAJE_BOTONES_UX

Plan derivado de la auditoría del 17/11/2026 a los botones del **Marcaje real de hoy**
(`Marcar entrada`, `Marcar ausente`, `Marcar salida`, `Corregir marcaje`, `Anular entrada y
marcar ausente`, `Deshacer ausencia`). Se leyó el panel, los hooks, los handlers del servidor, la
ruta en `worker.js`, la migración 209 y los arneses de pruebas que ya existen.

Objetivo: **que cada botón que se muestra funcione, que un toque equivocado se pueda deshacer
con el mismo esfuerzo que costó hacerlo, y que la marcación masiva de la mañana no lleve a marcar
a la persona equivocada.**

Cada hallazgo trae evidencia (archivo:línea), fix, arnés (pruebas), guardarraíl y criterio de
aceptación. Al cerrar cada fase hay que correr `npm run verify` y anotar una entrada en
`docs/BITACORA_PROYECTO.md`.

**Estado base:** se mide al empezar la Fase 0 con `npm run verify`, y la cifra se anota aquí
antes de tocar código. Ninguna prueba actual detecta M-1 ni M-2: el test del panel no cubre una
jornada en curso en un día libre, y el de salida no revisa los filtros del PATCH.

## Resumen de hallazgos

| # | Sev. | Hallazgo | Archivo clave | Tamaño |
|---|---|---|---|---|
| M-0 | Bloqueante | El panel tiene 565/600 líneas: cualquier mejora rompe `check:project` | `src/components/nomina/MarcajeLogisticaPanel.jsx` | S |
| M-1 | **Crítico** | «Anular entrada…» aparece en día libre o feriado no laborable y el servidor **siempre** lo rechaza; esa entrada no se puede deshacer | `MarcajeLogisticaPanel.jsx:488`, `server/handlers/nomina.horarios.js:270-277` | M |
| M-2 | **Alto** | La salida se escribe sin filtro de concurrencia: dos equipos pueden pisarse la hora y las horas calculadas | `server/handlers/nomina.asistencia.js:233` | S |
| M-3 | Medio | La clave de idempotencia se genera dentro de `mutationFn`: un reintento tras corte de red da 409 en vez de éxito | `src/hooks/useNominaMarcaje.js:17-19,32-34` | S |
| M-4 | Medio | Todos los botones se bloquean en cada recarga de fondo (`isFetching`), no solo el de la tarjeta en acción | `MarcajeLogisticaPanel.jsx:156-159` | M |
| M-5 | Medio | La lista se reordena al marcar: la siguiente tarjeta queda bajo el dedo | `MarcajeLogisticaPanel.jsx:150-151` | S |
| M-6 | Medio | Un toque equivocado en «Marcar entrada» o «Marcar salida» no tiene deshacer rápido (pide modal + motivo) | `MarcajeLogisticaPanel.jsx:413-500` | M |
| M-7 | Medio | Si llega tarde alguien ya marcado ausente: hacen falta dos pasos (deshacer y luego marcar) | `MarcajeLogisticaPanel.jsx:444-457`, `nomina.asistencia.js:174-180` | M |
| M-8 | Medio | Se acepta una salida a segundos de la entrada sin ningún aviso | `nomina.asistencia.js:186-237` | S |
| M-9 | Bajo | Los errores salen dos veces (toast del hook + banner del panel) | `useNominaMarcaje.js:25,40,53,66`, `useNomina.js:438` | XS |
| M-10 | Bajo | En «Jornada en curso» se ven 3 botones a lo ancho; el destructivo pesa casi igual que el principal | `MarcajeLogisticaPanel.jsx:459-501` | S |
| M-11 | Bajo | La tarjeta no muestra ni el tiempo en jornada ni el retraso respecto a la hora esperada | `MarcajeLogisticaPanel.jsx:394-401` | S |
| M-12 | Bajo | Copy: etiqueta larga, el modal muestra el nombre sin capitalizar, el toast no dice a quién ni a qué hora | `MarcajeLogisticaPanel.jsx:498,536`, `useNominaMarcaje.js:21,36` | XS |
| M-13 | Bajo | `aria-label` distinto del texto visible (WCAG 2.5.3) | `MarcajeLogisticaPanel.jsx:432,493` | XS |
| M-14 | Bajo | Un `role="status"` por tarjeta: el lector de pantalla puede leer la lista entera en cada recarga | `MarcajeLogisticaPanel.jsx:385` | XS |

---

## Guardarraíles transversales (aplican a TODA fase)

Ningún PR de este plan se integra si rompe alguno de estos puntos:

| ID | Guardarraíl | Cómo se hace cumplir |
|---|---|---|
| G-1 | Ningún archivo de `src/`, `server/` o `worker.js` pasa de 600 líneas | `check:project` (`scripts/check-project.mjs:433`) |
| G-2 | **El servidor decide; la interfaz solo anticipa.** Toda regla nueva que oculte o muestre un botón tiene su espejo en el handler, y ambos lados se prueban | En cada hallazgo: test de componente + test de handler |
| G-3 | **Toda escritura condicional sobre `registro_asistencia`** (PATCH/DELETE) lleva filtros del estado leído (`hora_salida`, `estado_marcaje`, `es_ausencia`, `hora_entrada`) y responde 409 si no afectó filas | Test de handler que revisa la URL del PATCH/DELETE y el caso «0 filas → 409» |
| G-4 | Toda mutación nueva registra auditoría con la foto del estado anterior | Test: `registrarAuditoria` llamado con `accion` y `meta` esperados |
| G-5 | Toda mutación nueva valida que la fecha sea la operativa de hoy (`nowInNominaZone`) y que el período esté abierto (`periodoBloqueadoParaFecha`) | Test con período `cerrado` → 400 y con fecha de ayer → 400 |
| G-6 | Toda consulta lleva el filtro de tenant (`nominaTenantFilter`) | Ampliar `server/handlers/__tests__/nomina.tenant.test.js` con las rutas nuevas |
| G-7 | Permiso único: `administrarNomina` | Ampliar `nomina.permisos.test.js` (rol sin capacidad → 403) |
| G-8 | Toda ruta nueva queda registrada en `worker.js` | Ampliar la lista de `server/handlers/__tests__/worker.e2e.test.js:84` |
| G-9 | El panel conserva los textos que exige `check:project` (`administrarNomina`, `El servidor registra la hora`) | `check:project` (`scripts/check-project.mjs:170`) |
| G-10 | Botones táctiles ≥ 44 px (`min-h-11`), sin diálogos nativos | `test:responsive` + `test:qa` |
| G-11 | Sin cambios de esquema salvo que se indique; si aparece una migración, se prueba en staging antes que en producción | `test:db` + `test:staging:smoke` |
| G-12 | El dinero no cambia: ninguna corrección de UI altera horas pagadas de un registro ya completo | `test:nomina-deterministic` y `test:flujo-mes` en verde y sin cambiar sus esperados |

---

## FASE 0 — Preparar el terreno (sin cambio de comportamiento)

### M-0 · Partir el panel antes de crecerlo (S)

**Evidencia.** `MarcajeLogisticaPanel.jsx` tiene 565 líneas y el límite es 600
(`check-project.mjs:433`). Las fases 1–3 suman más de 35 líneas.

**Fix.** Es una extracción mecánica, sin tocar lógica:
1. `src/components/nomina/marcaje/TarjetaMarcaje.jsx`: el `<article>` de cada empleado
   (líneas 371–503) con sus botones. Props: `fila`, `accionPendiente`, `bloqueado`, callbacks.
2. `src/components/nomina/marcaje/AnularEntradaModal.jsx`: el modal de líneas 518–547.
3. `src/components/nomina/marcaje/marcajeEstado.js`: `estadoDelRegistro`, `claseEstado`,
   `etiquetaEstado`, `PRIORIDAD_ESTADO`, `FILTROS`, como funciones puras y exportadas.
4. El panel se queda con la orquestación, sus textos guardados (G-9) y los hooks.

**Arnés.** `MarcajeLogisticaPanel.test.jsx` tiene que pasar **sin cambiar ninguna aserción**: es
la prueba de caracterización. Además, un `marcajeEstado.test.js` con la matriz de
`estadoDelRegistro`: (sin registro × libre/no libre), ausencia, manual, entrada, completo y
corregido.

**Guardarraíl.** G-1 y G-9. El diff de la fase solo mueve código: hay que revisar que no cambie
ninguna clase CSS ni texto.

**Criterio.** `npm run verify` en verde. El panel queda en ≤ 350 líneas, y cada archivo nuevo en
≤ 250.

---

## FASE 1 — Integridad (P0/P1, primer PR)

### M-1 · «Anular entrada» en día libre o feriado no laborable (M)

**Evidencia.** El botón se muestra con `estado === 'en-curso' && marcajeReal`
(`MarcajeLogisticaPanel.jsx:488`), sin mirar `libre` ni `feriado`. El handler responde 400 con
«Ese día es libre…» o «…feriado no laborable…» (`nomina.horarios.js:270-277`).

**Caso real.** Un sábado libre, el operador pulsa «Marcar entrada (vino)» con la persona
equivocada. Ve «Anular entrada y marcar ausente», escribe el motivo, confirma y recibe un error.
No existe ningún otro camino para quitar esa entrada: «Corregir» solo cambia horas.

**Fix.** Un solo endpoint en el que **el servidor decide el resultado** y la interfaz lo
anticipa:
1. `handleAnularEntradaComoAusencia` → se renombra a `handleAnularEntrada`. Mantener la ruta
   `POST /api/nomina/marcaje/anular-entrada-ausencia` por compatibilidad y añadir el alias
   `POST /api/nomina/marcaje/anular-entrada`.
2. El body acepta `resultadoEsperado: 'ausencia' | 'sin-registro'`.
3. El servidor calcula el resultado real:
   - Si es día laborable, o feriado laborable → `ausencia` (lo que hace hoy).
   - Si es día libre, o feriado no laborable → `sin-registro`: **DELETE condicional** del registro
     con `estado_marcaje=eq.<leído>&hora_entrada=eq.<leída>&hora_salida=is.null&es_ausencia=eq.false`
     (G-3). Si borra 0 filas → 409.
4. Si `resultadoEsperado` no coincide con el resultado real → **409**: «El día cambió (feriado o
   semana laboral). Actualiza y vuelve a intentarlo.» Así la interfaz nunca confirma una cosa
   mientras el servidor hace otra.
5. Auditoría: `ANULAR_ENTRADA_MARCAR_AUSENCIA` (se conserva) o `ANULAR_ENTRADA_SIN_REGISTRO`, con
   la misma `meta.entradaAnulada` y `meta.horasAnuladas` (G-4).
6. UI: en `TarjetaMarcaje`, si la fila es `libre` o el feriado es no laborable, el botón dice
   **«No vino — anular entrada»** y el modal explica que el registro se elimina. En día
   laborable, el botón dice **«No vino — marcar ausente»** y el modal mantiene el texto actual.
   El botón de confirmar dice «Anular entrada» o «Registrar ausencia» según el caso.

**Arnés (servidor)** — `server/handlers/__tests__/nomina.ausencia.test.js`, con esta matriz:

| Día | Estado del registro | Esperado |
|---|---|---|
| laborable | `entrada` | 200, PATCH a ausencia, auditoría `…MARCAR_AUSENCIA` |
| laborable | `corregido` sin salida | 200, ausencia |
| libre | `entrada` | 200, DELETE condicional, auditoría `…SIN_REGISTRO` |
| feriado no laborable | `entrada` | 200, DELETE condicional |
| feriado laborable | `entrada` | 200, ausencia |
| cualquiera | `completo` | 409 (sin cambios) |
| cualquiera | ausencia | 409 |
| libre, con `resultadoEsperado: 'ausencia'` | `entrada` | 409 «el día cambió», sin escribir |
| libre | DELETE devuelve `[]` | 409 «el marcaje cambió» |
| período cerrado / fecha de ayer | — | 400 (G-5) |

Además: la URL del DELETE contiene los cuatro filtros (G-3), y el tenant filter está presente
(G-6).

**Arnés (UI)** — `TarjetaMarcaje.test.jsx`:
- Jornada en curso + `libre` → aparece «No vino — anular entrada» y **no** aparece «…marcar
  ausente».
- La confirmación envía `resultadoEsperado: 'sin-registro'`.
- Lo mismo con un feriado no laborable.
- En día laborable se envía `'ausencia'`.

**Arnés (staging)** — `scripts/test-staging-smoke.mjs`: entrada en sábado libre → anular →
`GET /marcaje/hoy` sin registro de esa persona, y existe un evento de auditoría.

**Criterio.** Ninguna combinación (día × estado) muestra un botón que el servidor vaya a
rechazar por regla de calendario. Una entrada marcada por error en un día libre se puede quitar.

### M-2 · Salida con concurrencia optimista (S)

**Evidencia.** `handleMarcarSalida` lee el registro y comprueba `hora_salida` (`:212`), pero el
PATCH filtra solo por `id` (`:233`). Si dos equipos marcan la salida a la vez, la segunda
sobrescribe `hora_salida`, las horas calculadas y `salida_idempotency_key` de la primera.

**Fix.**
1. Añadir al PATCH:
   `&hora_salida=is.null&es_ausencia=eq.false&hora_entrada=eq.<leída>&estado_marcaje=eq.<leído>`.
2. Si el resultado es `[]`, releer el registro. Si su `salida_idempotency_key` es la misma de esta
   petición → 200 idempotente. Si no → 409: «Otra persona ya marcó la salida a las HH:MM.
   Actualiza la lista.»
3. Revisar con el mismo criterio el PATCH de `handleCorregirMarcaje`, que ya filtra por horas
   (`:348`), y documentarlo con un comentario G-3.

**Arnés.** `nomina.marcaje.test.js`:
- La URL del PATCH contiene `hora_salida=is.null` y `estado_marcaje=eq.`.
- PATCH → `[]` y relectura con otra clave → 409, y la auditoría **no** se registra.
- PATCH → `[]` y relectura con la misma clave → 200 `idempotente: true`.

**Arnés (staging).** `scripts/test-staging-concurrency.mjs`: dos salidas simultáneas del mismo
empleado → exactamente una 200 y una 409, y `hora_salida` igual a la de la 200.

**Guardarraíl.** G-3.

**Criterio.** No hay ningún camino en el que dos salidas terminen ambas en 200 con horas
distintas.

### M-3 · Idempotencia real en los reintentos (S)

**Evidencia.** `makeIdempotencyKey` se llama dentro de `mutationFn`
(`useNominaMarcaje.js:18,33`), así que cada intento lleva una clave nueva. El servidor ya
responde idempotente si la clave coincide (`nomina.asistencia.js:176,211`), pero nunca le llega
la misma clave dos veces.

**Fix.**
1. Los hooks aceptan `idempotencyKey` en `variables` y solo generan una si no viene.
2. El panel genera la clave **al hacer clic** y la guarda en `accionPendiente`.
3. Si el error es de red o timeout (sin respuesta HTTP), el banner ofrece **«Reintentar»**, que
   reutiliza la misma clave. Si el error es HTTP 4xx/5xx con mensaje, se descarta la clave.
4. Distinguir los dos tipos de error en `apiPost`. Si hoy no lo distingue, exponer
   `error.sinRespuesta = true`.

**Arnés.** `src/hooks/__tests__/useNominaMarcaje.test.js`, que es nuevo:
- Con `idempotencyKey` provista, `apiPost` la recibe tal cual.
- Sin clave, genera una con el prefijo `entrada-<empleadoId>-`.
- En el panel: fallo de red → «Reintentar» → `mutateAsync` recibe **la misma** clave.

**Guardarraíl.** Prueba que falla si `mutationFn` ignora la clave recibida.

**Criterio.** Si se corta la red después de que el servidor guardó, «Reintentar» devuelve éxito
y no un 409.

---

## FASE 2 — Flujo operativo (segundo PR)

### M-4 · Bloqueo por tarjeta y actualización optimista (M)

**Evidencia.** `bloqueado` incluye `isFetching` y `empleadosActualizando`
(`MarcajeLogisticaPanel.jsx:156-159`). Cada acción invalida `KEY_MARCAJE` y, mientras se recarga,
todos los botones quedan al 55 % de opacidad con `cursor-wait`. Lo mismo pasa al volver a la
pestaña. El bloqueo existe para que no se vea un estado viejo y alguien pulse dos veces.

**Fix.**
1. En `onSuccess` de entrada, salida, ausencia y anulación: `qc.setQueryData(KEY_MARCAJE, …)`
   con el `registro` que devuelve el servidor (ya lo devuelve). Así la tarjeta cambia de estado
   **al instante** y luego se recarga en segundo plano.
2. `bloqueado` global solo cuando hay error de consulta, no hay fecha, la fecha no es la de hoy o
   es la carga inicial (`isLoading`).
3. `bloqueadoTarjeta = bloqueado || accionPendiente?.empleadoId === id`. Las demás tarjetas
   siguen operables.
4. Se permite **una acción a la vez por empleado**, pero no a la vez en el panel entero. El
   servidor sigue siendo la última barrera: `UNIQUE(empleado_id, fecha)` en
   `supabase/migrations/209_nomina_asistencia.sql:21`, y M-2 para la salida.

**Arnés.** `MarcajeLogisticaPanel.test.jsx`:
- Con `isFetching: true` y datos cargados, los botones están **habilitados**.
- Con `isError` o la fecha cambiada, están deshabilitados.
- Mientras la entrada de A está pendiente, el botón de A está deshabilitado y el de B no.
- Hook: tras el éxito, la caché contiene el registro nuevo **antes** de la recarga.

**Guardarraíl.** G-2: el servidor rechaza un duplicado (409) aunque la interfaz falle. Hay que
mantener el test de 409 por duplicado en `nomina.marcaje.test.js`.

**Criterio.** Se pueden marcar 10 entradas seguidas sin esperar el parpadeo de recarga entre una
y otra.

### M-5 · Orden estable y filtro inicial útil (S)

**Evidencia.** La lista se ordena por estado en cada render (`:150-151`). Cuando A pasa a «En
jornada», sale del bloque de pendientes y la tarjeta de B sube a su lugar. El filtro inicial es
`'todos'` (`:105`).

**Fix.**
1. `ordenCongelado`: un `Map<empleadoId, índice>` que se toma al cargar, al pulsar «Actualizar»,
   al cambiar de filtro o al buscar. Mientras no cambie, una tarjeta conserva su posición aunque
   cambie de estado; los empleados nuevos van al final.
2. En el filtro «Pendientes», la tarjeta recién marcada **no desaparece de inmediato**: queda
   atenuada con un check y «Entrada 7:58 AM · Deshacer» (ver M-6) hasta el siguiente cambio de
   filtro o actualización.
3. El filtro inicial depende de la decisión D-2.

**Arnés.**
- Marcar la entrada de la primera tarjeta → el orden de los `h4` no cambia.
- Pulsar «Actualizar» → se reordena.
- En el filtro «Pendientes», la tarjeta marcada sigue visible con el estado nuevo.

**Criterio.** Durante una tanda de marcaje, ninguna tarjeta se mueve debajo del dedo.

### M-6 · Deshacer rápido de entrada y salida (M)

**Evidencia.** Un toque equivocado en «Marcar ausente» se deshace con un toque. En «Marcar
entrada» exige el modal de anulación con motivo, y en «Marcar salida» exige «Corregir» con
motivo: el costo de deshacer no es parejo.

**Fix.**
1. Endpoint `POST /api/nomina/marcaje/deshacer`, con body `{ registroId, tipo: 'entrada'|'salida',
   idempotencyKey }`.
2. Reglas del servidor:
   - La clave coincide con `entrada_idempotency_key` o `salida_idempotency_key`. Solo quien hizo
     el marcaje, desde ese mismo dispositivo, tiene la clave.
   - `entrada_marcada_en` o `salida_marcada_en` tiene a lo sumo **N segundos** (D-1) según la
     hora del servidor.
   - Para entrada: el registro está en `estado_marcaje='entrada'` y sin salida → DELETE
     condicional (G-3).
   - Para salida: el registro está en `completo` o `corregido` → PATCH condicional que vuelve a
     `estado_marcaje` anterior (`entrada` o `corregido`), limpia `hora_salida`, `salida_*` y las
     horas calculadas.
   - G-5, y auditoría `DESHACER_ENTRADA` o `DESHACER_SALIDA` con una foto completa (G-4).
3. UI: el toast de éxito o la línea de la tarjeta muestran «Deshacer» con una cuenta regresiva.
   Pasado el plazo, el botón desaparece y quedan las vías normales (Corregir / No vino).

**Arnés (servidor).** `nomina.marcaje-deshacer.test.js`, que es nuevo:
- Clave correcta dentro del plazo → 200 y DELETE o PATCH con filtros.
- Clave incorrecta → 403.
- Fuera de plazo → 409.
- Entrada con salida ya marcada → 409.
- Salida deshecha → el registro vuelve a `entrada` con las horas en 0.
- Período cerrado → 400.
- Tenant y permisos (G-6, G-7).

**Arnés (UI).**
- Después de marcar aparece «Deshacer». Con temporizadores falsos, a los N s desaparece.
- Pulsar «Deshacer» llama al endpoint con la clave de la acción original.

**Criterio.** Un error de dedo se corrige con un toque durante N segundos, sin motivo y con rastro
completo en la auditoría.

### M-7 · «Llegó» desde una ausencia (M)

**Evidencia.** La tarjeta de ausencia solo ofrece «Deshacer ausencia» (`:444-457`). Si se pulsa
«Marcar entrada» con una ausencia ya registrada, el POST choca con `UNIQUE(empleado_id, fecha)` y
devuelve «No se pudo registrar la entrada» (`nomina.asistencia.js:180`).

**Fix.**
1. `handleMarcarEntrada` acepta `reemplazarAusencia: true`. Si el registro existente es
   `es_ausencia=true` y `estado_marcaje='manual'`, hace un PATCH condicional
   (`es_ausencia=eq.true&estado_marcaje=eq.manual&hora_entrada=is.null`) que lo convierte en
   entrada con la hora del servidor.
2. Sin el flag, se conserva la respuesta actual, pero el mensaje pasa a 409 explícito: «Hoy está
   registrado como ausente. Usa "Llegó: marcar entrada".»
3. Auditoría `MARCAR_ENTRADA` con `meta.ausenciaReemplazada: { registroId, nota }`.
4. UI: en la tarjeta de ausencia, el botón principal es **«Llegó: marcar entrada»** y el
   secundario es «Deshacer ausencia».

**Arnés.**
- Ausencia manual + flag → 200 con un PATCH que lleva los filtros.
- Ausencia + sin flag → 409 con el mensaje nuevo.
- Registro no manual + flag → 409.
- PATCH `[]` → 409.
- Período cerrado → 400.
- UI: la tarjeta de ausencia muestra ambos botones, y «Llegó» envía `reemplazarAusencia: true`.

**Criterio.** Quien llega tarde después de haber sido marcado ausente queda en jornada con un
solo toque.

### M-8 · Salida sospechosamente corta (S)

**Evidencia.** No hay ningún límite: una salida a los 20 s de la entrada se guarda como jornada
completa de casi 0 h. Con M-4, después de marcar la entrada, el botón grande de la misma tarjeta
pasa a ser «Marcar salida» en la misma posición, así que un doble toque marca las dos.

**Fix.**
1. UI: si `ahora − hora_entrada < UMBRAL` (D-3), el primer toque en «Marcar salida» no envía
   nada. Cambia el botón a «¿Salida tras 3 min? Toca otra vez» durante 4 s.
2. Servidor: sin bloqueo duro (puede ser real), pero registra `meta.jornadaCorta: true` en la
   auditoría de `MARCAR_SALIDA` para poder revisarla.
3. Después de marcar la entrada, el botón de salida de esa tarjeta queda inactivo 1,5 s, para
   absorber el doble toque.

**Arnés.**
- Con temporizadores falsos, entrada hace 2 min → el primer clic no llama a `salida` y el
  segundo sí.
- Entrada hace 2 h → el primer clic llama.
- Servidor: salida a < UMBRAL → la auditoría incluye `jornadaCorta`.

**Criterio.** Un doble toque no puede cerrar una jornada.

### M-9 · Un solo canal de error (XS)

**Evidencia.** Los hooks llaman a `showToast.error` en `onError` (`useNominaMarcaje.js:25,40,53,
66`; `useNomina.js:438`) y además el panel pinta `errorAccion` en un banner (`:343-347`). El
mismo mensaje aparece dos veces.

**Fix.** Para las acciones del panel, mantener el banner inline: queda junto a la lista y permite
«Reintentar» (M-3). Los hooks aceptan `{ silenciarErrores: true }`, o bien el panel pasa su
propio `onError` a `mutateAsync`. Antes de quitar el toast globalmente, revisar con
`grep useMarcarAusencia` los demás usos.

**Arnés.** Una entrada que falla → `showToast.error` **no** se llama, y el banner sí aparece.

---

## FASE 3 — Jerarquía, información y copy (tercer PR)

### M-10 · Una acción principal por tarjeta (S)

**Fix.** En `TarjetaMarcaje`:

| Estado | Principal (grande) | Secundarias |
|---|---|---|
| Sin entrada | Marcar entrada | «Marcar ausente» como botón contorneado, separado 8 px y más bajo |
| Día libre | Marcar entrada (vino) | — |
| En jornada | Marcar salida | Botón «Más acciones ▾» (disclosure accesible, no dropdown flotante) → «Corregir hora» · «No vino — …» |
| Completa | — | «Corregir marcaje» |
| Ausencia | Llegó: marcar entrada | «Deshacer ausencia» |

El disclosure usa `aria-expanded` y `aria-controls`, y abre la lista en línea dentro de la
tarjeta (nada de portales), con objetivos de ≥ 44 px (G-10).

**Arnés.**
- En «En jornada» solo se ve un botón principal y «Más acciones». Al abrirlo aparecen las dos
  acciones.
- `aria-expanded` cambia de valor al abrir y cerrar.
- `test:responsive` está en verde.

### M-11 · Tiempo en jornada y retraso (S)

**Fix.**
1. En jornada: «En jornada · 2 h 15 min», calculado con la hora operativa (America/Caracas, igual
   que `fechaOperativa.js`) y refrescado cada 60 s con un solo intervalo en el panel, no uno por
   tarjeta.
2. Sin entrada: «Entra 7:00 AM» y, si pasó la tolerancia (D-4), «Retraso 25 min» en ámbar. La
   fuente es `empleado.hora_inicio` (ya llega en `/config-empleados`,
   `nomina.empleados.js:86`). Si en el futuro se expone la hora por día de `nomina_horarios`,
   esa tiene prioridad.
3. Solo informativo: **no** cambia el cálculo de nómina (G-12).

**Arnés.** Con temporizadores falsos y la hora fija:
- Entrada 08:00 a las 10:15 → muestra «2 h 15 min».
- Pendiente con `hora_inicio` 07:00 a las 07:25 y tolerancia de 10 → «Retraso 25 min».
- Sin `hora_inicio` → no muestra ninguna de las dos líneas.

### M-12 · Copy (XS)

- «Anular entrada y marcar ausente» → «No vino — marcar ausente» o «No vino — anular entrada»
  (M-1).
- Modal: usar `nombre` capitalizado (`:536` usa el nombre crudo).
- Toasts: «Entrada de Omar Patti · 7:58 AM», «Salida de Alejandra Hidalgo · 5:02 PM (8,1 h)». Los
  datos salen del `registro` que devuelve el servidor.
- «Corregir marcaje» → «Corregir hora» dentro de «Más acciones».

**Arnés.** Las aserciones de texto se actualizan en `MarcajeLogisticaPanel.test.jsx` y
`TarjetaMarcaje.test.jsx`.

---

## FASE 4 — Accesibilidad (puede ir con la Fase 3)

### M-13 · El nombre accesible contiene el texto visible (XS)

**Evidencia.** Visible: «Marcar ausente» → `aria-label`: «Marcar ausencia de hoy para…» (`:432`).
Lo mismo pasa con «Anular…» (`:493`).

**Fix.** Seguir el patrón `aria-label="<texto visible> — <nombre>"`, o quitar el `aria-label` y
añadir el nombre como `<span className="sr-only">`.

**Arnés (guardarraíl permanente).** Un test que recorre **todos** los `button` del panel
renderizado en cada estado y comprueba que el nombre accesible incluye el texto visible
(normalizando mayúsculas y acentos). Cualquier botón nuevo queda cubierto automáticamente.

### M-14 · Una sola región viva (XS)

**Fix.** Quitar `role="status"` de cada tarjeta (`:385`). Añadir un único
`<p aria-live="polite" className="sr-only">` en el panel que anuncie la última acción
(«Entrada de Omar Patti marcada a las 7:58 AM»).

**Arnés.** El panel tiene exactamente un elemento con `aria-live` y ningún `role="status"` dentro
de `role="list"`. Al marcar, ese elemento contiene el anuncio.

---

## Decisiones pendientes (las define el dueño del producto antes de cada fase)

| ID | Pregunta | Propuesta por defecto |
|---|---|---|
| D-1 | Plazo para «Deshacer» entrada/salida (M-6) | 120 s |
| D-2 | Filtro inicial del panel (M-5) | «Pendientes» si hay pendientes; si no, «En jornada»; si no, «Todos» |
| D-3 | Umbral de salida sospechosa (M-8) | 15 min |
| D-4 | Tolerancia para mostrar «Retraso» (M-11) | 10 min |
| D-5 | En día libre, ¿anular entrada **elimina** el registro (propuesta) o lo deja como «no laborado» visible? | Eliminar, con auditoría completa |

---

## Orden de ejecución y verificación

| PR | Contenido | Rama sugerida |
|---|---|---|
| 1 | Fase 0 + Fase 1 (M-0, M-1, M-2, M-3) | `nomina/marcaje-integridad` |
| 2 | Fase 2 (M-4 … M-9) | `nomina/marcaje-flujo-operativo` |
| 3 | Fases 3 y 4 (M-10 … M-14) | `nomina/marcaje-jerarquia-a11y` |

Para cada PR:
1. Escribir **primero** las pruebas del hallazgo y verlas fallar contra el código actual. En M-1
   y M-2 esto demuestra que el bug existía. Anotar la salida en la bitácora.
2. Implementar el fix.
3. Correr `npm run verify` (check:project, test:qa, test:responsive, lint, deterministic, test,
   test:db, build, bundle-size).
4. En staging: `npm run test:staging:smoke` y `npm run test:staging:concurrency` con los casos
   nuevos de M-1 y M-2.
5. Aceptación manual en el móvil (`docs/ACEPTACION_IPHONE_FISICO.md`): marcar 5 entradas
   seguidas, provocar un doble toque, deshacer, anular en un día libre y «Llegó» desde una
   ausencia.
6. Anotar la entrada en `docs/BITACORA_PROYECTO.md` con las cifras de `verify` antes y después.

## Estado de implementación

### PR 1 (rama `nomina/marcaje-integridad`, 17/11/2026): M-0 … M-3 implementados

Se escribió cada prueba antes del fix y se vio fallar contra el código anterior:

| Hallazgo | Prueba en rojo antes del fix | Resultado |
|---|---|---|
| M-0 | — (caracterización: los 14 tests del panel, sin tocar aserciones) | Panel 565 → 342 líneas; `marcaje/TarjetaMarcaje.jsx`, `marcaje/AnularEntradaModal.jsx`, `marcaje/marcajeEstado.js` (+ `marcajeEstado.test.js`) |
| M-1 | 8 casos nuevos en `nomina.ausencia.test.js`; en día libre o feriado no laborable el servidor respondía **400** | El servidor decide `ausencia` o `sin-registro` y exige `resultadoEsperado` (por defecto `ausencia`); DELETE condicional y auditoría `ANULAR_ENTRADA_SIN_REGISTRO`. La UI muestra «Anular entrada (no vino)» en esos días |
| M-2 | 3 casos en `nomina.marcaje.test.js`; con el PATCH vacío el handler respondía **200** sin detectar el choque | PATCH con `filtroIgual` (`nomina.shared.js`) + `hora_salida=is.null`; 409 con la hora ganadora o 200 idempotente si la ganadora es la misma clave |
| M-3 | 2 casos en `useNominaMarcaje.test.jsx`: el hook **ignoraba** la clave recibida | Clave generada al hacer clic (`src/hooks/idempotencia.js`); «Reintentar» solo tras un corte de red y con la misma clave |

Desvíos respecto al plan:
- No se añadió el alias `POST /api/nomina/marcaje/anular-entrada`: la ruta existente basta y se agregó al arnés de `worker.e2e.test.js`, donde faltaba.
- No se tocó `scripts/test-staging-smoke.mjs` ni `test-staging-concurrency.mjs`. Los casos de staging de M-1 y M-2 quedan pendientes para la aceptación en staging.

## Fuera de alcance

- Cambiar el motor de liquidación o las reglas de pago (G-12).
- Marcaje por el propio empleado (PIN o QR) o geolocalización.
- Edición de días pasados desde el panel de hoy (sigue en Asistencia / Manual).
- Exponer la hora de inicio por día de `nomina_horarios` al cliente (M-11 usa `hora_inicio` de la
  configuración; queda como mejora posterior).
