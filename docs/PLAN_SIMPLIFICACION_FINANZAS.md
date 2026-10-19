# Plan: Finanzas simple — gasto y ganancia por mes, con carteras y apertura/cierre ligera

Objetivo del usuario: saber el gasto y la ganancia de cada mes a detalle, de forma sencilla e intuitiva; conservar las carteras para ver cuánto se gasta de cada cuenta; tener apertura y cierre de control **sin excesos** y con el mínimo cambio sobre lo que ya existe.

---

## 1. Criterios de éxito

1. En menos de 10 segundos se responde: ¿cuánto entró?, ¿cuánto salió?, ¿cuánto gané?, ¿en qué se fue?, ¿de qué cuenta salió?
2. Abrir y cerrar el mes toma menos de 2 minutos, con conteo físico opcional y diferencias (faltante/sobrante) registradas con motivo.
3. Registrar un gasto o ingreso toma 5 campos.
4. Cero cambios destructivos: tablas, histórico, permisos y demás módulos intactos.

## 2. Alcance

### Lo que NO cambia
- **Esquema**: `finanzas_movimientos`, `cuentas_custodia`, `finanzas_periodos_mensuales` y `finanzas_periodos_mensuales_cuentas` quedan como están. Los campos de diferencia (`diferencia_apertura`, `motivo_apertura`, `diferencia_cierre`, `motivo_cierre`, `saldo_contado_*`) ya existen: **no se necesita ninguna migración de datos**.
- **Permisos**: la matriz única (`server/lib/permissions.js` + espejo SQL) sigue igual. Abrir/cerrar mes sigue siendo de jefe/finanzas; registrar movimientos, de quien opera.
- **Libro de movimientos, categorías, sync POS y nómina**: intactos.
- **Protección contra duplicados exactos** (`FINANCIAL_DUPLICATE_EXACT`): se mantiene, es seguridad real contra doble registro.

### Lo que sí cambia (resumen)
- 3 reglas SQL que hoy traban el control diario (ver §4).
- 2 correcciones de seguridad/uso detectadas en la auditoría (ver §4.6 y §4.7).
- 1 pantalla nueva (portada "Mes a mes") y el flujo de apertura/cierre de 2 pasos (ver §3).

## 3. Experiencia propuesta

### 3.1 Portada "Mes a mes" (pantalla principal de Finanzas)
- Cabecera: selector de mes y tres números grandes — **Ingresos**, **Gastos**, **Ganancia** (ingresos − gastos) — en USD, con el detalle por moneda debajo.
- Bloque **Por categoría**: gastos e ingresos agrupados por categoría, cada fila expandible a los movimientos del mes (fecha · concepto · monto).
- Bloque **Por cuenta**: cuánto entró y cuánto salió de cada cartera en el mes, y su saldo de cierre. (Este es el dato que el usuario pidió: gasto mensual por cuenta.)
- Gráfico de barras simple: ingresos vs gastos del mes.
- Botón **+ Movimiento** con 5 campos (tipo, fecha, categoría, concepto, monto) más la cuenta.

### 3.2 Apertura simple (2 pasos)
- **Paso 1 — "Abrir mes"**: un clic. Arrastra el saldo de cierre del mes anterior por cuenta (en el primer mes, saldo inicial editable). El servidor arma la lista de cuentas; el usuario no llena nada más.
- **Paso 2 — "Contar dinero" (opcional)**: por cuenta, el saldo contado y, si difiere del que dice el sistema, un motivo (8–300 caracteres). Se permiten **faltantes y sobrantes**.
- Una sola apertura por mes, idempotente por clave de operación (ya funciona así en el SQL).

### 3.3 Cierre simple (2 pasos)
- **Paso 1 — "Cerrar mes"**: tabla cuenta por cuenta con saldo de libro vs saldo contado (por defecto el contado = libro). Si difiere, motivo obligatorio.
- **Paso 2 — "Confirmar"**: fija el saldo real de cierre; el mes siguiente arranca desde ahí.
- Restricciones que se conservan (seguridad barata): solo se cierra el mes anterior y solo pasado su último día; el mes cerrado no se reedita.

## 4. Cambios de reglas (aquí vive todo el cambio de comportamiento)

Objetos: `public.finanzas_operar` y `public.finanzas_guard_movimiento` en `supabase/migrations/253_finanzas_periodos_mensuales.sql`, `238_operaciones_financieras_atomicas.sql` y `251_finanzas_duplicate_guard.sql`.

| # | Regla actual | Nueva regla | Dónde |
|---|---|---|---|
| 4.1 | `'Opening balance cannot reduce confirmed funds'` (PT409) prohíbe abrir con menos dinero del que dice el cierre anterior | Se permite; la diferencia negativa queda en `diferencia_apertura` con `motivo_apertura` (faltante) | 253, rama `aperturar` |
| 4.2 | `'Closing balance cannot reduce confirmed funds'` (`IF diff<0`) prohíbe cerrar con faltante | Se permite; queda en `diferencia_cierre` con `motivo_cierre`; el mes siguiente arranca con `saldo_cierre_real` | 253, rama `cerrar` |
| 4.3 | El payload debe traer las dos tasas congeladas o la operación falla | Si el cliente no manda tasas, el servidor toma la del día; si las manda, se respetan (override). La congelación al abrir/cerrar **se mantiene** para trazabilidad de la valoración USD | 253, ramas `aperturar`/`cerrar` |
| 4.4 | `'Every active wallet must have a monthly opening before close'` | El cierre genera el alta automática (`alta_cuenta`, con saldo calculado) de las cuentas que falten | 253, rama `cerrar` |
| 4.5 | `'Reconcile movements without a custody wallet before opening the month'` bloquea la apertura por partidas viejas sin cuenta | Se convierte en **aviso** en el paso de cierre (el guard de alta ya exige cuenta desde `server/handlers/finanzas.js`, así que solo quedan huérfanos históricos) | 253, rama `aperturar` |
| 4.6 | **Fallo de la auditoría**: un reintento con la misma clave y **datos distintos** devuelve éxito del movimiento anterior sin comparar nada | Si la clave existe y los datos difieren → 409 explícito ("la operación previa es distinta"), nunca éxito silencioso. Los períodos ya lo hacen bien por hash; se replica esa lógica | `server/handlers/finanzas.js:173-177` y `263-266`; `server/handlers/finanzas.sync.js:63-67` (hoy solo compara estado y moneda) |
| 4.7 | **Fallo de la auditoría**: en efectivo el selector de cuenta nunca se renderiza; con dos cajas del mismo método no hay forma de elegir y el envío queda bloqueado sin salida | El selector se muestra siempre que haya más de una cuenta compatible (incluye cajas); solo se auto-elegirá con exactamente una | `src/components/finanzas/MovimientoForm.jsx` (render `!esEfectivo`, ~línea 431; auto-selección, líneas ~46 y ~122) |

Reglas que **se mantienen a propósito**: apertura/cierre idempotentes por clave+hash; `'Previous month must be closed first'`; `'Only the previous month may be closed'`; `'Month can only close after its last day'`; motivo 8–300 caracteres para toda diferencia; importes ≥ 0 y no nulos.

## 5. Seguridad requerida (sin excesos)

### Se mantiene
1. **Aislamiento por cuenta de negocio**: `accountFilter`/`cuenta_id` en todas las lecturas y escrituras; ninguna consulta confía en IDs del cliente.
2. **Roles**: abrir/cerrar mes solo jefe o finanzas (contextos `operarContext`/`adminContext` existentes).
3. **Trazabilidad**: cada apertura, cierre y alta de cuenta ya escribe en `auditoria` con usuario, rol e IP; toda diferencia exige motivo de 8–300 caracteres.
4. **Idempotencia fuerte** clave+hash (períodos ya la tienen; movimientos se corrige en 4.6).
5. **Mes cerrado inmutable**: las correcciones pasan por anular/revertir movimientos, que ya existe y ya audita.
6. **Validación de importes en servidor**: ≥ 0, no nulos, límites de motivo.

### Se retira (excesos que hoy solo generan trabas)
1. El bloqueo "no reducir fondos confirmados" en apertura y cierre: impide registrar faltantes, que es la realidad del negocio.
2. Exigir congelar manualmente dos tasas por mes desde el wizard: se toma la del día.
3. Exigir apertura explícita de cada cuenta antes de poder cerrar: se completa sola.
4. Exigir al usuario la lista completa de cuentas en el payload de apertura: la arma el servidor (se mantiene compatibilidad: si el payload trae lista, se valida igual).
5. El wizard multi-paso con validaciones cruzadas: se reemplaza por el flujo de 2 pasos de §3.

## 6. Migración y despliegue

- **`supabase/migrations/254_finanzas_apertura_cierre_simple.sql`**: `CREATE OR REPLACE` de `finanzas_operar` con las reglas 4.1–4.5. Mantiene la firma y el contrato `finanzas_periodo_mensual_estado`; **no toca tablas ni datos**. Copia literal de la versión anterior al pie del archivo para rollback (misma firma: basta re-ejecutarla).
- Correcciones 4.6–4.7 en el worker y en el componente (sin migración).
- **Despliegue**: migración primero, UI después, en el mismo release (la UI nueva espera las reglas nuevas).
- **Rollback**: restaurar la función de 253 y volver al wizard anterior; ningún dato queda inservible.

## 7. Pruebas y criterios de aceptación

Nuevos casos en `scripts/test-db.mjs` (PGlite, corre con `npm run test:db`):
1. Apertura con faltante + motivo → OK, `diferencia_apertura` negativa registrada.
2. Apertura con diferencia sin motivo → PT400 (se mantiene).
3. Cierre con faltante + motivo → OK, `diferencia_cierre` negativa y el mes siguiente arranca con el saldo real.
4. Cierre auto-alta de cuenta sin apertura previa → OK.
5. Reintento de apertura con misma clave y datos distintos → PT409 (se mantiene).
6. Movimiento: misma clave y datos distintos → 409 (nuevo; hoy devuelve éxito).

Nuevos casos en vitest (`src/components/finanzas/__tests__/`):
7. Portada: totales del mes, bloque por categoría y bloque por cuenta.
8. Apertura en 2 pasos, con y sin conteo físico.
9. Cierre con faltante exige motivo y confirma una sola vez.
10. Selector de cuenta visible con dos cajas del mismo método (4.7).

Regresión obligatoria: `npm run verify` completo en verde (check:project, qa, responsive, lint, determinista 125 aserciones, vitest, test:db 37+6, build, bundle). Recorrido manual en navegador con un mes de ejemplo que incluya un faltante, documentado en `docs/ACEPTACION_MANUAL_E2E.md` al estilo del existente.

## 8. Fases de entrega

| Fase | Contenido | Esfuerzo |
|---|---|---|
| F1 | Migración 254 con reglas 4.1–4.5 + casos SQL 1–6 + corrección 4.6 (idempotencia) | ~1 sesión |
| F2 | Portada "Mes a mes" (totales, por categoría, por cuenta, gráfico) consumiendo `finanzas_resumen` y el libro actual | ~1 sesión |
| F3 | Apertura/cierre de 2 pasos (reemplaza el wizard, reutiliza `finanzas_operar`) | ~1 sesión |
| F4 | Corrección 4.7 (selector de cuentas), ocultar de la UI lo que estorba, `npm run verify` + recorrido manual | ~media sesión |

Cada fase se entrega verificada por sí misma; nada se publica a medias.

## 9. Riesgos y decisiones abiertas

- **Meses ya cerrados con la regla antigua** no se reabren; las reglas nuevas aplican solo a meses nuevos. Sin migración de datos.
- **Partidas históricas sin cuenta de custodia**: el cierre las lista como aviso; no bloquean (hoy bloquean la apertura).
- **D1 — apertura negativa**: si ya se registraron movimientos del mes y el conteo real no los cubre, el cálculo de apertura daría negativo y hoy falla con `'Calculated opening balance cannot be negative'`. Propuesta: permitirla **solo con motivo** (descubierto real); alternativa: mantener el bloqueo con mensaje claro. Decisión del usuario.
- **D2 — cobertura del cierre**: se conserva cerrar únicamente el mes anterior y pasado su último día. Es dos líneas de SQL que evitan cierres retroactivos accidentales; no se propone quitarlas.
