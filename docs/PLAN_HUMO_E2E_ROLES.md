# Plan de humo E2E por rol — jefe / finanzas / nomina

**Fecha:** 21/09/2026 · **Objetivo:** verificar en producción (Supabase `wlxcclidnwketrghqaxs`) que los tres roles nuevos operan exactamente lo que la matriz única les concede — ni más ni menos — tras aplicar las migraciones 231–244.

**Flujo de acceso vigente (F2, 21/09/2026):** la app pide primero el **correo y la contraseña de la cuenta**; después aparece la pantalla *¿Quién está trabajando?* con los operadores activos y, al elegir uno, el **PIN del operador**, que valida el Worker (PBKDF2). No existe ruta para entrar sin PIN: `POST /api/auth/select-operator` está eliminada y `LOGIN_SIN_PIN` no puede volver. Los pasos «Login como X» de este plan significan: elegir X en esa pantalla e ingresar su PIN.

**Prerequisitos confirmados antes de empezar:**

- Migraciones 231–244 registradas en el remoto y paridad JS↔SQL verificada (ver bitácora, entrada del 21/09/2026).
- Respaldo previo disponible: `backups/pre-migracion-243-{globals,esquema,datos}.sql`.
- App desplegada (o preview local) apuntando al remoto, con al menos un usuario `administracion` operativo.

---

## 0. Preparación (rol `administracion`)

| # | Paso | Resultado esperado |
|---|---|---|
| 0.1 | Iniciar sesión: correo y contraseña de la cuenta, elegir `administracion` e ingresar su PIN (6 dígitos) | La elección exige PIN (toda sesión nueva); con el PIN correcto redirige a `/finanzas` |
| 0.2 | Sistema → Usuarios: crear tres operadores, uno por rol: `jefe`, `finanzas`, `nomina` | El selector de rol ofrece solo `jefe`, `finanzas` y `nomina` (`ROLES_CREABLES`); **no** aparece `administracion` (rol histórico oculto) |
| 0.3 | Asignar PIN por rol: **4 dígitos** para `finanzas` y `nomina`, **6** para `jefe` | El PIN se guarda; el formulario exige el largo del rol elegido |
| 0.4 | Cerrar sesión | Vuelve el formulario de cuenta; al entrar de nuevo aparece la pantalla de selección con **solo** los perfiles operativos activos |
| 0.5 | **Protección:** elegir un operador y escribir un PIN incorrecto | No entra; sigue en la pantalla de selección con los dígitos limpios. El intento queda auditado como `LOGIN_FALLIDO`; a los pocos intentos el servidor responde con límite temporal |
| 0.6 | **Protección:** con la sesión de cuenta pero sin elegir operador (devtools), llamar a `GET /api/auth/me` | **403 `OPERADOR_REQUERIDO`** con la lista pública; nunca un `profile`. La llamada antigua a `POST /api/auth/select-operator` debe responder 404 (ruta eliminada) |

**Caso negativo 0.7:** si existiera algún usuario `vendedor`/`logistica` activo, NO debe aparecer en la pantalla de selección ni aceptarse su PIN (`switch-operator` lo rechaza antes de validar credencial: 403 «no tiene acceso operativo»).

---

## 1. Rol `jefe` — acceso total

| # | Paso | Resultado esperado |
|---|---|---|
| 1.1 | Login como `jefe` | Acepta el PIN; `rutaParaRol` lleva a `/finanzas` |
| 1.2 | Ver pestañas | Nómina **y** Finanzas visibles; sección de saldos/custodia visible (`verSaldos`) |
| 1.3 | Finanzas → registrar ingreso y un egreso | Ambos se registran; aparecen en el libro |
| 1.4 | Finanzas → traspaso entre cuentas | Se registra (`operarFinanzas`) |
| 1.5 | Nómina → cerrar período y pagar | El pago se registra (`administrarNomina`) |
| 1.6 | Sistema → Usuarios | Panel accesible y editable (`gestionarUsuarios`) |

---

## 2. Rol `finanzas` — libro sí, saldos y nómina no

| # | Paso | Resultado esperado |
|---|---|---|
| 2.1 | Login como `finanzas` | Acepta el PIN de **4 dígitos**; redirige a `/finanzas` |
| 2.2 | Ver pestañas | Finanzas visible; **Nómina NO visible** (`verNomina` = false) |
| 2.3 | Registrar ingreso, egreso y traspaso | Los tres se registran (`operarFinanzas`) — este es el cambio que habilita 244 |
| 2.4 | Buscar la sección de saldos/acumulados de cuentas | **No aparece en la UI** (`verSaldos` = false). Cambio de fase honesto: el libro de movimientos sí se ve (`verFinanzas`), los saldos agregados no |
| 2.5 | Protección de red: llamar al endpoint de saldos directo (devtools, fetch a `/api/finanzas/saldos`) | **403** del Worker (`verSaldos` falla en servidor); sin filtro, sin datos |
| 2.6 | Protección de red: intentar pagar nómina vía API (por ejemplo reenviar la petición que haría la UI de nómina) | **403** (`administrarNomina` falla en servidor; en RPC el guardián responde `PT403`) |
| 2.7 | Finanzas → asignar custodia a un movimiento | Se registra (`operarFinanzas`) |

**Invariantes:** nada de lo que haga `finanzas` crea filas en `nomina_*`; sus movimientos quedan en `finanzas_movimientos` con su `operador_id`.

---

## 3. Rol `nomina` — nómina sí, finanzas no

| # | Paso | Resultado esperado |
|---|---|---|
| 3.1 | Login como `nomina` | Acepta el PIN de **4 dígitos**; redirige a `/nomina` |
| 3.2 | Ver pestañas | Nómina visible; **Finanzas NO visible** (`verFinanzas` = false) |
| 3.3 | Nómina → asistencia, período, cierre y pago | Todo opera (`administrarNomina`); el pago de nómina por un rol distinto de administración es el otro cambio que habilita 244 |
| 3.4 | Protección de red: fetch directo a un endpoint de movimientos (`/api/finanzas/...`) | **403** del Worker; sin datos |
| 3.5 | Protección de red: intentar un traspaso vía API | **403** (`operarFinanzas` falla; RPC responde `PT403`) |

**Invariante:** `nomina` nunca ve `finanzas_movimientos` ni `cuentas_custodia` (RLS `verFinanzas`/`verSaldos`).

---

## 4. Verificación directa en base (opcional pero barato)

Con el SQL editor o la API de query, tras ejecutar los casos:

```sql
-- Los tres operadores nuevos existen con rol correcto
SELECT nombre, rol, activo FROM public.usuarios
WHERE rol IN ('jefe','finanzas','nomina') ORDER BY rol;

-- Movimientos creados en el humo, con su operador y rol
SELECT tipo, moneda, monto, operador_nombre, operador_rol, creado_en
FROM public.finanzas_movimientos ORDER BY creado_en DESC LIMIT 10;
```

**Esperado:** los movimientos de los casos 1.x/2.x existen; los intentos fallidos (2.6, 3.5) no dejaron filas.

---

## 5. Registro y rollback

- Marcar cada caso como ✅/❌ con captura o ID de movimiento como evidencia.
- Cualquier ❌ en casos de protección (0.5, 0.6, 2.5, 2.6, 3.4, 3.5) es **bloqueante**: significa que la base o el Worker concedieron algo que la matriz no — congelar el despliegue y revertir con el respaldo.
- Rollback de datos: `backups/pre-migracion-243-datos.sql` + esquema si hace falta. Las migraciones no tienen "down"; el rollback real es restaurar el dump.

## Resumen de la matriz (lo mínimo que debe pasar)

| Capacidad | jefe | finanzas | nomina |
|---|---|---|---|
| Ver/operar Nómina | ✅ | ❌ (UI oculta + 403) | ✅ |
| Pagar/revertir nómina | ✅ | ❌ (403/PT403) | ✅ |
| Registrar ingresos/egresos/traspasos | ✅ | ✅ | ❌ (403/PT403) |
| Ver saldos/custodia | ✅ | ❌ (UI oculta + 403) | ❌ |
| Gestionar usuarios | ✅ | ❌ | ❌ |
