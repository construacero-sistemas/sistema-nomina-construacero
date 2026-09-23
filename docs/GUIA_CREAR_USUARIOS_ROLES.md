# Guía: crear el primer usuario `finanzas` y `nomina` en producción

**Fecha:** 21/09/2026 · **Para:** Construacero · **Base remota:** `wlxcclidnwketrghqaxs` (migraciones 231–244 ya aplicadas y verificadas)

Quién puede seguir esta guía: un usuario `administracion`, `jefe` o `desarrollador` (capacidad `gestionarUsuarios`). Cualquier otro rol recibe 403 al abrir el panel.

---

## 1. Crear los usuarios desde la app

### Paso 1 — Iniciar sesión como administración
1. Abre la app e ingresa el **correo y la contraseña de la cuenta**.
2. En la pantalla *¿Quién está trabajando?* selecciona el usuario de administración.
3. Escribe su PIN (6 dígitos).
4. Verificación: entras y ves **ambas** pestañas (Nómina y Finanzas) más Sistema.

> **Barrera de acceso (F2):** el PIN se valida en el servidor (Worker), no en el navegador, y no existe una ruta para seleccionar un operador sin PIN. **Cada inicio de sesión con correo y contraseña exige elegir usuario e ingresar su PIN**, incluso si la cuenta tiene un solo operativo. Un PIN incorrecto deja la pantalla de selección abierta y el intento queda auditado (`LOGIN_FALLIDO`); tras varios intentos el servidor aplica un límite temporal. Desde el menú lateral también hay **Cambiar de usuario**, que vuelve a esta pantalla sin cerrar la cuenta.

### Paso 2 — Abrir el panel de usuarios
- Menú **Sistema → Usuarios**.
- Verificación: la lista carga con los operadores existentes (activos e inactivos) y el botón de crear usuario muestra el selector de rol con las opciones: `jefe`, `finanzas`, `nomina`. El rol `administracion` **ya no se ofrece** (es histórico; `jefe` tiene las mismas funciones).

### Paso 3 — Crear el usuario de Finanzas
Formulario (todos validados por el servidor):

| Campo | Valor recomendado | Regla del servidor |
|---|---|---|
| Nombre | `Tesorería` (o el nombre real de la persona, 3–60 caracteres) | Único en la cuenta, sin distinguir mayúsculas |
| Rol | `finanzas` | Solo 1 usuario activo con este rol |
| PIN | `finanzas` y `nomina`: **4 dígitos** (ej.: `4829`); `jefe`: **6 dígitos**. Recomendación: no consecutivos ni repetidos | Exactamente 4 o 6 dígitos según el rol, numérico |
| Color | opcional (identifica al usuario en la lista de login) | Máx. 20 caracteres |

Confirma y verifica que el nuevo usuario aparece en la lista con estado activo.

### Paso 4 — Crear el usuario de Nómina
Repite el Paso 3 con rol `nomina` (ej.: nombre `Nómina RRHH`, otro PIN distinto de **4 dígitos**). Regla idéntica: solo 1 activo con ese rol.

### Paso 5 — Cerrar sesión
La pantalla de selección de usuario debe listar ahora **todos** los perfiles operativos activos: administración, los jefes que existan, `finanzas` y `nomina`. Los roles heredados (`vendedor`, `logistica`, `supervisor`) **no** aparecen.

---

## 2. Errores que puedes ver al crear (y qué significan)

| Mensaje | Causa | Qué hacer |
|---|---|---|
| `El nombre debe tener entre 3 y 60 caracteres` | Nombre vacío, corto o muy largo | Ajustar el nombre |
| `Rol inválido. Permitidos: …` | El rol no está en la lista assignable | Elegir del selector |
| `El PIN debe ser de 4 dígitos` / `de 6 dígitos` | PIN vacío, corto, largo o con letras (el largo depende del rol) | Escribir el PIN con el largo que nombra el mensaje |
| `Ya existe el máximo permitido de usuarios activos con rol finanzas/nomina…` (409) | Ya hay 1 activo con ese rol | Desactivar primero al existente (Paso 6.3) y luego crear el nuevo |
| `Ya existe un usuario con ese nombre` (409) | Nombre duplicado en la cuenta | Usar otro nombre |
| 403 al abrir el panel | Tu rol no tiene `gestionarUsuarios` | Hacerlo con administración/jefe |

## 3. Mantenimiento (por si te equivocas)

1. **Cambiar PIN:** Sistema → Usuarios → usuario → restablecer PIN (4 o 6 dígitos según el rol; el formulario muestra el largo correcto).
2. **Desactivar usuario:** interruptor de estado en la lista. Queda fuera del login pero conserva su historial y sus movimientos.
3. **Reemplazar al único `finanzas`/`nomina`:** primero desactiva al existente (libera el cupo de 1 activo), luego crea al nuevo.
4. Cada una de estas operaciones queda en **auditoría** con usuario, rol y fecha.

## 4. Validar permisos desde la app

Hacer esto con cada usuario recién creado. (Versión completa con evidencias: `docs/PLAN_HUMO_E2E_ROLES.md`.)

### 4.1 Usuario `finanzas`
| # | Prueba | Esperado |
|---|---|---|
| 1 | Login: seleccionar el usuario y escribir su PIN | Entra y aterriza en **Finanzas** |
| 2 | Pestañas visibles | Finanzas sí; **Nómina no existe para él** |
| 3 | Registrar un ingreso y un egreso de prueba | Ambos se guardan y aparecen en el libro |
| 4 | Buscar saldos/acumulados de cuentas | **No los ve** (la sección no se muestra) |
| 5 | Devtools (F12) → consola: llamar al endpoint de saldos | **403** — la interfaz oculta, el servidor niega |
| 6 | Intentar abrir una ruta de Nómina escribiendo la URL | Sin datos; el servidor rechaza sus consultas |

### 4.2 Usuario `nomina`
| # | Prueba | Esperado |
|---|---|---|
| 1 | Login | Entra y aterriza en **Nómina** |
| 2 | Pestañas visibles | Nómina sí; **Finanzas no existe para él** |
| 3 | Marcar asistencia de un empleado y crear un período | Funciona |
| 4 | Cerrar el período y pagarlo | El pago se registra (habilitado por la migración 244) |
| 5 | Devtools: llamar a un endpoint de movimientos financieros | **403** |
| 6 | Intentar un traspaso por API | **403** (la RPC responde `PT403`) |

### 4.3 Criterio de éxito
- Los pasos 3–4 de cada usuario completan sin errores.
- **Los pasos 5–6 deben fallar**. Si algo de eso "funciona", es un hallazgo de seguridad bloqueante: parar, documentar y restaurar con `backups/pre-migracion-243-*` si hiciera falta.
- Al terminar, registrar el resultado (✅/❌ por caso) en la bitácora del proyecto.

## 5. Recuperación: cuenta sin usuarios activos

Si la cuenta se queda **sin ningún usuario activo** (por ejemplo, desactivaron a todos), al entrar verás la tarjeta «Crea el primer usuario» en la propia pantalla de error:

1. Escribe el nombre del usuario y un PIN de **6 dígitos**.
2. Pulsa «Crear usuario y entrar». El servidor solo permite este arranque cuando no hay usuarios activos; crea siempre un usuario con rol **Jefe** y entra validando su PIN, igual que en el login normal.
3. Desde el nuevo Jefe crea el resto de usuarios en Sistema → Usuarios.

Nunca quedes sin al menos un usuario con rol Jefe o Administración activo: esos son los únicos que pueden gestionar el resto.
