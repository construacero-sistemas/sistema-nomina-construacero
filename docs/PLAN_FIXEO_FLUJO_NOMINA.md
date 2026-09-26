# PLAN_FIXEO_FLUJO_NOMINA

Plan maestro derivado de la auditoría del flujo de Nómina del 2026-09-26 (lectura de 20
archivos, simulación del motor de liquidación y una prueba de componente temporal). Objetivo:
**que el dinero que se liquida corresponda a lo que de verdad pasó en el reloj, y que la
interfaz no afirme algo distinto de lo que el servidor va a guardar.**

Cada hallazgo lleva evidencia (archivo:línea), fix, guardrail, tests y criterio de aceptación.
Al cerrar cada fase: `npm run verify` + entrada en `docs/BITACORA_PROYECTO.md`.

Estado base (26/09/2026, antes de este plan): `lint` limpio · `npm test` **104 archivos / 1103
pruebas** · `test:nomina-deterministic` 28/28 · `test:finanzas-deterministic` 125 aserciones ·
`test:qa` 22/22 · `test:responsive` 41/41 · `test:bundle-size` PASS · `build` OK ·
`check:project` OK. **Ninguno de esos gates detecta los hallazgos de abajo**: el más grave
(el contrato horas/ausencia) es invisible hoy por un campo que la consulta no pide.

## Resumen de hallazgos

| # | Sev. | Hallazgo | Archivo clave | Tamaño |
|---|---|---|---|---|
| F-1 | **Crítico** | El motor cambia de resultado según un campo que el handler no pide; la jornada abierta se paga como día completo con 0 h | `server/lib/nominaUtils.js:120`, `server/handlers/nomina.periodos.js:92` | M |
| F-2 | **Alto** | El guardarraíl de egress no protege en Windows y `nominaHorarios.js` lo viola (romperá CI) | `scripts/check-project.mjs:458`, `server/lib/nominaHorarios.js:70` | S |
| F-3 | **Alto** | Dos fuentes de verdad para «días/semana»: el salario semanal puede pagarse a 5/6 | `src/components/nomina/EmpleadoConfigModal.jsx:180` | S |
| F-4 | Medio | El filtro «Registrados» muestra personas en su día libre (contador 1, tarjetas 2) | `src/components/nomina/AsistenciaDiariaMovil.jsx:81` | XS |
| F-5 | Medio | El sábado de quien SÍ trabaja se pinta igual que un día libre | `src/components/nomina/TabAsistencia.jsx:446` | S |
| F-6 | Medio | El reloj real y la vista diaria ignoran el calendario de feriados | `MarcajeLogisticaPanel.jsx`, `server/handlers/nomina.horarios.js:156` | M |
| F-7 | Medio | Guardar la semana laboral no es atómico: un fallo del insert deja a la persona con el horario histórico | `server/handlers/nomina.horarios.js:81-84` | M |
| F-8 | Medio | Las horas por día configuradas no se usan como valores por defecto en ningún modal (siguen 08:00–17:00 y «medio sábado 13:00») | `AsistenciaModal.jsx:27`, `AsistenciaMasivaModal.jsx:32` | M |
| F-9 | Bajo | `diasLaborablesResueltos` ignora `fecha_desde`: un horario futuro se aplica ya, y el editor puede borrarlo | `server/lib/nominaHorarios.js:32` | S |
| F-10 | Bajo | «Manual nómina» permite marcar ausencia en día libre o feriado, sin aviso | `server/handlers/nomina.registro.js` | S |
| F-11 | Bajo | `handleGetAsistencia` trunca en 500 filas sin avisar (≈71 empleados en una semana) | `server/handlers/nomina.asistencia.js:42` | S |
| F-12 | Bajo | Copy del monto fijo de feriado: el campo dice «por feriado», la explicación y el motor dicen «trabajado» | `src/components/nomina/TabConfiguracion.jsx:260` | XS |
| F-13 | Bajo | El grid móvil calcula «hoy» con la zona del navegador; el panel y el servidor usan America/Caracas | `src/components/nomina/TabAsistencia.jsx:117` | XS |

---

## FASE 1 — Que el dinero cuadre (P1, bloquea el cálculo)

### F-1 · Contrato horas ↔ ausencia ↔ jornada abierta

**Evidencia.** `handleCalcularPeriodo` pide `…es_feriado,es_ausencia` pero **no
`horas_trabajadas`** (`nomina.periodos.js:92`). El motor decide con
`tieneHorasExplicitas = a.horas_trabajadas !== undefined && a.horas_trabajadas !== null`
(`nominaUtils.js:120`) y, si es `false`, cae en `horasTrabajadas = horas_normales + horas_extra`.
Medido ejecutando el motor con las tres variantes de la misma fila:

```
sin horas_trabajadas (lo que llega hoy): { dias: 1, horas: 0, bruto: 10 }
con horas_trabajadas: 0                 : { dias: 0, ausencia: 1, bruto: 0 }
ausencia real                           : { dias: 0, ausencia: 1, bruto: 0 }
```

**Impacto.** (a) Quien marca entrada y olvida la salida cobra el día completo con 0 h en el
recibo («1 día / 0.0 h»); (b) ese día no suma extra ni recargo de sábado porque las horas son 0;
(c) si alguien añade `horas_trabajadas` al select sin tocar el motor —el arreglo más natural—,
**esos días pasan de cobrar el día a cobrar $0 en silencio**. Además
`horasEntradaSalidaValidas` (`nomina.shared.js:51`) acepta entrada y salida vacías, así que el
módulo Manual puede crear un registro de 0 h que hoy se paga como día completo.

**Fix.**
1. `nomina.periodos.js`: añadir `horas_trabajadas,estado_marcaje,hora_entrada,hora_salida` al select.
2. `nominaUtils.calcularLineaNomina`: regla explícita y documentada, sin ambigüedad de campos:
   - `es_ausencia === true` → ausencia (no paga).
   - `estado_marcaje === 'entrada'` o (`hora_entrada` sin `hora_salida`) → **jornada abierta**: se
     cuenta aparte (`diasJornadaAbierta`), **no** como ausencia y **no** como día completo.
   - horas > 0 → día trabajado (regla actual).
   - Eliminar la rama dependiente de la presencia del campo; el resultado no puede depender de
     qué columnas pidió el llamador.
3. `handleCalcularPeriodo`: **409 con el detalle** («N jornadas sin salida: Edgar Ramirez
   22/09, …») antes de generar líneas, con un flag explícito `confirmarJornadasAbiertas: true`
   para el caso «se fue sin marcar»; el operador decide y queda en auditoría
   (`CALCULAR_PERIODO` con `jornadas_abiertas: n`).
4. `handleRegistrarAsistencia`: exigir las dos horas cuando `esAusencia !== true` (cerrar el hoyo
   del registro vacío); la ausencia sigue enviando `null` en ambas.
5. UI: contador/aviso «N marcajes con salida pendiente» en `TabAsistencia` (ya existe el estado
   «En jornada» en el panel) y en el paso previo a calcular de `TabPeriodos`.

**Guardrail.** El motor no recibe más formas de fila: nueva firma documentada en
`nominaUtils.js` y un comentario en el select de `nomina.periodos.js` que apunte al contrato.

**Tests (servidor).** `server/lib/__tests__/nominaUtils.test.js`: jornada abierta no paga día
completo ni cuenta ausencia; fila sin `horas_trabajadas` y fila con `horas_trabajadas: 0` dan el
**mismo** resultado (matriz de formas de fila). `nomina.flujo.test.js` (o `.periodos`): calcular
con una salida pendiente → 409 sin escribir líneas; con el flag → 200 y el conteo en auditoría.
`nomina.asistencia.manual.test.js`: registro sin horas y sin ausencia → 400.

**Criterio.** Calcular un período con una jornada abierta no crea líneas hasta que el operador
confirme; ninguna combinación de columnas presentes cambia el importe de una línea idéntica.

### F-2 · El guardarraíl que no guarda (y el archivo que lo viola)

**Evidencia.** `check-project.mjs:458` usa `path.startsWith('server/')`, pero `walk()` compone con
`path.join`, que en Windows produce `\`: comprobado con nodo, `join('server','lib','x.js')` →
`"server\\lib\\x.js"` y `startsWith('server/')` → `false`. La regla del `select=*` (`:455`) tiene el
mismo defecto. Y `server/lib/nominaHorarios.js:70` usa `&limit=1000`, el patrón que esa regla
prohíbe: hoy pasa **solo** porque no protege en Windows; el primer `check:project` en CI/Vercel
fallará por ese archivo.

**Fix.**
1. Normalizar en las reglas: usar la ruta con `/` (ya existe `pathRol` en el mismo archivo).
2. `fetchFilasHorarioPorEmpleado`: paginar con `Range`/offset en un bucle acotado (o `limit=500`
   con continuación) en vez de `limit=1000`, y documentar el techo.
3. Añadir al arnés una prueba de la propia regla: `scripts/qa-guards.test.mjs` debe comprobar que
   la comprobación de egress detecta una ruta tipo Windows **y** tipo POSIX.

**Guardrail.** `check:project` en verde con un archivo de prueba temporal que contenga
`limit=1000` (verificar que falla de verdad antes de darlo por bueno).

**Criterio.** La regla de egress dispara en Windows y en Linux; ningún handler de `server/` usa
`limit=1000`.

### F-3 · Una sola fuente de verdad para los días de la semana

**Evidencia.** El salario semanal se divide por `diasSemana || 6`
(`EmpleadoConfigModal.jsx:180`, selector 5/6/7 solo visible en modalidad «semana») y los días
reales viven en «Días que trabaja» (`dias_laborables`). Nada los sincroniza: con Lun–Vie marcado
y el selector en 6, el semanal acordado se paga a **5/6** y la ficha no avisa.

**Fix.** Cuando la modalidad sea `semana`, el divisor es **la cantidad de días marcados** en
«Días que trabaja» (una sola fuente); el selector manual se elimina o queda bloqueado con el
valor derivado y un texto «se toma de los días marcados». Si el operador cambia los días, el
monto semanal se conserva y se recalcula el salario/día (ya lo hace `handleCambioModalidad`).
Al guardar, si el número de días es 0, error explícito (ya existe en `EmpleadoConfigModal`).

**Tests.** `EmpleadoConfigModal.test.jsx`: con Lun–Vie y 180 USD/semana, el desglose muestra
$36,00 por día; marcar el sábado recalcula a $30,00; no existe control manual de «días por
semana» que pueda contradecir la semana.

**Criterio.** No hay forma de guardar una ficha cuyo divisor de semana contradiga sus días
marcados.

**Salida de Fase 1:** dos cambios de motor + un guardarraíl; el cálculo deja de depender de
accidentes y la ficha no puede pagar de menos por un control olvidado.

---

## FASE 2 — Que la interfaz no mienta (P2)

### F-4 · «Registrados» no debe incluir días libres (XS)
- **Evidencia:** verificado con prueba de componente — contador «Registrados 1» y **2** tarjetas
  (la manual + una persona en su día libre). El filtro excluye pendientes y faltas pero no libres
  (`AsistenciaDiariaMovil.jsx:81`): condición que quedó sin actualizar al añadir el estado «Día libre».
- **Fix:** `if (filtro === 'registrados' && (fila.libre || fila.pendiente || fila.falta) && !fila.real) return false`.
- **Tests:** `AsistenciaDiariaMovil.test.jsx`: en un jueves con una persona libre y otra con
  horario manual, «Registrados 1» lista **una** tarjeta y el «Día libre» sigue en su propio filtro.

### F-5 · El sábado laborable no debe pintarse como libre (S)
- **Evidencia:** `CeldaAsistencia` decide con `if (libre || esFinde)` cuando no hay registro
  (`TabAsistencia.jsx:446`) y `esFinde` es sábado/domingo para todos. Quien tiene el sábado en su
  semana ve celda gris «Libre» con tooltip de descanso, en vez del «+» de pendiente.
- **Fix:** `esFinde={finde && !trabajaEseDia(emp, fecha)}` en las dos vistas (móvil semanal y
  tabla de escritorio); el color ámbar de la cabecera del día puede quedarse como está.
- **Tests:** con un empleado de Lun–Sáb y otro de Lun–Vie en un sábado: el primero muestra «+»
  (aria-label de registro), el segundo «Libre».

### F-6 · Feriados en el reloj real y en la vista diaria (M)
- **Evidencia:** `MarcajeLogisticaPanel` no consulta `useFeriados` ni recibe feriado alguno: en un
  feriado el resumen dice «Pendientes: 4» y ofrece «Marcar ausente» a todos, mientras la grilla de
  escritorio sí muestra «Feriado». El servidor tampoco lo considera:
  `handleMarcarAusencia` solo bloquea domingo y días no laborables (`nomina.horarios.js:156`).
- **Fix:** `TabAsistencia` ya tiene `feriadosPorFecha`; pasar `feriado` a `MarcajeLogisticaPanel` y a
  `AsistenciaDiariaMovil` para (a) rotular la tarjeta/fila como «Feriado», (b) excluir del conteo de
  pendientes, (c) ocultar «Marcar ausente»; y en el servidor responder 400 en feriado con el mismo
  criterio que «día libre» (el módulo Manual sigue disponible para casos especiales, ver F-10).
- **Tests:** servidor — ausencia en feriado registrado → 400; panel — día feriado sin registros →
  0 pendientes y sin botón de ausencia.

### F-8 · Usar las horas configuradas como valores por defecto (M)
- **Evidencia:** `AsistenciaModal.jsx:27` y `AsistenciaMasivaModal.jsx:32` siguen con 08:00–17:00
  y, en sábado, 08:00–13:00 con descanso 0, más los copys «Sábado Rotativo / Medio Sábado (5h)».
  Si la ficha dice que esa persona trabaja el sábado 08:00–17:00, el modal propone otra cosa.
- **Fix:** precargar entrada/salida/jornada desde el día configurado de esa persona (la semana ya
  está disponible con `useHorarios`); mantener 08:00–17:00 y el 13:00 de sábado **solo** cuando no
  haya semana configurada (`horario_configurado === false`). Ajustar los copys para no dar por
  hecho el medio sábado.
- **Tests:** con semana configurada (sábado 08:00–17:00, 8 h) el modal abre en 08:00–17:00 sin el
  aviso de «Sábado Rotativo»; sin semana, mantiene los valores actuales.

**Salida de Fase 2:** lo que se ve en pantalla coincide con lo que el servidor va a hacer.

---

## FASE 3 — Integridad de la configuración (P2)

### F-7 · Guardar la semana laboral sin pérdida (M)
- **Evidencia:** `handleGuardarHorarioEmpleado` **borra y luego inserta** (`nomina.horarios.js:81`
  y `:84`). Si el insert falla, la persona queda sin filas y el sistema cae al histórico Lun–Sáb:
  su semana se ensancha en silencio. `nomina_horarios` no tiene UNIQUE (la migración 215 solo crea
  índices), así que no hay red de seguridad ni contra duplicados por concurrencia.
- **Fix.**
  1. Invertir el orden: POST del lote nuevo y después `DELETE` de las filas anteriores que no estén
     en el lote (por `id`), o una RPC transaccional si se prefiere atomicidad real.
  2. Migración nueva (`247_nomina_horarios_unico.sql`): índice único parcial
     `(empleado_id, dia_semana) WHERE semana_ciclo IS NULL AND fecha_hasta IS NULL`, **con paso
     previo de limpieza** de duplicados existentes (si los hubiera, la migración falla).
  3. Mensaje de error que diga qué quedó guardado («La semana anterior se conservó; no se cambió
     nada»).
- **Tests:** servidor — con POST fallando (409/500 simulado), la semana anterior sigue intacta y la
  respuesta es 409/500 con ese mensaje; con POST ok y DELETE fallando, la respuesta advierte y no
  duplica en el siguiente intento.

**Salida de Fase 3:** un fallo de red no puede dejar a nadie con una semana distinta de la que
tenía.

---

## FASE 4 — Higiene y detalles (P3)

- **F-9 · `fecha_desde` en la resolución de días (S).** `diasLaborablesResueltos`
  (`nominaHorarios.js:32-36`) filtra por `semana_ciclo`/`fecha_hasta` pero no por vigencia: un
  horario programado a futuro se aplica ya. Fix: considerar solo filas con `fecha_desde <= fecha`
  (pasar la fecha al resolutor) y que el borrado del editor no elimine filas futuras. Tests: fila
  con `fecha_desde` posterior → no cambia los días de hoy; el editor no la borra.
- **F-10 · Aviso en «Manual nómina» (S).** `handleRegistrarAsistencia` no valida días: se puede
  marcar ausencia en día libre o feriado y reaparece la ausencia falsa que este trabajo eliminó.
  Fix: permitir el registro de **horas** en cualquier día (para cargar historia) pero responder 400
  a `esAusencia` cuando el día no le toca, con el mismo mensaje que el reloj real, o exigir
  `confirmarDiaNoLaborable: true` si el negocio quiere forzarlo. Tests: ausencia en día libre → 400.
- **F-11 · Truncado silencioso de asistencia (S).** `limit=500` con `order=fecha.asc`
  (`nomina.asistencia.js:42`): a partir de ~71 empleados en una semana, los últimos días
  desaparecen del grid sin aviso. Fix: paginar hasta agotar (con techo duro) y devolver
  `truncado: true` para que la UI lo diga. Test: 600 filas simuladas → se piden dos páginas.
- **F-12 · Copy del feriado (XS).** `TabConfiguracion.jsx:260` → «Monto fijo por feriado
  trabajado (USD)», alineado con la explicación (`:233`) y con el motor, que solo lo paga si hubo
  registro.
- **F-13 · Fecha operativa en el grid móvil (XS).** `TabAsistencia.jsx:117` usa `iso(new Date())`
  (zona del navegador) mientras el panel y el servidor usan America/Caracas. Fix: extraer el helper
  de fecha operativa (mismo cálculo que `MarcajeLogisticaPanel.fechaOperativaHoy`) a `src/utils` y
  usarlo en ambos.

---

## Decisiones (adoptadas el 26/09/2026)

Las cuatro se resolvieron con la recomendación de este plan; sus consecuencias ya están en el
código (ver «Estado de implementación»). El detalle de cada una queda abajo como registro.

1. **¿Qué hacer con una jornada abierta al calcular?** Este plan propone **bloquear con 409 y
   exigir confirmación**; la alternativa es calcular como día completo (comportamiento actual) con
   un aviso persistente. Lo recomendado evita pagar por accidente, pero añade un paso al cierre.
2. **¿La ausencia en feriado se bloquea?** Propuesto: sí, igual que el día libre, porque nadie está
   obligado a asistir. Si el negocio quiere registrar «no vino aunque era feriado pagado», se abre
   con una nota obligatoria.
3. **¿El divisor del salario semanal se deriva siempre de los días marcados?** Propuesto: sí. La
   alternativa (dejarlo manual) exige mantener el aviso de discrepancia.
4. **¿Los días libres se pagan?** Hoy el modelo es **por día registrado** (un día sin registro no
   paga). Si se acuerdan salarios semanales/mensuales cerrados, eso obliga a dividir por los días
   realmente laborables (F-3) y conviene documentarlo en la ficha del empleado.

## Orden de ejecución y verificación

```
Fase 1 (F-1, F-2, F-3)   ← dinero y guardarraíl; sin dependencias
 └─ Fase 2 (F-4, F-5, F-6, F-8)   ← interfaz; F-6 depende de la decisión 2
     └─ Fase 3 (F-7)   ← integridad; la migración 247 va aparte y con limpieza previa
         └─ Fase 4 (F-9…F-13)
```

- Verificación por fase: `npm run lint`, `npm test`, `npm run check:project`, `npm run test:qa`,
  `npm run test:responsive`, `npm run test:deterministic`, `npm run build`, `npm run test:bundle-size`.
- Recorrido en vivo (Vite 5173 + Wrangler 8788, sin mutar datos reales): reloj real en un día
  laborable, día libre, feriado, y el ciclo Marcar ausente → Deshacer ausencia.
- Cierre de cada fase: entrada en `docs/BITACORA_PROYECTO.md` + sección de estado en este archivo.

## Estado de implementación (2026-09-26): plan completo

| Hallazgo | Estado | Qué quedó |
|---|---|---|
| F-1 jornada abierta | ✅ | El select pide `horas_trabajadas,estado_marcaje,hora_entrada,hora_salida`; el motor cuenta día trabajado / ausencia / jornada abierta (sin pago) y el cálculo responde 409 con la lista hasta `confirmarJornadasAbiertas: true` (auditoría con `jornadas_abiertas`). El registro manual exige entrada **y** salida, o ausencia. Aviso «N marcajes con salida pendiente» en Asistencia y diálogo en Períodos. |
| F-2 guardarraíl en Windows | ✅ | Ruta normalizada una sola vez en `check-project.mjs` (+ prueba del guardarraíl en `qa-guards`); `nominaHorarios.js` pagina de 500 en 500 sin `limit=1000`. |
| F-3 divisor semanal | ✅ | Una sola fuente: los días de «Días que trabaja». Se retiró el selector 5/6/7 de la ficha. |
| F-4 «Registrados» | ✅ | El filtro y el conteo ya no cuentan los días libres. |
| F-5 sábado laborable | ✅ | Cada celda decide con la semana de esa persona. |
| F-6 feriados | ✅ | El reloj real y la vista diaria reciben el feriado; ausencia en feriado no laborable bloqueada en panel y servidor. |
| F-7 guardar semana sin pérdida | ✅ | Escritura por fila (PATCH/POST) antes de retirar días; aviso si el retiro falla; migración **247** (índice único parcial + limpieza). |
| F-8 horas por defecto | ✅ | Modal de día y de lote parten de las horas configuradas; copys de medio sábado sin dar por hecho el 13:00. |
| F-9 vigencia `fecha_desde` | ✅ | Resolutor del servidor, espejo del front y editor filtran la semana vigente. |
| F-10 aviso en «Manual nómina» | ✅ | Ausencia en día libre o feriado no laborable → 400; las horas se pueden cargar en cualquier fecha. |
| F-11 truncado de asistencia | ✅ | Lectura paginada (500 × 20 con techo) y respuesta `{ registros, truncado }`; la vista avisa si el rango quedó corto. |
| F-12 copy del feriado | ✅ | «Monto fijo por feriado trabajado (USD)». |
| F-13 fecha operativa | ✅ | `src/utils/fechaOperativa.js` (America/Caracas) en reloj real, vista diaria y grilla semanal. |

**Verificación (26/09/2026):** `lint` limpio · `npm test` **111 archivos / 1158 pruebas** ·
`test:nomina-deterministic` 28/28 · `test:finanzas-deterministic` 125 aserciones · `test:qa` 23/23 ·
`test:responsive` 41/41 · `test:bundle-size` PASS · `build` OK · `check:project` OK (41 migraciones).
Bitácora: entrada #122.

**Pendiente:** aplicar las migraciones **246** y **247**, y el recorrido en vivo del reloj real
(día laborable, día libre, feriado) y del cálculo con jornadas abiertas usando el operador real.

## Verificación de que el plan hizo falta

Antes de empezar, dejar constancia de los dos casos reproducibles, porque ninguno lo cubre la
suite actual:

```bash
# F-1: el resultado cambia según el campo que el handler no pide
node -e "import('./server/lib/nominaUtils.js').then(({calcularLineaNomina})=>{const c={salario_dia_usd:10,horas_jornada:8};const n={nomina_factor_sabado:1.25,nomina_factor_feriado:2,nomina_feriado_modo:'factor'};const f={horas_normales:0,horas_extra:0,es_ausencia:false,es_sabado:false,es_domingo:false,es_feriado:false};console.log(calcularLineaNomina([f],c,n).total_bruto_usd, calcularLineaNomina([{...f,horas_trabajadas:0}],c,n).total_bruto_usd)})"
# → 10 0   (misma fila, distinto pago)

# F-2: la regla de egress no coincide con la ruta real en Windows
node -e "const {join}=require('path');console.log(join('server','lib','x.js'), join('server','lib','x.js').startsWith('server/'))"
# → "server\\lib\\x.js" false
```

## Fuera de alcance de este plan

- El motor financiero y sus RPC (migraciones 237–241) más allá de la idempotencia ya verificada.
- Importación y pago de comisiones POS (`nomina.comisiones.js`, `ImportarComisionesPosModal`):
  **no auditado**; merece su propia pasada.
- La matriz de capacidades (`server/lib/permissions.js`) y los gates UI ↔ servidor: auditados y en
  verde (plan `docs/PLAN_ALINEACION_CAPACIDADES_UI.md`).
- Migración 246 (`controla_asistencia`): sigue sin aplicar en la base; el respaldo
  `fetchConfigsConControl` cubre el hueco, y el aviso de «línea en $0» ya existe en
  `ControlAsistenciaToggle`.
