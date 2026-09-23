# Plan de fixeo — usuarios, PIN y flujo entrar/salir

**Fecha:** 21/09/2026 · **Proceso:** auditoría → plan (arneses y guardarraíles) → implementación.
**Requisitos del negocio:** ocultar el rol `administracion` del selector · PIN de **4 dígitos** para `finanzas` y `nomina` · interfaz de PIN idéntica al POS de referencia (`listo-pos-cotizaciones`, solo lectura).

---

## 1. Auditoría

### 1.1 Creación y validación de usuarios (`server/handlers/gestionar-operadores.js`)

| # | Hallazgo | Gravedad |
|---|---|---|
| A1 | `validarPin()` fija `/^\d{6}$/` y el error literal "El PIN debe ser de 6 dígitos": no existe noción de longitud por rol. | Requisito incumplido (finanzas/nómina → 4) |
| A2 | `UsuariosPanel` fija `slice(0, 6)`, placeholder "6 dígitos" y `pin.length !== 6` en creación y restablecimiento de PIN. | Requisito incumplido |
| A3 | `pinLengthForRole()` en `auth-operators.js` devuelve siempre 6 (constante): el login exige 6 para todos los roles. | Requisito incumplido |
| A4 | `hashPinPBKDF2` acepta 4–8 dígitos (PBKDF2 100k + salt 16 B) y `verifyPinPBKDF2` compara hashes; `publicUsuario` nunca expone `pin_hash`/`pin_salt`. | ✅ Correcto |
| A5 | El selector de roles ofrece `ROLES_ASIGNABLES` = jefe, administracion, finanzas, nomina (`desarrollador` ya excluido como cuenta técnica). Hay que ocultar `administracion`. | Requisito incumplido |
| A6 | Reglas sólidas: nombre 3–60 único por cuenta, cupo `MAX_ACTIVOS_POR_ROL` (jefe 2, administracion 2, finanzas 1, nomina 1), PIN solo dígitos, auditoría en cada mutación. | ✅ Correcto |
| A7 | `GUIA_CREAR_USUARIOS_ROLES.md` promete "PIN no consecutivos ni repetidos", pero **ningún código lo valida**. | Discrepancia doc/código |

### 1.2 Flujo entrar/salir por rol

| # | Hallazgo | Gravedad |
|---|---|---|
| B1 | `verifyAuth` acepta la cabecera `X-Operator-Id` del navegador y **sobrescribe** el operador de la sesión: cualquier sesión puede operar como cualquier operador activo sin su PIN (el chequeo de `validateOperator` queda vacío porque compara la cabecera contra sí misma). | 🔴 Hueco crítico |
| B2 | El operador elegido queda en `app_metadata` y `/api/auth/me` lo reutiliza: **reingresar con solo la cuenta entra sin PIN**. | 🔴 Hueco alto |
| B3 | `/api/auth/me` auto-selecciona sin PIN cuando la cuenta tiene un único operador. | Medio (diseño previo, ahora inaceptable tras exigir barrera) |
| B4 | `logout()` solo limpia el estado local: no borra la selección de operador. | Alto (alimenta B2) |
| B5 | `LoginPinModal` calcula `PIN_LEN` con literales heredados (`vendedor`) que ya no existen en el flujo. | Bajo (código muerto) |
| B6 | Roles heredados (`vendedor`, `logistica`, `supervisor`): bloqueados en sesión por `tieneAccesoOperativo` y rechazados en `switch-operator` antes del PIN; sus políticas RLS históricas quedan inertes. | ✅ Correcto |
| B7 | La ruta sin PIN (`select-operator` / `LOGIN_SIN_PIN`) está eliminada y protegida por guardarraíl. | ✅ Correcto |
| B8 | Sin opción "Cambiar de usuario": el único camino al PIN es cerrar sesión, y B2/B4 se lo saltan. | Medio |

### 1.3 Interfaz de PIN

| # | Hallazgo |
|---|---|
| C1 | Nuestro modal usa clases `pin-modal-*` (tarjeta genérica clara) sin relación visual con el POS de referencia. |
| C2 | El POS de referencia ("Dark Premium") define: fondo `rgba(5,10,24,.85)` + blur 8px; tarjeta con degradado `#0d1f3c → #0a1628 → #081520`, borde `rgba(255,255,255,.08)` y sombra profunda; patrón de puntos; orbe del color del usuario; línea superior; drag-bar móvil; avatar + nombre + "Ingresa tu PIN de N dígitos"; mensaje de estado ámbar; puntos con glow, rojo en error y shake; pad numérico 3×4 con hover/press teñido por el color del usuario; overlay "Verificando…"; watchdog de 20 s que jamás deja el spinner congelado. |
| C3 | El modal de referencia acepta resultados ricos (`{ok}`, `busy`, `error`, `sessionExpired`) además del booleano — nuestro contrato actual solo entiende booleanos. |

---

## 2. Plan de fixeo

### F1 — Fuente única de longitud de PIN por rol
- `server/lib/permissions.js` (único archivo que escribe roles): `LONGITUD_PIN_POR_ROL = { finanzas: 4, nomina: 4 }` + `longitudPin(rol)` → 6 por defecto. El frontend lo recibe por el espejo `src/config/accesoModulos.js`.
- Consumidores: `pinLengthForRole` (login), `validarPin(rol, pin)` (crear y restablecer), `UsuariosPanel` (input + validación), `LoginPinModal` (PIN_LEN).
- Migración: usuarios `finanzas`/`nomina` existentes con PIN de 6 deben restablecer su PIN a 4 desde el panel (hoy en producción solo existe Administración; verificar antes de desplegar).

### F2 — Ocultar `administracion` del selector
- `ROLES_CREABLES = ROLES_ASIGNABLES.filter(rol => rol !== 'administracion')` en `permissions.js` (jefe, finanzas, nomina).
- `UsuariosPanel` y la validación de `crear`/`rol` del servidor usan `ROLES_CREABLES`. Los usuarios `administracion` existentes siguen operando con normalidad (rol histórico, idéntico a jefe); solo deja de ofrecerse.

### F3 — Interfaz de PIN estilo referencia
- Reescribir `compat/components/auth/LoginPinModal.jsx` replicando el Dark Premium del POS (autocontenido, estilos inline), conservando el contrato `isOpen, onClose, user, onSubmit` (booleano o `{ok}`) y añadiendo `onCancelPending`, watchdog 20 s y mensajes de estado (`busy` / `error` / timeout).
- `PIN_LEN` vendrá de `longitudPin(user?.rol)`.

### F4 — Cerrar los huecos del flujo entrar/salir
- `verifyAuth` **deja de leer** `X-Operator-Id`: el operador solo puede salir de metadata escrita tras validar PIN en `switch-operator`.
- `/api/auth/me` deja de auto-seleccionar: exige selección + PIN siempre (responde `OPERADOR_REQUERIDO` con la lista, aunque haya un solo operador).
- `login()` limpia la selección de operador en el servidor al abrir una sesión con contraseña (y `cambiarOperador()` la limpia en caliente): toda sesión nueva exige elegir operador y PIN. Un reload de la misma sesión no lo repite: el operador ya fue validado con PIN en esa sesión.
- Nueva acción "Cambiar de usuario" en el menú de sesión (desktop y móvil): limpia el operador y vuelve a la pantalla de selección sin cerrar la cuenta.

---

## 3. Arnés (pruebas deterministas)

| Área | Prueba |
|---|---|
| Matriz | `longitudPin`: finanzas/nomina → 4; jefe/administracion/desarrollador y desconocidos → 6. `ROLES_CREABLES` sin `administracion` ni `desarrollador`. |
| Servidor — crear | Acepta PIN de 4 para `finanzas`/`nomina` y 6 para `jefe`; rechaza el largo incorrecto con mensaje que nombra el largo correcto; rechaza asignar `administracion`. |
| Servidor — PIN | `handleCambiarPinOperador` valida el largo según el rol **del usuario destino**. |
| Servidor — login | `handleSwitchOperator` exige `pin.length === longitudPin(rol)` (4 para finanzas/nómina); un PIN de 6 de un usuario finanzas ya no entra (requiere restablecer). |
| Servidor — seguridad | Una cabecera `X-Operator-Id` ajena **no** cambia el operador (B1); `/api/auth/me` sin selección responde `OPERADOR_REQUERIDO` aunque haya un operador (B3). |
| Store | `login()` invoca `clear-operator` antes de cargar el perfil (y el login sigue siendo éxito cuando falta el PIN); `cambiarOperador()` limpia la selección y vuelve a la pantalla de PIN. |
| UI — modal | PIN de N dígitos por rol (4 puntos para finanzas), autoenvío único, PIN rechazado limpia y permite reintentar, sin validación por red. |
| UI — panel | El selector de roles no ofrece `administracion`; el campo PIN acepta 4 dígitos para `finanzas` y 6 para `jefe`; el mensaje de error nombra el largo correcto. |

## 4. Guardarraíles (`scripts/check-project.mjs`)

- **Longitud de PIN única:** prohíbe `/^\d{6}$/` y el literal "PIN debe ser de 6 dígitos" fuera de `server/lib/permissions.js` (la única fuente es `longitudPin`).
- **Sin operador elegido por el navegador:** prohíbe `headerOpId` en `compat/api/lib/auth.js` (la identidad de operador no puede sobrescribirse desde una cabecera).
- **Selector sin administración:** exige `ROLES_CREABLES` en `src/components/sistema/UsuariosPanel.jsx` y prohíbe `ROLES_ASIGNABLES` ahí.
- **Modal derivado:** exige `longitudPin` en `LoginPinModal.jsx`.
- Cada regla se verifica con **prueba negativa** (regresión inyectada → debe fallar → restaurar).

## 5. Documentación y criterios de aceptación

- Actualizar `GUIA_CREAR_USUARIOS_ROLES.md` (PIN por rol) y `PLAN_HUMO_E2E_ROLES.md` (PIN de 4 para finanzas/nómina).
- **Aceptación:** (1) el selector nunca ofrece `administracion`; (2) `finanzas`/`nomina` se crean, entran y cambian PIN con 4 dígitos y `jefe` con 6; (3) el modal de PIN replica el Dark Premium del POS; (4) ningún camino entra sin PIN (ni cabecera, ni operador recordado, ni cuenta mono-operador); (5) `npm run verify` en verde.
