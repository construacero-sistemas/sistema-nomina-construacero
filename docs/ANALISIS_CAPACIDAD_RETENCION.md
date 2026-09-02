# Análisis de Capacidad — Plan gratuito de Supabase y Purga Inteligente

**Fecha:** 02/09/2026
**Objetivo:** determinar si el sistema puede guardar 3 meses de datos sin colapsar en el tier gratuito de Supabase y, en su caso, diseñar un sistema de purga inteligente.

---

## 1. Límites del plan gratuito (relevantes)

El proyecto usa **un solo proyecto Supabase** compartido por **todos los negocios** (multi-tenant, cada negocio es una `cuenta_id`). Los límites del tier gratuito de Supabase son:

| Recurso | Límite | Qué significa para este sistema |
|---|---|---|
| **Base de datos** | 500 MB | Se comparte entre TODOS los tenants. Es el cuello de botella real a largo plazo. |
| **Egress de BD** | 5 GB/mes | Transferencia saliente del Postgres al Worker/browser. A escala de este sistema sobra. |
| **Archivos (Storage)** | 1 GB | No usado para datos operativos. |
| **Usuarios activos** | 50.000/mes | No es un problema aquí. |

**Conclusión crítica:** el límite que obliga a pensar en purga es **500 MB de BD compartida**, no el egress. El egress ya está mitigado con `finanzas_resumen` (agregado server-side), el cache de egress (`egressCache`) y la paginación a 100 filas.

---

## 2. ¿Cabrán 3 meses de datos?

### Volumen por tabla (estimación para un negocio típico)

| Tabla | Crecimiento | Filas/mes (ej. 20 empleados) | Estimación 3 meses |
|---|---|---|---|
| `registro_asistencia` | 1 fila por empleado por día | ~600 | ~1.800 filas |
| `finanzas_movimientos` | 1 fila por movimiento financiero | ~60 | ~180 filas |
| `nomina_lineas` | 1 fila por empleado por período | ~80 | ~240 filas |
| `nomina_linea_conceptos` | ~4 por línea | ~320 | ~960 filas |
| `nomina_tasas_snapshot` | 1 por día por moneda | ~30 | ~90 filas |
| `auditoria` | 1 fila por acción | ~300 | ~900 filas |
| `clientes` | fija | — | estable |

Con ~1.000–2.000 filas/mes por negocio y un tamaño de fila típico de 300–600 bytes (incluyendo índices), el volumen por negocio en 3 meses es del orden de **1–2 MB**. **Incluso con 20 negocios activos, 3 meses ocupan ~20–40 MB** — menos del 10% de los 500 MB. **Sí, 3 meses caben con holgura.**

### El problema real no es 3 meses, es el crecimiento indefinido

- Cada mes se acumulan filas **para siempre**: 500 MB se agotan cueste lo que cueste con el tiempo.
- La tabla **`registro_asistencia` es la que más crece** (1 fila por empleado por día). Es "datos derivados": su valor ya quedó consolidado en las líneas de nómina.
- Los **tenants abandonados** ocupan espacio eternamente sin generar valor.

La purga inteligente resuelve exactamente esto: **mantiene una ventana deslizante** y elimina los datos derivados antiguos, dejando intactos los contables.

---

## 3. Diseño de la purga inteligente

### 3.1 Regla de oro: proteger la contabilidad

Nunca se borran registros contables/legales. El propio esquema ya lo impone (`finanzas_movimientos` solo se anula, no se borra; la migración 221).

**Se conservan siempre:**
- `finanzas_movimientos` (libro de ingresos/egresos; solo se anulan).
- `nomina_lineas` y `nomina_linea_conceptos` (recibos calculados, fuente legal).
- `nomina_periodos` (períodos y estados de cierre).

**Sí se purgan (datos derivados de alto volumen):**
1. `registro_asistencia` — detalle diario por empleado, una vez consolidado.
2. `nomina_tasas_snapshot` — snapshots de conversión históricos no vinculados a un período activo.
3. `auditoria` — log de auditoría antiguo (puro bitácora).

### 3.2 Salvaguarda de recálculo (protección de flujo de negocio)

El handler `handleCalcularPeriodo` **relee `registro_asistencia`** para cualquier período **abierto**, y un período **cerrado (no pagado) puede reabrirse y recalcularse**. Por eso **la purga nunca borra asistencia ni snapshots dentro del rango de un período `abierto` o `cerrado`**. Solo purga lo que queda **fuera** de esos períodos (p. ej. asistencia de períodos ya `pagados` o históricos sin período).

### 3.3 Ventana de retención configurable

- Columna `configuracion_negocio.retencion_meses` (default **3**, rango 1–36).
- La purga conserva ese número de meses y borra lo anterior.

### 3.4 Ejecución en dos modos

- **Dry-run (simulación):** devuelve los conteos que se borrarían, sin borrar nada. Uso en la UI mediante el botón "Simular".
- **Real:** ejecuta los borrados en el servidor mediante la función `retencion_purga` (nunca descarga filas al Worker → egress ≈ 0).

### 3.5 Disparadores

- **Manual:** botón en la pestaña "Almacenamiento" de Configuración (solo rol administración).
- **Cron:** trigger de Cloudflare Workers que corre el 1º de cada mes a las 03:20 (America/Caracas) y ejecuta `retencion_purga_todos` (barrido global, en modo real).

### 3.6 Trazabilidad

Cada ejecución (manual o cron, simulación o real) se registra en la tabla **`purga_log`** con cuenta, disparador, ventana, cutoff, resumen JSON y total de filas borradas. La UI muestra los últimos logs.

---

## 4. Componentes implementados

| Componente | Archivo | Rol |
|---|---|---|
| Migración | `supabase/migrations/227_retencion_purga.sql` | columna `retencion_meses`, tabla `purga_log`, funciones `retencion_purga` y `retencion_purga_todos` |
| Handler | `server/handlers/retencion.js` | `GET /api/retencion`, `POST /api/retencion/purgar`, `POST /api/retencion/configurar` |
| Rutas | `worker.js` | registro de rutas + TTL cache + `scheduled()` para cron |
| Trigger | `wrangler.toml` | `[triggers] crons = ["20 3 1 * *"]` |
| UI | `src/components/nomina/RetencionCard.jsx` | tarjeta "Almacenamiento y retención" con meses, simular/ejecutar y últimos logs |
| Tests | `server/handlers/__tests__/retencion.test.js` | 7 pruebas (estado, dry-run, real, validación, permisos, configurar) |

---

## 5. Resultados

- **Sí, 3 meses caben sin problemas** en el tier gratuito para un volumen realista de negocios. El riesgo real es el crecimiento indefinido, no 3 meses.
- La purga inteligente **mantiene la base delgada con una ventana deslizante**, protege todos los datos contables y respeta el flujo de recálculo de períodos.
- La purga se ejecuta **server-side** (egress ≈ 0) y es **100% auditable** vía `purga_log`.
- La UI permite **simular antes de ejecutar** y configurar la ventana de retención.

## 6. Pasos pendientes de despliegue

1. **Aplicar la migración 227** en Supabase (`supabase db push` o el SQL editor) — hasta entonces la pestaña "Almacenamiento" muestra el error "no se encontró la función", porque el RPC aún no existe en la base remota.
2. Verificar que `wrangler.toml` tenga el trigger cron con permisos (requiere plan que permita triggers en Cloudflare; el plan gratuito de Cloudflare lo permite).
3. Revisar que la columna `retencion_meses` esté presente en `configuracion_negocio` (la añade la migración 227).
